<?php

declare(strict_types=1);

namespace App\Domain\Administration\Services;

use App\Domain\Authorization\Enums\OrganizationRoleName;
use App\Domain\Authorization\Models\Role;
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
    private const ADMINISTRATOR_BASELINE_MESSAGE = 'Organization Admin always has every permission available to this organization. Create a custom role for a different permission bundle.';

    public function __construct(
        private readonly OrganizationAdministrationAuthorization $authorization,
        private readonly OrganizationPermissionCeiling $ceiling,
        private readonly OrganizationGrants $grants,
    ) {}

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
    public function create(Organization $organization, User $actor, string $displayName, array $permissionNames): Role
    {
        $permissions = $this->tenantPermissions($organization, $permissionNames);
        $this->grants->ensurePermissions($actor, $organization, $permissions->pluck('name')->all());

        $role = Role::query()->create([
            'organization_id' => $organization->getKey(),
            'name' => sprintf('custom-%s', Str::lower((string) Str::ulid())),
            'display_name' => $this->displayName($organization, $displayName),
            'is_default' => false,
            'guard_name' => 'web',
        ]);

        $role->syncPermissions($permissions);

        return $role->load('permissions');
    }

    /**
     * @param  list<string>  $permissionNames
     */
    public function update(Role $role, User $actor, string $displayName, array $permissionNames): Role
    {
        $organization = $this->organizationOf($role);
        $this->ensureManageable($role, $actor);
        $this->ensureAdministratorBaseline($role, $permissionNames);

        $permissions = $this->tenantPermissions($organization, $permissionNames);
        $this->grants->ensurePermissions($actor, $organization, $permissions->pluck('name')->all());

        $role->forceFill([
            'display_name' => $this->displayName($organization, $displayName, $role->getKey()),
        ])->save();

        $role->syncPermissions($permissions);

        return $role->fresh(['permissions']);
    }

    /**
     * Platform administrators replace a role bundle; the organization's ceiling still applies.
     *
     * @param  list<string>  $permissionNames
     */
    public function syncPermissions(Role $role, array $permissionNames): Role
    {
        $organization = $this->organizationOf($role);
        $this->ensureAdministratorBaseline($role, $permissionNames);

        $role->syncPermissions($this->tenantPermissions($organization, $permissionNames));

        return $role->fresh(['permissions']);
    }

    public function delete(Role $role, User $actor): void
    {
        if ($role->is_default) {
            throw ValidationException::withMessages(['role' => 'Default organization roles cannot be deleted.']);
        }

        $this->ensureManageable($role, $actor);

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
     * Whether an actor with these grantable permissions could edit or delete the role
     * (expects the role's permissions to be loaded).
     *
     * @param  list<string>  $grantable
     */
    public function manageable(Role $role, array $grantable): bool
    {
        return ! $this->isAdministrator($role)
            && $this->grants->covers($grantable, $role->permissions->pluck('name'));
    }

    public function isAdministrator(Role $role): bool
    {
        return $role->name === OrganizationRoleName::ORGANIZATION_ADMIN->value;
    }

    /**
     * @param  list<string>  $permissionNames
     * @return Collection<int, Permission>
     */
    public function tenantPermissions(Organization $organization, array $permissionNames): Collection
    {
        $permissionNames = array_values(array_unique(Arr::wrap($permissionNames)));
        $permissions = $this->ceiling->permissionsFor($organization)->whereIn('name', $permissionNames)->values();

        if ($permissions->count() !== count($permissionNames)) {
            throw ValidationException::withMessages(['permission_names' => 'A selected permission is not available to this organization.']);
        }

        return $permissions;
    }

    private function organizationOf(Role $role): Organization
    {
        return $role->organization ?? throw ValidationException::withMessages([
            'role' => 'Platform roles cannot be changed as organization roles.',
        ]);
    }

    private function ensureManageable(Role $role, User $actor): void
    {
        $grantable = $this->grants->grantable($actor, $this->organizationOf($role));

        if (! $this->grants->covers($grantable, $role->permissions()->pluck('name'))) {
            throw ValidationException::withMessages([
                'role' => 'This role has permissions you do not hold, so you cannot change it.',
            ]);
        }
    }

    /**
     * Organization Admin follows the ceiling, so nobody edits its bundle directly.
     *
     * @param  list<string>  $permissionNames
     */
    private function ensureAdministratorBaseline(Role $role, array $permissionNames): void
    {
        if (! $this->isAdministrator($role)) {
            return;
        }

        $current = $role->permissions()->pluck('name')->sort()->values()->all();

        if ($current !== collect($permissionNames)->unique()->sort()->values()->all()) {
            throw ValidationException::withMessages(['permission_names' => self::ADMINISTRATOR_BASELINE_MESSAGE]);
        }
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
}
