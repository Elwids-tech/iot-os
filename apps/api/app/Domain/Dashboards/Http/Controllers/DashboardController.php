<?php

declare(strict_types=1);

namespace App\Domain\Dashboards\Http\Controllers;

use App\Domain\Dashboards\Models\Dashboard;
use App\Domain\Dashboards\Models\DashboardRevision;
use App\Domain\Dashboards\Services\DashboardDefinition;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

final class DashboardController
{
    private const KEPT_REVISIONS = 50;

    public function __construct(private readonly DeviceAuthorization $authorization) {}

    public function index(Request $request, Organization $organization): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::VIEW, $organization);
        $dashboards = Dashboard::query()->where('organization_id', $organization->id)->with(['creator:id,name', 'updater:id,name'])->orderBy('name')->get();
        $preferences = DB::table('dashboard_user')->where('user_id', $request->user()->id)->whereIn('dashboard_id', $dashboards->modelKeys())->get()->keyBy('dashboard_id');

        return ['data' => $dashboards->map(fn (Dashboard $dashboard) => $this->view($dashboard, $preferences->get($dashboard->id)))->all()];
    }

    public function store(Request $request, Organization $organization): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::MANAGE, $organization);
        $values = app(DashboardDefinition::class)->validate($request, $organization, false);

        return DB::transaction(function () use ($organization, $request, $values): array {
            $dashboard = Dashboard::create(['tags' => [], 'folder' => null, ...$values, 'revision' => 1, 'organization_id' => $organization->id, 'created_by' => $request->user()->id, 'updated_by' => $request->user()->id]);
            $this->snapshot($dashboard);

            return ['data' => $this->view($dashboard, null)];
        });
    }

    public function show(Request $request, Organization $organization, Dashboard $dashboard): array
    {
        $this->authorizeDashboard($request, $organization, $dashboard, DevicePermission::VIEW);
        $this->savePreference($request, $dashboard, ['last_viewed_at' => now()]);

        return ['data' => $this->view($dashboard, $this->preference($request, $dashboard))];
    }

    public function update(Request $request, Organization $organization, Dashboard $dashboard): array
    {
        $this->authorizeDashboard($request, $organization, $dashboard, DevicePermission::MANAGE);
        $values = app(DashboardDefinition::class)->validate($request, $organization, true);

        return DB::transaction(fn (): array => $this->save($request, $this->lockCurrent($dashboard, (int) $values['revision']), $values));
    }

    public function star(Request $request, Organization $organization, Dashboard $dashboard): array
    {
        $this->authorizeDashboard($request, $organization, $dashboard, DevicePermission::VIEW);
        $starred = $request->validate(['starred' => ['required', 'boolean']])['starred'];
        $this->savePreference($request, $dashboard, ['starred' => (bool) $starred]);

        return ['data' => $this->view($dashboard, $this->preference($request, $dashboard))];
    }

    public function duplicate(Request $request, Organization $organization, Dashboard $dashboard): array
    {
        $this->authorizeDashboard($request, $organization, $dashboard, DevicePermission::MANAGE);
        $name = trim($request->validate(['name' => ['required', 'string', 'max:120']])['name']);
        if ($name === '') {
            throw ValidationException::withMessages(['name' => 'Enter a dashboard name.']);
        }

        return DB::transaction(function () use ($dashboard, $name, $organization, $request): array {
            $copy = Dashboard::create([...$dashboard->only(['widgets', 'layouts', 'defaults', 'tags', 'folder']), 'name' => $name, 'revision' => 1, 'organization_id' => $organization->id, 'created_by' => $request->user()->id, 'updated_by' => $request->user()->id]);
            $this->snapshot($copy);

            return ['data' => $this->view($copy, null)];
        });
    }

    public function revisions(Request $request, Organization $organization, Dashboard $dashboard): array
    {
        $this->authorizeDashboard($request, $organization, $dashboard, DevicePermission::VIEW);
        $revisions = DashboardRevision::where('dashboard_id', $dashboard->id)->with('creator:id,name')->orderByDesc('revision')->limit(self::KEPT_REVISIONS)->get();

        return ['data' => $revisions->map(fn (DashboardRevision $revision) => [
            ...$revision->only(['revision', 'name', 'created_at']),
            'widget_count' => count($revision->widgets ?? []),
            'updated_by_name' => $revision->creator?->name,
        ])->all()];
    }

    public function revision(Request $request, Organization $organization, Dashboard $dashboard, int $number): array
    {
        $this->authorizeDashboard($request, $organization, $dashboard, DevicePermission::VIEW);
        $revision = $this->findRevision($dashboard, $number);

        return ['data' => [
            ...$revision->only(['revision', 'name', 'layouts', 'folder', 'created_at']),
            'widgets' => DashboardDefinition::normalize($revision->widgets ?? []),
            'defaults' => $revision->defaults ?? DashboardDefinition::defaults(),
            'tags' => $revision->tags ?? [],
            'widget_count' => count($revision->widgets ?? []),
            'updated_by_name' => $revision->creator?->name,
        ]];
    }

    /** Restores a snapshot as a new revision; the body carries the current dashboard `revision` like an update. */
    public function restore(Request $request, Organization $organization, Dashboard $dashboard, int $number): array
    {
        $this->authorizeDashboard($request, $organization, $dashboard, DevicePermission::MANAGE);
        $expected = (int) $request->validate(['revision' => ['required', 'integer', 'min:1']])['revision'];

        // The stale check comes first: a newer save may have pruned the snapshot or changed what validates.
        return DB::transaction(function () use ($dashboard, $expected, $number, $organization, $request): array {
            $locked = $this->lockCurrent($dashboard, $expected);
            $revision = $this->findRevision($locked, $number);
            // Re-validated like an update so devices that left the organization since cannot come back.
            $request->merge([
                ...$revision->only(['name', 'layouts', 'folder']),
                'widgets' => DashboardDefinition::normalize($revision->widgets ?? []),
                'defaults' => $revision->defaults ?? DashboardDefinition::defaults(),
                'tags' => $revision->tags ?? [],
            ]);

            return $this->save($request, $locked, app(DashboardDefinition::class)->validate($request, $organization, true));
        });
    }

    public function destroy(Request $request, Organization $organization, Dashboard $dashboard): Response
    {
        $this->authorizeDashboard($request, $organization, $dashboard, DevicePermission::MANAGE);
        $dashboard->delete();

        return response()->noContent();
    }

    /** Call inside a transaction. */
    private function lockCurrent(Dashboard $dashboard, int $expected): Dashboard
    {
        $locked = Dashboard::whereKey($dashboard->id)->lockForUpdate()->firstOrFail();
        abort_unless($locked->revision === $expected, 409, 'This dashboard changed in another session. Your draft is preserved. Reload the latest version before editing again.');

        return $locked;
    }

    private function save(Request $request, Dashboard $locked, array $values): array
    {
        $locked->update([...$values, 'revision' => $locked->revision + 1, 'updated_by' => $request->user()->id]);
        $this->snapshot($locked);

        return ['data' => $this->view($locked, $this->preference($request, $locked))];
    }

    private function snapshot(Dashboard $dashboard): void
    {
        DashboardRevision::create([...$dashboard->only(['revision', 'name', 'widgets', 'layouts', 'defaults', 'tags', 'folder']), 'dashboard_id' => $dashboard->id, 'created_by' => $dashboard->updated_by]);
        $oldestKept = DashboardRevision::where('dashboard_id', $dashboard->id)->orderByDesc('revision')->skip(self::KEPT_REVISIONS - 1)->value('revision');
        DashboardRevision::where('dashboard_id', $dashboard->id)->where('revision', '<', $oldestKept ?? 0)->delete();
    }

    private function findRevision(Dashboard $dashboard, int $number): DashboardRevision
    {
        return DashboardRevision::where('dashboard_id', $dashboard->id)->where('revision', $number)->firstOrFail();
    }

    private function savePreference(Request $request, Dashboard $dashboard, array $values): void
    {
        DB::table('dashboard_user')->upsert([['dashboard_id' => $dashboard->id, 'user_id' => $request->user()->id, ...$values]], ['dashboard_id', 'user_id'], array_keys($values));
    }

    private function preference(Request $request, Dashboard $dashboard): ?object
    {
        return DB::table('dashboard_user')->where(['dashboard_id' => $dashboard->id, 'user_id' => $request->user()->id])->first();
    }

    private function authorizeDashboard(Request $request, Organization $organization, Dashboard $dashboard, DevicePermission $permission): void
    {
        $this->authorization->authorize($request->user(), $permission, $organization);
        abort_unless($dashboard->organization_id === $organization->id, 404);
    }

    private function view(Dashboard $dashboard, ?object $preference): array
    {
        return [...$dashboard->only(['uuid', 'name', 'layouts', 'revision', 'folder', 'created_by', 'created_at', 'updated_at']),
            'widgets' => DashboardDefinition::normalize($dashboard->widgets ?? []),
            'defaults' => $dashboard->defaults ?? DashboardDefinition::defaults(),
            'tags' => $dashboard->tags ?? [],
            'starred' => (bool) ($preference->starred ?? false),
            'last_viewed_at' => isset($preference->last_viewed_at) ? Carbon::parse($preference->last_viewed_at) : null,
            'created_by_name' => $dashboard->creator?->name,
            'updated_by_name' => $dashboard->updater?->name];
    }
}
