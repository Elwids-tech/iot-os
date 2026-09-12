<?php

declare(strict_types=1);

namespace App\Domain\Dashboards\Http\Controllers;

use App\Domain\Dashboards\Models\Dashboard;
use App\Domain\Dashboards\Services\DashboardDefinition;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;

final class DashboardController
{
    public function __construct(private readonly DeviceAuthorization $authorization) {}

    public function index(Request $request, Organization $organization): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::VIEW, $organization);

        return ['data' => Dashboard::query()->where('organization_id', $organization->id)->orderBy('name')->get()->map(fn (Dashboard $dashboard) => $this->view($dashboard))->all()];
    }

    public function store(Request $request, Organization $organization): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::MANAGE, $organization);
        $values = app(DashboardDefinition::class)->validate($request, $organization, false);
        $values['revision'] = 1;
        $dashboard = Dashboard::create([...$values, 'organization_id' => $organization->id, 'created_by' => $request->user()->id, 'updated_by' => $request->user()->id]);

        return ['data' => $this->view($dashboard)];
    }

    public function show(Request $request, Organization $organization, Dashboard $dashboard): array
    {
        $this->authorizeDashboard($request, $organization, $dashboard, DevicePermission::VIEW);

        return ['data' => $this->view($dashboard)];
    }

    public function update(Request $request, Organization $organization, Dashboard $dashboard): array
    {
        $this->authorizeDashboard($request, $organization, $dashboard, DevicePermission::MANAGE);
        $values = app(DashboardDefinition::class)->validate($request, $organization, true);

        return DB::transaction(function () use ($dashboard, $request, $values): array {
            $locked = Dashboard::whereKey($dashboard->id)->lockForUpdate()->firstOrFail();
            abort_unless($locked->revision === (int) $values['revision'], 409, 'This dashboard changed in another session. Your draft is preserved. Reload the latest version before editing again.');
            $locked->update([...$values, 'revision' => $locked->revision + 1, 'updated_by' => $request->user()->id]);

            return ['data' => $this->view($locked)];
        });
    }

    public function destroy(Request $request, Organization $organization, Dashboard $dashboard): Response
    {
        $this->authorizeDashboard($request, $organization, $dashboard, DevicePermission::MANAGE);
        $dashboard->delete();

        return response()->noContent();
    }

    private function authorizeDashboard(Request $request, Organization $organization, Dashboard $dashboard, DevicePermission $permission): void
    {
        $this->authorization->authorize($request->user(), $permission, $organization);
        abort_unless($dashboard->organization_id === $organization->id, 404);
    }

    private function view(Dashboard $dashboard): array
    {
        return [...$dashboard->only(['uuid', 'name', 'layouts', 'revision', 'created_at', 'updated_at']),
            'widgets' => DashboardDefinition::normalize($dashboard->widgets ?? []),
            'defaults' => $dashboard->defaults ?? DashboardDefinition::defaults()];
    }
}
