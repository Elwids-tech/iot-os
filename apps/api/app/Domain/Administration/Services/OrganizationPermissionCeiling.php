<?php

declare(strict_types=1);

namespace App\Domain\Administration\Services;

use App\Domain\Audit\Services\ActivityChanges;
use App\Domain\Audit\Services\ActivityLog;
use App\Domain\Authorization\Enums\OrganizationRoleName;
use App\Domain\Authorization\Models\Role;
use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\PermissionRegistrar;

/**
 * The tenant permissions an organization may grant. Unrestricted organizations get the
 * whole tenant catalogue; restricted ones only what a platform administrator selected.
 * Organization Admin always holds exactly the ceiling.
 */
final class OrganizationPermissionCeiling
{
    /**
     * Every permission an organization role could hold: web-guard permissions except platform administration.
     *
     * @return Collection<int, Permission>
     */
    public function catalogue(): Collection
    {
        return Permission::query()
            ->where('guard_name', 'web')
            ->whereNotIn('name', array_map(
                static fn (PlatformAdministrationPermission $permission): string => $permission->value,
                PlatformAdministrationPermission::cases(),
            ))
            ->orderBy('group')
            ->orderBy('name')
            ->get();
    }

    /**
     * @return Collection<int, Permission>
     */
    public function permissionsFor(Organization $organization): Collection
    {
        $catalogue = $this->catalogue();

        if (! $organization->permissions_restricted) {
            return $catalogue;
        }

        $allowed = $organization->permissions()->pluck('permissions.id')->all();

        return $catalogue->whereIn('id', $allowed)->values();
    }

    /**
     * @return list<string>
     */
    public function namesFor(Organization $organization): array
    {
        return $this->permissionsFor($organization)->pluck('name')->values()->all();
    }

    /**
     * Narrowing strips the removed permissions from every role in the organization.
     *
     * @param  list<string>  $permissionNames
     */
    public function update(Organization $organization, bool $restricted, array $permissionNames, ?User $actor = null): void
    {
        $permissions = collect();

        if ($restricted) {
            $permissionNames = array_values(array_unique($permissionNames));
            $permissions = $this->catalogue()->whereIn('name', $permissionNames)->values();

            if ($permissions->count() !== count($permissionNames)) {
                throw ValidationException::withMessages([
                    'permission_names' => 'A selected permission is not available to organizations.',
                ]);
            }
        }

        DB::transaction(function () use ($organization, $restricted, $permissions, $actor): void {
            Organization::query()->whereKey($organization->getKey())->lockForUpdate()->first();
            $before = $this->ceilingOf($organization);

            $organization->forceFill(['permissions_restricted' => $restricted])->save();
            $organization->permissions()->sync($restricted ? $permissions->modelKeys() : []);

            $this->reconcile($organization);

            $changes = ActivityChanges::between($before, $this->ceilingOf($organization));
            if ($changes !== []) {
                ActivityLog::record('organization.permissions_updated', $organization, $actor, $organization, [], $changes);
            }
        });
    }

    /**
     * @return array{restricted: bool, permissions: list<string>}
     */
    private function ceilingOf(Organization $organization): array
    {
        return [
            'restricted' => (bool) $organization->permissions_restricted,
            'permissions' => $organization->permissions()->orderBy('name')->pluck('name')->map(fn (mixed $name): string => (string) $name)->all(),
        ];
    }

    /**
     * Keep every role inside the ceiling and Organization Admin equal to it.
     */
    public function reconcile(Organization $organization): void
    {
        $allowed = $this->permissionsFor($organization);
        $roleIds = Role::query()->where('organization_id', $organization->getKey())->pluck('id');

        DB::table(config('permission.table_names.role_has_permissions'))
            ->whereIn('role_id', $roleIds)
            ->whereNotIn('permission_id', $allowed->modelKeys())
            ->delete();

        Role::query()
            ->where('organization_id', $organization->getKey())
            ->where('name', OrganizationRoleName::ORGANIZATION_ADMIN->value)
            ->first()
            ?->syncPermissions($allowed);

        app(PermissionRegistrar::class)->forgetCachedPermissions();
    }
}
