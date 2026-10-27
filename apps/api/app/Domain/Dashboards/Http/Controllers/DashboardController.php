<?php

declare(strict_types=1);

namespace App\Domain\Dashboards\Http\Controllers;

use App\Domain\Authorization\Models\Role;
use App\Domain\Dashboards\Actions\SaveDashboard;
use App\Domain\Dashboards\Models\Dashboard;
use App\Domain\Dashboards\Models\DashboardRevision;
use App\Domain\Dashboards\Models\DashboardShare;
use App\Domain\Dashboards\Services\DashboardAccess;
use App\Domain\Dashboards\Services\DashboardDefinition;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

final class DashboardController
{
    /** The most members and roles one dashboard can be shared with. */
    private const MAX_SHARES = 100;

    public function __construct(private readonly DashboardAccess $access, private readonly SaveDashboard $save) {}

    /** Only the dashboards this person can open, each with what they may do to it. */
    public function index(Request $request, Organization $organization): array
    {
        abort_unless($this->access->capabilities($request->user(), $organization)['view'], 403);
        $dashboards = Dashboard::query()->where('organization_id', $organization->id)->with(['creator:id,name', 'updater:id,name'])->orderBy('name')->get();
        $visible = $this->access->visible($request->user(), $organization, $dashboards);
        $preferences = DB::table('dashboard_user')->where('user_id', $request->user()->id)->whereIn('dashboard_id', $dashboards->modelKeys())->get()->keyBy('dashboard_id');

        return ['data' => $visible->map(fn (array $entry) => $this->view($entry['dashboard'], $preferences->get($entry['dashboard']->id), $entry['abilities']))->all()];
    }

    public function store(Request $request, Organization $organization): array
    {
        abort_unless($this->access->capabilities($request->user(), $organization)['create'], 403);
        $values = app(DashboardDefinition::class)->validate($request, $organization, false);
        $dashboard = $this->save->create($organization, $request->user(), $values);

        return ['data' => $this->view($dashboard, null, $this->access->abilities($request->user(), $organization, $dashboard))];
    }

    public function show(Request $request, Organization $organization, Dashboard $dashboard): array
    {
        $abilities = $this->authorizeDashboard($request, $organization, $dashboard, 'view');
        $this->savePreference($request, $dashboard, ['last_viewed_at' => now()]);

        return ['data' => $this->view($dashboard, $this->preference($request, $dashboard), $abilities)];
    }

    public function update(Request $request, Organization $organization, Dashboard $dashboard): array
    {
        $abilities = $this->authorizeDashboard($request, $organization, $dashboard, 'edit');
        $values = app(DashboardDefinition::class)->validate($request, $organization, true);

        return $this->saved($request, $this->save->update($dashboard, $request->user(), $values, (int) $values['revision']), $abilities);
    }

    public function star(Request $request, Organization $organization, Dashboard $dashboard): array
    {
        $abilities = $this->authorizeDashboard($request, $organization, $dashboard, 'view');
        $starred = $request->validate(['starred' => ['required', 'boolean']])['starred'];
        $this->savePreference($request, $dashboard, ['starred' => (bool) $starred]);

        return ['data' => $this->view($dashboard, $this->preference($request, $dashboard), $abilities)];
    }

    public function duplicate(Request $request, Organization $organization, Dashboard $dashboard): array
    {
        $this->authorizeDashboard($request, $organization, $dashboard, 'view');
        abort_unless($this->access->capabilities($request->user(), $organization)['create'], 403);
        $name = trim($request->validate(['name' => ['required', 'string', 'max:120']])['name']);
        if ($name === '') {
            throw ValidationException::withMessages(['name' => 'Enter a dashboard name.']);
        }

        return DB::transaction(function () use ($dashboard, $name, $organization, $request): array {
            // The copy keeps the original's audience, so duplicating never widens who can see it.
            $copy = Dashboard::create([...$dashboard->only(['widgets', 'layouts', 'defaults', 'tags', 'folder', 'access']), 'name' => $name, 'revision' => 1, 'organization_id' => $organization->id, 'created_by' => $request->user()->id, 'updated_by' => $request->user()->id]);
            foreach ($dashboard->shares()->get() as $share) {
                $copy->shares()->create($share->only(['role_id', 'user_id', 'level']));
            }
            $this->save->snapshot($copy);

            return ['data' => $this->view($copy, null, $this->access->abilities($request->user(), $organization, $copy))];
        });
    }

