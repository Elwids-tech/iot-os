<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Services;

use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Permissions\DeviceProfilePermission;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Spatie\Permission\Exceptions\PermissionDoesNotExist;
use Spatie\Permission\PermissionRegistrar;

final class DeviceProfileAuthorization
{
    public function capabilities(User $user, Organization $organization): array
    {
        $registrar = app(PermissionRegistrar::class);
        $previous = $registrar->getPermissionsTeamId();
        $registrar->setPermissionsTeamId($organization->getKey());
        $user->unsetRelation('roles')->unsetRelation('permissions');
        try {
            $member = $user->is_super_admin || $user->organizations()->whereKey($organization->getKey())->exists();
            $capabilities = [];
            foreach (DeviceProfilePermission::cases() as $permission) {
                if ($permission === DeviceProfilePermission::MANAGE_TRANSPORT_BINDINGS) {
                    continue;
                }
                try {
                    $capabilities[strtolower($permission->name)] = $member && ($user->is_super_admin || $user->hasPermissionTo($permission->value));
                } catch (PermissionDoesNotExist) {
                    $capabilities[strtolower($permission->name)] = false;
                }
            }

            return $capabilities;
        } finally {
            $registrar->setPermissionsTeamId($previous);
            $user->unsetRelation('roles')->unsetRelation('permissions');
        }
    }

    public function authorize(User $user, DeviceProfilePermission $permission): void
    {
        abort_unless($user->is_super_admin || $user->hasPermissionTo($permission->value), 403);
    }

    public function ensureOrganizationProfile(DeviceProfile $profile, Organization $organization): void
    {
        abort_unless($profile->organization_id === $organization->getKey(), 404);
    }
}
