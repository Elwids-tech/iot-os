<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Policies;

use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Permissions\DeviceProfilePermission;
use App\Domain\Shared\Models\User;

final class DeviceProfilePolicy
{
    public function view(User $user, DeviceProfile $profile): bool
    {
        return $this->allows($user, $profile, DeviceProfilePermission::VIEW);
    }

    public function update(User $user, DeviceProfile $profile): bool
    {
        return $this->allows($user, $profile, DeviceProfilePermission::UPDATE);
    }

    public function delete(User $user, DeviceProfile $profile): bool
    {
        return $this->allows($user, $profile, DeviceProfilePermission::DELETE_DRAFT);
    }

    private function allows(User $user, DeviceProfile $profile, DeviceProfilePermission $permission): bool
    {
        if ($profile->organization_id === null) {
            return $user->is_super_admin;
        }

        return $user->organizations()->whereKey($profile->organization_id)->exists()
            && $user->can($permission->value);
    }
}