    public function revisions(Request $request, Organization $organization, Dashboard $dashboard): array
    {
        $this->authorizeDashboard($request, $organization, $dashboard, 'view');
        $revisions = DashboardRevision::where('dashboard_id', $dashboard->id)->with('creator:id,name')->orderByDesc('revision')->limit(SaveDashboard::KEPT_REVISIONS)->get();

        return ['data' => $revisions->map(fn (DashboardRevision $revision) => [
            ...$revision->only(['revision', 'name', 'created_at', 'origin']),
            'widget_count' => count($revision->widgets ?? []),
            'updated_by_name' => $revision->creator?->name,
        ])->all()];
    }

    public function revision(Request $request, Organization $organization, Dashboard $dashboard, int $number): array
    {
        $this->authorizeDashboard($request, $organization, $dashboard, 'view');
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
        $abilities = $this->authorizeDashboard($request, $organization, $dashboard, 'edit');
        $expected = (int) $request->validate(['revision' => ['required', 'integer', 'min:1']])['revision'];

        // The stale check comes first: a newer save may have pruned the snapshot or changed what validates.
        return DB::transaction(function () use ($abilities, $dashboard, $expected, $number, $organization, $request): array {
            $locked = $this->save->lock($dashboard, $expected);
            $revision = $this->findRevision($locked, $number);
            // Re-validated like an update so devices that left the organization since cannot come back.
            $values = app(DashboardDefinition::class)->validateDocument([
                ...$revision->only(['name', 'layouts', 'folder']),
                'widgets' => DashboardDefinition::normalize($revision->widgets ?? []),
                'defaults' => $revision->defaults ?? DashboardDefinition::defaults(),
                'tags' => $revision->tags ?? [],
                'revision' => $expected,
            ], $organization, true);

            return $this->saved($request, $this->save->update($locked, $request->user(), $values, $expected), $abilities);
        });
    }

    public function destroy(Request $request, Organization $organization, Dashboard $dashboard): Response
    {
        $this->authorizeDashboard($request, $organization, $dashboard, 'delete');
        $dashboard->delete();

        return response()->noContent();
    }

