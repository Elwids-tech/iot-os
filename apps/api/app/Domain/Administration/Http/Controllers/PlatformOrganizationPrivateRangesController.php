<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Controllers;

use App\Domain\Audit\Services\ActivityLog;
use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\DeviceAdapters\Models\AdapterTenant;
use App\Domain\DeviceAdapters\Services\AdapterService;
use App\Domain\DeviceAdapters\Services\Connections;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * The private network ranges an organization's OPC UA connections may reach (spec 038,
 * research R10). Platform staff only: a range may never include loopback, link-local,
 * metadata addresses or the platform's own networks.
 */
final class PlatformOrganizationPrivateRangesController
{
    public function show(Organization $organization): array
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        return ['data' => ['private_ranges' => AdapterTenant::where('organization_id', $organization->id)->value('private_ranges') ?? []]];
    }

    public function update(Request $request, Organization $organization): array
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);
        $ranges = Connections::checkRanges($request->validate(['private_ranges' => 'present|array|max:64', 'private_ranges.*' => 'required|string|max:64'])['private_ranges']);
        $tenant = AdapterTenant::where('organization_id', $organization->id)->first();
        if (! $tenant && $ranges === []) {
            return ['data' => ['private_ranges' => []]];
        }
        $tenant ??= app(AdapterService::class)->tenant($organization);
        $before = $tenant->private_ranges ?? [];
        $tenant->update(['private_ranges' => $ranges]);
        if ($before !== $ranges) {
            ActivityLog::record('device.adapter_tenant.private_ranges_changed', $organization->id, $request->user()->id, $tenant->uuid, ['before' => $before, 'after' => $ranges]);
        }

        return ['data' => ['private_ranges' => $ranges]];
    }
}
