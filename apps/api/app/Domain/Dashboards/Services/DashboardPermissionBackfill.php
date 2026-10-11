<?php

declare(strict_types=1);

namespace App\Domain\Dashboards\Services;

use App\Domain\Administration\Services\OrganizationPermissionCeiling;
use App\Domain\Authorization\Enums\OrganizationRoleName;
use App\Domain\Authorization\Models\Role;
use App\Domain\Dashboards\Permissions\DashboardPermission;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Shared\Models\Organization;
use Illuminate\Support\Facades\DB;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\PermissionRegistrar;

/**
 * Moves dashboard access off the Device permissions without anyone losing it.
 * Whoever could view devices can view dashboards; whoever could manage devices
 * can create and manage dashboards. Grants are copied for every role and
 * direct grant, including custom roles, and restricted organizations' ceilings
 * are widened the same way. Built-in roles then get the new defaults
 * (moderators create dashboards), within each organization's ceiling.
 */
final class DashboardPermissionBackfill
{
    private const CARRY_OVER = [
        DevicePermission::VIEW->value => [DashboardPermission::VIEW],
        DevicePermission::MANAGE->value => [DashboardPermission::CREATE, DashboardPermission::MANAGE],
    ];

    public function run(): void
    {
        $registrar = app(PermissionRegistrar::class);
        $ids = [];
        foreach (DashboardPermission::cases() as $permission) {
            $ids[$permission->value] = Permission::query()->firstOrCreate(
                ['name' => $permission->value, 'guard_name' => 'web'],
                ['group' => DashboardPermission::getPermissionGroup()],
            )->id;
        }

        foreach (self::CARRY_OVER as $device => $dashboards) {
            $old = Permission::query()->where('name', $device)->where('guard_name', 'web')->value('id');
            if (! $old) {
                continue;
            }
            foreach (['role_has_permissions', 'model_has_permissions', 'organization_permission'] as $table) {
                foreach (DB::table($table)->where('permission_id', $old)->get() as $row) {
                    foreach ($dashboards as $permission) {
                        DB::table($table)->insertOrIgnore([...(array) $row, 'permission_id' => $ids[$permission->value]]);
                    }
                }
            }
        }
        $registrar->forgetCachedPermissions();

        $previousTeam = $registrar->getPermissionsTeamId();
        $dashboardPermissions = array_column(DashboardPermission::cases(), 'value');
        try {
            Role::query()->whereNotNull('organization_id')->where('is_default', true)->where('guard_name', 'web')
                ->whereIn('name', array_column(OrganizationRoleName::cases(), 'value'))
                ->each(function (Role $role) use ($registrar, $dashboardPermissions): void {
                    $registrar->setPermissionsTeamId($role->organization_id);
                    $role->givePermissionTo(array_values(array_intersect(
                        OrganizationRoleName::from($role->name)->permissions(), $dashboardPermissions,
                    )));
                });
            // Defaults never push a restricted organization past its ceiling.
            Organization::query()->where('permissions_restricted', true)
                ->each(fn (Organization $organization) => app(OrganizationPermissionCeiling::class)->reconcile($organization));
        } finally {
            $registrar->setPermissionsTeamId($previousTeam);
            $registrar->forgetCachedPermissions();
        }
    }
}
