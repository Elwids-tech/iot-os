<?php

declare(strict_types=1);

namespace App\Domain\Devices\Services;

use App\Domain\Administration\Services\OrganizationPermissionCeiling;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Shared\Models\Organization;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\PermissionRegistrar;

/**
 * Adds `Device.move` (spec 031, research R9) for every guard but `mcp`, as
 * PermissionSeeder does, and gives it to Organization Admin through the permission
 * ceiling. Unrestricted ceilings take it from the catalogue; restricted ceilings stay
 * as their platform administrator left them, and no other role gets it.
 */
final class DeviceMovePermissionBackfill
{
    public function run(): void
    {
        $guards = array_values(array_diff(array_keys(config('auth.guards')), ['mcp']));
        foreach ($guards as $guard) {
            Permission::query()->updateOrCreate(
                ['name' => DevicePermission::MOVE->value, 'guard_name' => $guard],
                ['group' => DevicePermission::getPermissionGroup()],
            );
        }
        app(PermissionRegistrar::class)->forgetCachedPermissions();

        Organization::query()->where('permissions_restricted', false)
            ->each(fn (Organization $organization) => app(OrganizationPermissionCeiling::class)->reconcile($organization));
    }
}
