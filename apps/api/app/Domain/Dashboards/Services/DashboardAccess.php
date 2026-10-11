<?php

declare(strict_types=1);

namespace App\Domain\Dashboards\Services;

use App\Domain\Dashboards\Models\Dashboard;
use App\Domain\Dashboards\Permissions\DashboardPermission;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Spatie\Permission\Exceptions\PermissionDoesNotExist;
use Spatie\Permission\PermissionRegistrar;

/**
 * Who may open, edit, share and delete each dashboard.
 *
 * - Dashboard.view is the floor: without it nothing is visible.
 * - Dashboard.manage opens, edits, shares and deletes every dashboard.
 * - The owner (creator) can edit, share and delete their dashboard.
 * - An organization dashboard opens for everyone with Dashboard.view; a
 *   restricted one only for its owner, managers and the members and roles it
 *   is shared with. A share grants view or edit, never share or delete.
 */
final class DashboardAccess
{
    public const ORGANIZATION = 'organization';

    public const RESTRICTED = 'restricted';

    /**
     * @return array{view: bool, create: bool, manage: bool}
     */
    public function capabilities(User $user, Organization $organization): array
    {
        $registrar = app(PermissionRegistrar::class);
        $previous = $registrar->getPermissionsTeamId();
        $registrar->setPermissionsTeamId($organization->id);
        $user->unsetRelation('roles')->unsetRelation('permissions');
        try {
            $member = $user->is_super_admin || $user->organizations()->whereKey($organization->id)->exists();
            $result = [];
            foreach (DashboardPermission::cases() as $permission) {
                try {
                    $result[strtolower($permission->name)] = $member && ($user->is_super_admin || $user->hasPermissionTo($permission->value));
                } catch (PermissionDoesNotExist) {
                    $result[strtolower($permission->name)] = false;
                }
            }

            return $result;
        } finally {
            $registrar->setPermissionsTeamId($previous);
            $user->unsetRelation('roles')->unsetRelation('permissions');
        }
    }

    /**
     * @return array{view: bool, edit: bool, share: bool, delete: bool}
     */
    public function abilities(User $user, Organization $organization, Dashboard $dashboard): array
    {
        return $this->abilitiesWith($user, $this->capabilities($user, $organization), $dashboard, $this->sharedLevels($user, $organization, [$dashboard->id])[$dashboard->id] ?? null);
    }

    /**
     * The dashboards of an organization this person can open, each with their abilities.
     *
     * @param  Collection<int, Dashboard>  $dashboards
     * @return Collection<int, array{dashboard: Dashboard, abilities: array{view: bool, edit: bool, share: bool, delete: bool}}>
     */
    public function visible(User $user, Organization $organization, Collection $dashboards): Collection
    {
        $capabilities = $this->capabilities($user, $organization);
        $levels = $this->sharedLevels($user, $organization, $dashboards->modelKeys());

        return $dashboards
            ->map(fn (Dashboard $dashboard) => ['dashboard' => $dashboard, 'abilities' => $this->abilitiesWith($user, $capabilities, $dashboard, $levels[$dashboard->id] ?? null)])
            ->filter(fn (array $entry) => $entry['abilities']['view'])
            ->values();
    }

    /**
     * @param  array{view: bool, create: bool, manage: bool}  $capabilities
     * @return array{view: bool, edit: bool, share: bool, delete: bool}
     */
    private function abilitiesWith(User $user, array $capabilities, Dashboard $dashboard, ?string $shared): array
    {
        if (! $capabilities['view']) {
            return ['view' => false, 'edit' => false, 'share' => false, 'delete' => false];
        }
        if ($capabilities['manage']) {
            return ['view' => true, 'edit' => true, 'share' => true, 'delete' => true];
        }
        $owner = $dashboard->created_by !== null && $dashboard->created_by === $user->id;
        $view = $owner || $dashboard->access !== self::RESTRICTED || $shared !== null;

        return ['view' => $view, 'edit' => $view && ($owner || $shared === 'edit'), 'share' => $owner, 'delete' => $owner];
    }

    /**
     * The strongest level each dashboard is shared with this person, directly or through a role.
     *
     * @param  list<int>  $dashboardIds
     * @return array<int, 'view'|'edit'>
     */
    private function sharedLevels(User $user, Organization $organization, array $dashboardIds): array
    {
        if ($dashboardIds === []) {
            return [];
        }
        $roles = DB::table(config('permission.table_names.model_has_roles'))
            ->where('model_type', $user->getMorphClass())->where('model_id', $user->id)
            ->where(config('permission.column_names.team_foreign_key'), $organization->id)->pluck('role_id');
        $levels = [];
        DB::table('dashboard_shares')->whereIn('dashboard_id', $dashboardIds)
            ->where(fn ($query) => $query->where('user_id', $user->id)->orWhereIn('role_id', $roles))
            ->get(['dashboard_id', 'level'])
            ->each(function (object $share) use (&$levels): void {
                if (($levels[$share->dashboard_id] ?? null) !== 'edit') {
                    $levels[$share->dashboard_id] = $share->level;
                }
            });

        return $levels;
    }
}
