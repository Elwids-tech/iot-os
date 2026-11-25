<?php

declare(strict_types=1);

namespace App\Domain\Entities\Services;

use App\Domain\Entities\Permissions\EntityPermission;
use App\Domain\Entities\Permissions\EntityTypePermission;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Database\Eloquent\Model;
use Spatie\Permission\Exceptions\PermissionDoesNotExist;
use Spatie\Permission\PermissionRegistrar;

/**
 * Membership first, then the permission (constitution III), as DeviceAuthorization does.
 * A resource of another organization is a 404.
 */
final class EntityAuthorization
{
    public function allows(User $user, EntityPermission|EntityTypePermission $permission, Organization $organization): bool
    {
        $registrar = app(PermissionRegistrar::class);
        $previous = $registrar->getPermissionsTeamId();
        $registrar->setPermissionsTeamId($organization->id);
        $user->unsetRelation('roles')->unsetRelation('permissions');
        try {
            if ($user->is_super_admin) {
                return true;
            }
            if (! $user->organizations()->whereKey($organization->id)->exists()) {
                return false;
            }
            try {
                return $user->hasPermissionTo($permission->value);
            } catch (PermissionDoesNotExist) {
                return false;
            }
        } finally {
            $registrar->setPermissionsTeamId($previous);
            $user->unsetRelation('roles')->unsetRelation('permissions');
        }
    }

    public function authorize(User $user, EntityPermission|EntityTypePermission $permission, Organization $organization, ?Model $resource = null): void
    {
        if ($resource) {
            abort_unless($resource->organization_id === $organization->id, 404);
        }
        abort_unless($this->allows($user, $permission, $organization), 403);
    }
}
