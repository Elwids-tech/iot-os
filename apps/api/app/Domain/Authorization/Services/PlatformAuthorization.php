<?php

declare(strict_types=1);

namespace App\Domain\Authorization\Services;

use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Shared\Models\User;

final class PlatformAuthorization
{
    public function canAccessAdministration(User $user): bool
    {
        return $this->allows($user, PlatformAdministrationPermission::ACCESS);
    }

    public function allows(User $user, PlatformAdministrationPermission $permission): bool
    {
        if ($user->is_super_admin) {
            return true;
        }

        return $user->platformRoles()
            ->whereHas('permissions', fn ($query) => $query->where('name', $permission->value))
            ->exists();
    }
}
