<?php

declare(strict_types=1);

namespace App\Domain\Entities\Services;

use App\Domain\Administration\Services\OrganizationPermissionCeiling;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Entities\Permissions\EntityPermission;
use App\Domain\Entities\Permissions\EntityTypePermission;
use App\Domain\Shared\Models\Organization;
use Illuminate\Support\Facades\DB;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\PermissionRegistrar;

/**
 * Adds the entity permissions (spec 009, FR-018, research R14) without anyone gaining
 * or losing anything: whoever could view devices can view the hierarchy, and whoever
 * could manage devices (who manage sites today) can manage entities and types. Grants
 * are copied for every role, direct grant and restricted ceiling, as the dashboard
 * permissions were (DashboardPermissionBackfill). Idempotent.
 */
final class EntityPermissionBackfill
{
    private const CARRY_OVER = [
        DevicePermission::VIEW->value => [EntityPermission::VIEW],
        DevicePermission::MANAGE->value => [EntityPermission::MANAGE, EntityTypePermission::MANAGE],
    ];

    public function run(): void
    {
        $registrar = app(PermissionRegistrar::class);
        // Every guard but the agent guard, as PermissionSeeder does: agents act with the person's web permissions.
        $guards = array_values(array_diff(array_keys(config('auth.guards')), ['mcp']));
        $ids = [];
        foreach ([...EntityPermission::cases(), ...EntityTypePermission::cases()] as $permission) {
            foreach ($guards as $guard) {
                $id = Permission::query()->firstOrCreate(
                    ['name' => $permission->value, 'guard_name' => $guard],
                    ['group' => $permission::getPermissionGroup()],
                )->id;
                if ($guard === 'web') {
                    $ids[$permission->value] = $id;
                }
            }
        }

        foreach (self::CARRY_OVER as $device => $entities) {
            $old = Permission::query()->where('name', $device)->where('guard_name', 'web')->value('id');
            if (! $old) {
                continue;
            }
            foreach (['role_has_permissions', 'model_has_permissions', 'organization_permission'] as $table) {
                foreach (DB::table($table)->where('permission_id', $old)->get() as $row) {
                    foreach ($entities as $permission) {
                        DB::table($table)->insertOrIgnore([...(array) $row, 'permission_id' => $ids[$permission->value]]);
                    }
                }
            }
        }
        $registrar->forgetCachedPermissions();

        // Organization Admin equals the ceiling: unrestricted ceilings take the new permissions from
        // the catalogue, restricted ones from the rows copied above.
        Organization::query()
            ->each(fn (Organization $organization) => app(OrganizationPermissionCeiling::class)->reconcile($organization));
        $registrar->forgetCachedPermissions();
    }
}
