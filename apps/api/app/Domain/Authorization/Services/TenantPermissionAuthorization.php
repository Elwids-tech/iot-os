<?php

declare(strict_types=1);

namespace App\Domain\Authorization\Services;

use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use BackedEnum;
use Closure;
use Spatie\Permission\Exceptions\PermissionDoesNotExist;
use Spatie\Permission\PermissionRegistrar;

final class TenantPermissionAuthorization
{
    public function allows(User $user, Organization $organization, BackedEnum|string $permission): bool
    {
        if ($user->is_super_admin) {
            return true;
        }

        if (! $user->organizations()->whereKey($organization->getKey())->exists()) {
            return false;
        }

        $permissionName = $permission instanceof BackedEnum ? (string) $permission->value : $permission;

        try {
            return $this->withinOrganization(
                $organization,
                static fn (): bool => $user->fresh()->hasPermissionTo($permissionName),
            );
        } catch (PermissionDoesNotExist) {
            return false;
        }
    }

    /**
     * @template TResult
     *
     * @param  Closure(): TResult  $callback
     * @return TResult
     */
    public function withinOrganization(Organization $organization, Closure $callback): mixed
    {
        $registrar = app(PermissionRegistrar::class);
        $previousTeamId = $registrar->getPermissionsTeamId();
        $registrar->setPermissionsTeamId($organization->getKey());

        try {
            return $callback();
        } finally {
            $registrar->setPermissionsTeamId($previousTeamId);
        }
    }
}
