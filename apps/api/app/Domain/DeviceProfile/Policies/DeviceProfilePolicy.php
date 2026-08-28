<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Policies;

use App\Domain\Authorization\Services\TenantPermissionAuthorization;
use App\Domain\DeviceProfile\Models\DeviceProfile;
use App\Domain\DeviceProfile\Permissions\DeviceProfilePermission;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;

final readonly class DeviceProfilePolicy
{
    public function __construct(private TenantPermissionAuthorization $authorization) {}

    public function viewAny(User $user, Organization $organization): bool
    {
        return $this->authorization->allows($user, $organization, DeviceProfilePermission::VIEW_ANY);
    }

    public function view(User $user, DeviceProfile $profile): bool
    {
        return $this->authorization->allows($user, $profile->organization, DeviceProfilePermission::VIEW);
    }

    public function create(User $user, Organization $organization): bool
    {
        return $this->authorization->allows($user, $organization, DeviceProfilePermission::CREATE);
    }

    public function update(User $user, DeviceProfile $profile): bool
    {
        return ! $profile->isArchived()
            && $this->authorization->allows($user, $profile->organization, DeviceProfilePermission::UPDATE);
    }

    public function delete(User $user, DeviceProfile $profile): bool
    {
        return ! $profile->isArchived()
            && $this->authorization->allows($user, $profile->organization, DeviceProfilePermission::DELETE);
    }
}
