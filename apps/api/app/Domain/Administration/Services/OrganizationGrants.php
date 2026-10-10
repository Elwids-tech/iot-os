<?php

declare(strict_types=1);

namespace App\Domain\Administration\Services;

use App\Domain\Authorization\Models\Role;
use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Authorization\Permissions\RolePermission;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use App\Domain\Shared\Permissions\UserPermission;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

/**
 * No-escalation rules: an actor can only hand out permissions that are inside the
 * organization's ceiling and that they hold themselves in that organization.
 * Platform administrators can grant the whole ceiling.
 */
final class OrganizationGrants
{
    public function __construct(private readonly OrganizationPermissionCeiling $ceiling) {}

    /**
     * @return list<string>
     */
    public function grantable(User $actor, Organization $organization): array
    {
        $ceiling = $this->ceiling->namesFor($organization);

        if (Gate::forUser($actor)->allows(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value)) {
            return $ceiling;
        }

        return array_values(array_intersect($ceiling, $this->heldBy($actor, $organization)));
    }

    /**
     * What the user may do in the portal's member and role screens, from one permission load.
     *
     * @return array<string, bool>
     */
    public function capabilities(User $user, Organization $organization): array
    {
        $map = [
            'members_view' => UserPermission::VIEW_ANY,
            'invite' => UserPermission::CREATE,
            'members_update' => UserPermission::UPDATE,
            'members_remove' => UserPermission::DELETE,
            'roles_view' => RolePermission::VIEW_ANY,
            'roles_create' => RolePermission::CREATE,
            'roles_update' => RolePermission::UPDATE,
            'roles_delete' => RolePermission::DELETE,
        ];

        if (Gate::forUser($user)->allows(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value)) {
            return array_map(static fn (): bool => true, $map);
        }

        $held = $this->heldBy($user, $organization);

        return array_map(static fn (UserPermission|RolePermission $permission): bool => in_array($permission->value, $held, true), $map);
    }

    /**
     * Permissions a user holds in the organization through roles or direct grants.
     *
     * @return list<string>
     */
    public function heldBy(User $user, Organization $organization): array
    {
        $tables = config('permission.table_names');
        $teamKey = config('permission.column_names.team_foreign_key');

        $throughRoles = DB::table($tables['model_has_roles'].' as assignment')
            ->join($tables['role_has_permissions'].' as grant', 'grant.role_id', '=', 'assignment.role_id')
            ->join($tables['permissions'].' as permission', 'permission.id', '=', 'grant.permission_id')
            ->where('assignment.'.$teamKey, $organization->getKey())
            ->where('assignment.model_type', $user->getMorphClass())
            ->where('assignment.model_id', $user->getKey())
            ->where('permission.guard_name', 'web')
            ->select('permission.name');

        return DB::table($tables['model_has_permissions'].' as direct')
            ->join($tables['permissions'].' as permission', 'permission.id', '=', 'direct.permission_id')
            ->where('direct.'.$teamKey, $organization->getKey())
            ->where('direct.model_type', $user->getMorphClass())
            ->where('direct.model_id', $user->getKey())
            ->where('permission.guard_name', 'web')
            ->select('permission.name')
            ->union($throughRoles)
            ->pluck('name')
            ->unique()
            ->values()
            ->all();
    }

    /**
     * @param  iterable<string>  $permissionNames
     * @param  list<string>  $grantable
     */
    public function covers(array $grantable, iterable $permissionNames): bool
    {
        foreach ($permissionNames as $name) {
            if (! in_array($name, $grantable, true)) {
                return false;
            }
        }

        return true;
    }

    /**
     * @param  list<string>  $permissionNames
     */
    public function ensurePermissions(User $actor, Organization $organization, array $permissionNames): void
    {
        if (! $this->covers($this->grantable($actor, $organization), $permissionNames)) {
            throw ValidationException::withMessages([
                'permission_names' => 'You can only grant permissions that this organization allows and that you hold yourself.',
            ]);
        }
    }

    /**
     * @param  Collection<int, Role>  $roles
     */
    public function ensureRoles(User $actor, Organization $organization, Collection $roles, string $field = 'role_ids'): void
    {
        $grantable = $this->grantable($actor, $organization);

        foreach ($roles as $role) {
            if (! $this->covers($grantable, $role->permissions()->pluck('name')->all())) {
                throw ValidationException::withMessages([
                    $field => sprintf('%s includes permissions you cannot grant.', $role->display_name),
                ]);
            }
        }
    }

    /**
     * Nobody can change or remove a member who has access they do not hold themselves.
     */
    public function ensureMember(User $actor, Organization $organization, User $member, string $field = 'member'): void
    {
        if (! $this->covers($this->grantable($actor, $organization), $this->heldBy($member, $organization))) {
            throw ValidationException::withMessages([
                $field => 'This member has permissions you do not hold, so you cannot change their access.',
            ]);
        }
    }
}
