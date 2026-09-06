<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Domain\Authorization\Enums\OrganizationRoleName;
use App\Domain\Authorization\Models\PlatformRole;
use App\Domain\Authorization\Models\Role;
use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Devices\Permissions\DevicePermission;
use Illuminate\Database\Seeder;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\PermissionRegistrar;

final class DevicePermissionSeeder extends Seeder
{
    public function run(): void
    {
        $registrar = app(PermissionRegistrar::class);
        $previous = $registrar->getPermissionsTeamId();
        foreach ([...DevicePermission::cases(), PlatformAdministrationPermission::MANAGE_RETENTION] as $permission) {
            Permission::firstOrCreate(['name' => $permission->value, 'guard_name' => 'web'], ['group' => $permission::getPermissionGroup()]);
        }
        $registrar->forgetCachedPermissions();
        $platformPermission = Permission::where('name', PlatformAdministrationPermission::MANAGE_RETENTION->value)->where('guard_name', 'web')->firstOrFail();
        PlatformRole::where('key', 'platform-administrator')->where('is_system', true)->each(function ($role) use ($platformPermission): void {
            $role->permissions()->syncWithoutDetaching([$platformPermission->id]);
        });
        try {
            Role::whereNotNull('organization_id')->where('is_default', true)->where('guard_name', 'web')
                ->whereIn('name', array_column(OrganizationRoleName::cases(), 'value'))->each(function (Role $role) use ($registrar): void {
                    $registrar->setPermissionsTeamId($role->organization_id);
                    $role->givePermissionTo(array_values(array_intersect(OrganizationRoleName::from($role->name)->permissions(), array_column(DevicePermission::cases(), 'value'))));
                });
        } finally {
            $registrar->setPermissionsTeamId($previous);
            $registrar->forgetCachedPermissions();
        }
    }
}
