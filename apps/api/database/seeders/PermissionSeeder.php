<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Domain\Authorization\Permissions\RolePermission;
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
        ];
        $guards = array_keys(config('auth.guards'));

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
