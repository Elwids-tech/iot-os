<?php

declare(strict_types=1);

namespace App\Domain\Administration\Services;

use App\Domain\Authorization\Enums\OrganizationRoleName;
use App\Domain\Authorization\Models\Role;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

final class OrganizationMembershipManager
{
    public function __construct(
        private readonly OrganizationAdministrationAuthorization $authorization,
        private readonly OrganizationRoleManager $roleManager,
    ) {}

    /**
     * @param  list<int>  $roleIds
     */
    public function syncRoles(Organization $organization, User $user, array $roleIds): void
    {
        $this->ensureMembership($organization, $user);
        $roles = $this->roleManager->rolesFor($organization, $roleIds);

        $administratorRole = $this->administratorRole($organization);

        if ($this->hasRole($organization, $user, $administratorRole)
            && ! $roles->contains($administratorRole)
            && ! $this->hasAnotherAdministrator($organization, $user, $administratorRole)) {
            throw ValidationException::withMessages([
                'role_ids' => 'Assign Organization Admin to another member before removing it from the final administrator.',
            ]);
        }

        $this->authorization->withinOrganization($organization, function () use ($user, $roles): void {
            $user->syncRoles($roles);
        });
    }

    public function remove(Organization $organization, User $user): void
    {
        $this->ensureMembership($organization, $user);
        $administratorRole = $this->administratorRole($organization);

        if ($this->hasRole($organization, $user, $administratorRole)
            && ! $this->hasAnotherAdministrator($organization, $user, $administratorRole)) {
            throw ValidationException::withMessages([
                'member' => 'An organization must retain at least one Organization Admin.',
            ]);
        }

        $this->authorization->withinOrganization($organization, function () use ($organization, $user): void {
            $user->syncRoles([]);
            $organization->users()->detach($user->getKey());
        });
    }

    private function ensureMembership(Organization $organization, User $user): void
    {
        if (! $organization->users()->whereKey($user->getKey())->exists()) {
            abort(404, 'Organization member not found.');
        }
    }

    private function administratorRole(Organization $organization): Role
    {
        return Role::query()
            ->where('organization_id', $organization->getKey())
            ->where('name', OrganizationRoleName::ORGANIZATION_ADMIN->value)
            ->firstOrFail();
    }

    private function hasRole(Organization $organization, User $user, Role $role): bool
    {
        return DB::table(config('permission.table_names.model_has_roles'))
            ->where('organization_id', $organization->getKey())
            ->where('model_id', $user->getKey())
            ->where('model_type', $user::class)
            ->where('role_id', $role->getKey())
            ->exists();
    }

    private function hasAnotherAdministrator(Organization $organization, User $user, Role $role): bool
    {
        return DB::table(config('permission.table_names.model_has_roles'))
            ->where('organization_id', $organization->getKey())
            ->where('model_type', $user::class)
            ->where('role_id', $role->getKey())
            ->where('model_id', '!=', $user->getKey())
            ->exists();
    }
}
