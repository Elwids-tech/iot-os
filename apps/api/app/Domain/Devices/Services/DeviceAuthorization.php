<?php

declare(strict_types=1);

namespace App\Domain\Devices\Services;

use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Database\Eloquent\Model;
use Spatie\Permission\Exceptions\PermissionDoesNotExist;
use Spatie\Permission\PermissionRegistrar;

final class DeviceAuthorization
{
    public function capabilities(User $user, Organization $organization): array
    {
        $registrar = app(PermissionRegistrar::class);
        $previous = $registrar->getPermissionsTeamId();
        $registrar->setPermissionsTeamId($organization->id);
        $user->unsetRelation('roles')->unsetRelation('permissions');
        try {
            $member = $user->is_super_admin || $user->organizations()->whereKey($organization->id)->exists();
            $result = [];
            foreach (DevicePermission::cases() as $permission) {
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

    public function authorize(User $user, DevicePermission $permission, Organization $organization, ?Model $resource = null): void
    {
        if ($resource) {
            abort_unless($resource->organization_id === $organization->id, 404);
        }
        abort_unless($this->capabilities($user, $organization)[strtolower($permission->name)], 403);
    }
}
