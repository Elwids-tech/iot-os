<?php

declare(strict_types=1);

namespace App\Domain\Administration\Services;

use App\Domain\Authorization\Enums\OrganizationRoleName;
use App\Domain\Authorization\Models\Role;
use App\Domain\Shared\Models\Organization;
use Illuminate\Support\Collection;

/**
 * Every organization needs the built-in roles before anyone can be invited into it.
 */
final class OrganizationDefaultRoles
{
    public function __construct(private readonly OrganizationPermissionCeiling $ceiling) {}

    /**
     * Create missing built-in roles inside the ceiling. Existing roles keep their bundles.
     *
     * @return Collection<string, Role> keyed by role name
     */
    public function ensure(Organization $organization): Collection
    {
        $allowed = $this->ceiling->namesFor($organization);

        return collect(OrganizationRoleName::cases())->mapWithKeys(function (OrganizationRoleName $name) use ($organization, $allowed): array {
            $role = Role::query()->firstOrCreate(
                ['organization_id' => $organization->getKey(), 'name' => $name->value, 'guard_name' => 'web'],
                ['display_name' => $name->displayName(), 'is_default' => true],
            );

            if ($role->wasRecentlyCreated) {
                $role->syncPermissions($name === OrganizationRoleName::ORGANIZATION_ADMIN
                    ? $allowed
                    : array_values(array_intersect($name->permissions(), $allowed)));
            }

            return [$name->value => $role];
        });
    }
}
