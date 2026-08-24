<?php

declare(strict_types=1);

namespace App\Domain\Administration\Services;

use App\Domain\Authorization\Enums\OrganizationRoleName;
use App\Domain\Authorization\Models\Role;
use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Support\Arr;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Spatie\Permission\Models\Permission;

final class OrganizationRoleManager
{
    public function __construct(private readonly OrganizationAdministrationAuthorization $authorization) {}

    /**
     * @param  list<int>  $roleIds
     * @return Collection<int, Role>
     */
    public function rolesFor(Organization $organization, array $roleIds): Collection
    {
        $roleIds = array_values(array_unique(array_map('intval', $roleIds)));

        if ($roleIds === []) {
            throw ValidationException::withMessages(['role_ids' => 'Select at least one organization role.']);
        }

        $roles = Role::query()
            ->where('organization_id', $organization->getKey())
            ->whereIn('id', $roleIds)
            ->get();

        if ($roles->count() !== count($roleIds)) {
            throw ValidationException::withMessages(['role_ids' => 'Each selected role must belong to this organization.']);
        }

        return $roles;
    }

    /**
     * @param  list<int>  $roleIds
     */
    public function syncMemberRoles(Organization $organization, User $user, array $roleIds): void
    {
        $roles = $this->rolesFor($organization, $roleIds);

        $this->authorization->withinOrganization($organization, function () use ($user, $roles): void {
            $user->syncRoles($roles);
        });
    }

    /**
     * @param  list<string>  $permissionNames
     */
    public function create(Organization $organization, string $displayName, array $permissionNames): Role
    {
        $role = Role::query()->create([
            'organization_id' => $organization->getKey(),
            'name' => sprintf('custom-%s', Str::lower((string) Str::ulid())),
            'display_name' => $this->displayName($organization, $displayName),
            'is_default' => false,
            'guard_name' => 'web',
        ]);

        $role->syncPermissions($this->tenantPermissions($permissionNames));

        return $role->load('permissions');
    }

    /**
     * @param  list<string>  $permissionNames
     */
    public function update(Role $role, string $displayName, array $permissionNames): Role
    {
        $organization = $role->organization;

        if ($organization === null) {
            throw ValidationException::withMessages(['role' => 'Platform roles cannot be changed as organization roles.']);
        }

        if ($role->name === OrganizationRoleName::ORGANIZATION_ADMIN->value) {
            $currentPermissionNames = $role->permissions()->pluck('name')->sort()->values()->all();
            $updatedPermissionNames = collect($permissionNames)->sort()->values()->all();

            if ($currentPermissionNames !== $updatedPermissionNames) {
                throw ValidationException::withMessages([
                    'permission_names' => 'The Organization Admin permission baseline cannot be changed. Create a custom role for a different permission bundle.',
                ]);
            }
        }

        $role->forceFill([
            'display_name' => $this->displayName($organization, $displayName, $role->getKey()),
        ])->save();
        $role->syncPermissions($this->tenantPermissions($permissionNames));

        return $role->fresh(['permissions']);
    }

    public function delete(Role $role): void
    {
        if ($role->is_default) {
            throw ValidationException::withMessages(['role' => 'Default organization roles cannot be deleted.']);
        }

        if (DB::table(config('permission.table_names.model_has_roles'))->where('role_id', $role->getKey())->exists()) {
            throw ValidationException::withMessages(['role' => 'Remove this role from members before deleting it.']);
        }

        if (DB::table('organization_invitations')
            ->whereNull('accepted_at')
            ->whereNull('revoked_at')
            ->whereJsonContains('role_ids', $role->getKey())
            ->exists()) {
            throw ValidationException::withMessages(['role' => 'Revoke pending invitations that use this role before deleting it.']);
        }

        $role->delete();
    }

    /**
     * @return Collection<int, Permission>
     */
    public function tenantPermissions(array $permissionNames): Collection
    {
        $permissionNames = array_values(array_unique(Arr::wrap($permissionNames)));

        $permissions = Permission::query()
            ->where('guard_name', 'web')
            ->whereNotIn('name', $this->platformPermissionNames())
            ->whereIn('name', $permissionNames)
            ->get();

        if ($permissions->count() !== count($permissionNames)) {
            throw ValidationException::withMessages(['permission_names' => 'A selected permission is not available to organization roles.']);
        }

        return $permissions;
    }

    private function displayName(Organization $organization, string $displayName, ?int $exceptRoleId = null): string
    {
        $displayName = trim($displayName);

        $query = Role::query()
            ->where('organization_id', $organization->getKey())
            ->where('display_name', $displayName);

        if ($exceptRoleId !== null) {
            $query->whereKeyNot($exceptRoleId);
        }

        if ($query->exists()) {
            throw ValidationException::withMessages(['display_name' => 'A role with this name already exists in the organization.']);
        }

        return $displayName;
    }

    /**
     * @return list<string>
     */
    private function platformPermissionNames(): array
    {
        return array_map(
            static fn (PlatformAdministrationPermission $permission): string => $permission->value,
            PlatformAdministrationPermission::cases(),
        );
    }
}
