<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Domain\Authorization\Enums\OrganizationRoleName;
use App\Domain\Authorization\Models\Role;
use App\Domain\DeviceProfiles\Permissions\DeviceProfilePermission;
use Illuminate\Database\Seeder;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\PermissionRegistrar;

/** Add Studio grants to built-in tenant roles without reseeding accounts or revoking permissions. */
final class DeviceProfilePermissionSeeder extends Seeder
{
    public function run(): void
    {
        $registrar = app(PermissionRegistrar::class);
        $previousTeam = $registrar->getPermissionsTeamId();
        $profilePermissions = array_map(fn ($permission): string => $permission->value, DeviceProfilePermission::cases());

        foreach (DeviceProfilePermission::cases() as $permission) {
            Permission::query()->firstOrCreate(
                ['name' => $permission->value, 'guard_name' => 'web'],
                ['group' => DeviceProfilePermission::getPermissionGroup()],
            );
        }
        $registrar->forgetCachedPermissions();

        try {
            Role::query()->whereNotNull('organization_id')->where('is_default', true)
                ->where('guard_name', 'web')->whereIn('name', array_column(OrganizationRoleName::cases(), 'value'))
                ->each(function (Role $role) use ($registrar, $profilePermissions): void {
                    $registrar->setPermissionsTeamId($role->organization_id);
                    $role->givePermissionTo(array_values(array_intersect(
                        OrganizationRoleName::from($role->name)->permissions(), $profilePermissions,
                    )));
                });
        } finally {
            $registrar->setPermissionsTeamId($previousTeam);
            $registrar->forgetCachedPermissions();
        }
    }
}
