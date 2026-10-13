<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Authorization\Permissions\RolePermission;
use App\Domain\Automation\Permissions\WorkflowPermission;
use App\Domain\Dashboards\Permissions\DashboardPermission;
use App\Domain\DeviceProfiles\Permissions\DeviceProfilePermission;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Shared\Permissions\OrganizationPermission;
use App\Domain\Shared\Permissions\UserPermission;
use Illuminate\Database\Seeder;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\PermissionRegistrar;

class PermissionSeeder extends Seeder
{
    public function run(): void
    {
        /** @var array<string, array<int, \BackedEnum>> $permissionGroups */
        $permissionGroups = [
            OrganizationPermission::getPermissionGroup() => OrganizationPermission::cases(),
            UserPermission::getPermissionGroup() => UserPermission::cases(),
            RolePermission::getPermissionGroup() => RolePermission::cases(),
            DeviceProfilePermission::getPermissionGroup() => DeviceProfilePermission::cases(),
            DevicePermission::getPermissionGroup() => DevicePermission::cases(),
            WorkflowPermission::getPermissionGroup() => WorkflowPermission::cases(),
            DashboardPermission::getPermissionGroup() => DashboardPermission::cases(),
            PlatformAdministrationPermission::getPermissionGroup() => PlatformAdministrationPermission::cases(),
        ];
        // The agent guard carries no roles: agents act with the person's web permissions.
        $guards = array_values(array_diff(array_keys(config('auth.guards')), ['mcp']));

        foreach ($permissionGroups as $group => $permissions) {
            foreach ($permissions as $permission) {
                foreach ($guards as $guard) {
                    Permission::query()->updateOrCreate(
                        [
                            'name' => $permission->value,
                            'guard_name' => $guard,
                        ],
                        ['group' => $group],
                    );
                }
            }
        }

        app(PermissionRegistrar::class)->forgetCachedPermissions();
    }
}
