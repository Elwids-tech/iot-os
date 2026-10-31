<?php

declare(strict_types=1);

namespace App\Domain\Administration\Services;

use App\Domain\Agents\Services\ConnectionRevoker;
use App\Domain\Audit\Services\ActivityChanges;
use App\Domain\Audit\Services\ActivityLog;
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
        private readonly OrganizationGrants $grants,
    ) {}

    /**
     * @param  list<int>  $roleIds
     */
    public function syncRoles(Organization $organization, User $actor, User $user, array $roleIds): void
    {
        $this->ensureMembership($organization, $user);
        $roles = $this->roleManager->rolesFor($organization, $roleIds);
        $this->grants->ensureMember($actor, $organization, $user, 'role_ids');
        $this->grants->ensureRoles($actor, $organization, $roles);

        // The organization row lock serializes concurrent demotions of the final administrator.
        DB::transaction(function () use ($organization, $actor, $user, $roles): void {
            $this->lock($organization);
            $administratorRole = $this->administratorRole($organization);
            $before = $this->roleNames($organization, $user);

            if ($administratorRole !== null
                && $this->hasRole($organization, $user, $administratorRole)
                && ! $roles->contains($administratorRole)
                && ! $this->hasAnotherAdministrator($organization, $user, $administratorRole)) {
                throw ValidationException::withMessages([
                    'role_ids' => 'Assign Organization Admin to another member before removing it from the final administrator.',
                ]);
            }

            $this->authorization->withinOrganization($organization, function () use ($user, $roles): void {
                $user->syncRoles($roles);
            });

            $changes = ActivityChanges::between(['roles' => $before], ['roles' => $this->roleNames($organization, $user)]);
            if ($changes !== []) {
                ActivityLog::record('organization.member.roles_changed', $organization, $actor, $user, ['user_id' => $user->getKey()], $changes);
            }
        });
    }

    public function remove(Organization $organization, User $actor, User $user): void
    {
        $this->ensureMembership($organization, $user);
        $this->grants->ensureMember($actor, $organization, $user);

        DB::transaction(function () use ($organization, $user, $actor): void {
            $this->lock($organization);
            $administratorRole = $this->administratorRole($organization);

            if ($administratorRole !== null
                && $this->hasRole($organization, $user, $administratorRole)
                && ! $this->hasAnotherAdministrator($organization, $user, $administratorRole)) {
                throw ValidationException::withMessages([
                    'member' => 'An organization must retain at least one Organization Admin.',
                ]);
            }

            $this->authorization->withinOrganization($organization, function () use ($organization, $user): void {
                $user->syncRoles([]);
                $organization->users()->detach($user->getKey());
            });
            app(ConnectionRevoker::class)->member($user, $organization, $actor);
            ActivityLog::record('organization.member.removed', $organization, $actor, $user, ['user_id' => $user->getKey(), 'email' => $user->email]);
        });
    }

    private function ensureMembership(Organization $organization, User $user): void
    {
        if (! $organization->users()->whereKey($user->getKey())->exists()) {
            abort(404, 'Organization member not found.');
        }
    }

    private function lock(Organization $organization): void
    {
        Organization::query()->whereKey($organization->getKey())->lockForUpdate()->first();
    }

    private function administratorRole(Organization $organization): ?Role
    {
        return Role::query()
            ->where('organization_id', $organization->getKey())
            ->where('name', OrganizationRoleName::ORGANIZATION_ADMIN->value)
            ->first();
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

    /**
     * The member's role names in this organization, sorted, for the activity log.
     *
     * @return list<string>
     */
    private function roleNames(Organization $organization, User $user): array
    {
        return DB::table(config('permission.table_names.model_has_roles').' as assigned')
            ->join('roles', 'roles.id', '=', 'assigned.role_id')
            ->where('assigned.organization_id', $organization->getKey())
            ->where('assigned.model_id', $user->getKey())
            ->where('assigned.model_type', $user::class)
            ->orderBy('roles.display_name')
            ->pluck('roles.display_name')
            ->map(fn (mixed $name): string => (string) $name)
            ->all();
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