    /**
     * @param  array{view: bool, edit: bool, share: bool, delete: bool}  $abilities
     */
    private function saved(Request $request, Dashboard $dashboard, array $abilities): array
    {
        return ['data' => $this->view($dashboard, $this->preference($request, $dashboard), $abilities)];
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

    /**
     * @param  'view'|'edit'|'share'|'delete'  $ability
     * @return array{view: bool, edit: bool, share: bool, delete: bool}
     */
    private function authorizeDashboard(Request $request, Organization $organization, Dashboard $dashboard, string $ability): array
    {
        abort_unless($dashboard->organization_id === $organization->id, 404);
        $abilities = $this->access->abilities($request->user(), $organization, $dashboard);
        abort_unless($abilities['view'], 403, 'You don\'t have access to this dashboard.');
        abort_unless($abilities[$ability], 403);

        return $abilities;
    }

    /** Who can open this dashboard: the organization or only the owner and the shares listed. */
    public function access(Request $request, Organization $organization, Dashboard $dashboard): array
    {
        $this->authorizeDashboard($request, $organization, $dashboard, 'share');

        return ['data' => $this->accessView($dashboard)];
    }

    /** Replaces the dashboard's access and its shares in one step. */
    public function updateAccess(Request $request, Organization $organization, Dashboard $dashboard): array
    {
        $this->authorizeDashboard($request, $organization, $dashboard, 'share');
        $values = $request->validate([
            'access' => ['required', Rule::in([DashboardAccess::ORGANIZATION, DashboardAccess::RESTRICTED])],
            'shares' => ['present', 'array', 'max:'.self::MAX_SHARES],
            'shares.*.type' => ['required', Rule::in(['role', 'user'])],
            'shares.*.id' => ['required', 'integer'],
            'shares.*.level' => ['required', Rule::in(['view', 'edit'])],
        ]);
        $roles = collect($values['shares'])->where('type', 'role')->pluck('id')->unique();
        $users = collect($values['shares'])->where('type', 'user')->pluck('id')->unique()
            // The owner always has full access, so a share for them adds nothing.
            ->reject(fn (int $id) => $id === $dashboard->created_by);
        $foreignRoles = $roles->diff(Role::query()->where('organization_id', $organization->id)->whereIn('id', $roles)->pluck('id'));
        $foreignUsers = $users->diff($organization->users()->whereIn('users.id', $users)->pluck('users.id'));
        if ($foreignRoles->isNotEmpty() || $foreignUsers->isNotEmpty()) {
            throw ValidationException::withMessages(['shares' => 'Share only with roles and members of this organization.']);
        }

        DB::transaction(function () use ($dashboard, $values, $users): void {
            $dashboard->update(['access' => $values['access']]);
            $dashboard->shares()->delete();
            foreach (collect($values['shares'])->unique(fn (array $share) => $share['type'].':'.$share['id']) as $share) {
                if ($share['type'] === 'user' && ! $users->contains($share['id'])) {
                    continue;
                }
                $dashboard->shares()->create([$share['type'].'_id' => $share['id'], 'level' => $share['level']]);
            }
        });

        return ['data' => $this->accessView($dashboard->refresh())];
    }

    /** Roles and members matching a search, for the Share dialog. */
    public function shareTargets(Request $request, Organization $organization): array
    {
        $capabilities = $this->access->capabilities($request->user(), $organization);
        abort_unless($capabilities['create'] || $capabilities['manage'], 403);
        $search = trim((string) $request->validate(['search' => ['nullable', 'string', 'max:120']])['search']);
        $like = '%'.mb_strtolower($search).'%';
        $roles = Role::query()->where('organization_id', $organization->id)
            ->addSelect(['roles.*', 'users_count' => DB::table(config('permission.table_names.model_has_roles'))->selectRaw('count(*)')->whereColumn('role_id', 'roles.id')])
            ->when($search !== '', fn ($query) => $query->where(fn ($query) => $query->whereRaw('LOWER(display_name) LIKE ?', [$like])->orWhereRaw('LOWER(name) LIKE ?', [$like])))
            ->orderBy('display_name')->limit(20)->get();
        $users = $organization->users()
            ->when($search !== '', fn ($query) => $query->where(fn ($query) => $query->whereRaw('LOWER(users.name) LIKE ?', [$like])->orWhereRaw('LOWER(users.email) LIKE ?', [$like])))
            ->orderBy('users.name')->limit(20)->get(['users.id', 'users.name', 'users.email']);

        return ['data' => [
            'roles' => $roles->map(fn (Role $role) => ['type' => 'role', 'id' => $role->id, 'name' => $role->display_name ?? $role->name, 'detail' => (int) $role->users_count === 1 ? '1 member' : (int) $role->users_count.' members'])->all(),
            'users' => $users->map(fn ($user) => ['type' => 'user', 'id' => $user->id, 'name' => $user->name, 'detail' => $user->email])->all(),
        ]];
    }

    private function accessView(Dashboard $dashboard): array
    {
        $shares = $dashboard->shares()->with(['role:id,name,display_name', 'user:id,name,email'])->get();

        return [
            'access' => $dashboard->access,
            'owner' => $dashboard->created_by ? ['id' => $dashboard->created_by, 'name' => $dashboard->creator?->name] : null,
            'shares' => $shares->map(fn (DashboardShare $share) => $share->role_id
                ? ['type' => 'role', 'id' => $share->role_id, 'name' => $share->role?->display_name ?? $share->role?->name, 'detail' => 'Role', 'level' => $share->level]
                : ['type' => 'user', 'id' => $share->user_id, 'name' => $share->user?->name, 'detail' => $share->user?->email, 'level' => $share->level])
                ->sortBy(fn (array $share) => ($share['type'] === 'role' ? '0' : '1').mb_strtolower((string) $share['name']))->values()->all(),
        ];
    }

    /**
     * @param  array{view: bool, edit: bool, share: bool, delete: bool}  $abilities
     */
    private function view(Dashboard $dashboard, ?object $preference, array $abilities): array
    {
        return [...$dashboard->only(['uuid', 'name', 'layouts', 'revision', 'folder', 'access', 'created_by', 'created_at', 'updated_at']),
            'abilities' => ['edit' => $abilities['edit'], 'share' => $abilities['share'], 'delete' => $abilities['delete']],
            'widgets' => DashboardDefinition::normalize($dashboard->widgets ?? []),
            'defaults' => $dashboard->defaults ?? DashboardDefinition::defaults(),
            'tags' => $dashboard->tags ?? [],
            'starred' => (bool) ($preference->starred ?? false),
            'last_viewed_at' => isset($preference->last_viewed_at) ? Carbon::parse($preference->last_viewed_at) : null,
            'created_by_name' => $dashboard->creator?->name,
            'updated_by_name' => $dashboard->updater?->name];
    }
}
