<?php

declare(strict_types=1);

namespace App\Domain\Administration\Services;

use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Closure;
use Illuminate\Support\Facades\Gate;
use Spatie\Permission\Exceptions\PermissionDoesNotExist;
use Spatie\Permission\PermissionRegistrar;

final class OrganizationAdministrationAuthorization
{
    public function allows(User $user, Organization $organization, string $tenantPermission): bool
    {
        if (Gate::forUser($user)->allows(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value)) {
            return true;
        }

        if (! $user->organizations()->whereKey($organization->getKey())->exists()) {
            return false;
        }

        try {
            return $this->withinOrganization(
                $organization,
                fn (): bool => $user->fresh()->hasPermissionTo($tenantPermission),
            );
        } catch (PermissionDoesNotExist) {
            return false;
        }
    }

    public function withinOrganization(Organization $organization, Closure $callback): mixed
    {
        $permissionRegistrar = app(PermissionRegistrar::class);
        $previousTeamId = $permissionRegistrar->getPermissionsTeamId();

        try {
            $permissionRegistrar->setPermissionsTeamId($organization->getKey());

            return $callback();
        } finally {
            $permissionRegistrar->setPermissionsTeamId($previousTeamId);
        }
    }
}
