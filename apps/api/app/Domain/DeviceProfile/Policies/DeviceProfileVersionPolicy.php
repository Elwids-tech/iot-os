<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Policies;

use App\Domain\Authorization\Services\TenantPermissionAuthorization;
use App\Domain\DeviceProfile\Models\DeviceProfileVersion;
use App\Domain\DeviceProfile\Permissions\DeviceProfilePermission;
use App\Domain\Shared\Models\User;

final readonly class DeviceProfileVersionPolicy
{
    public function __construct(private TenantPermissionAuthorization $authorization) {}

    public function view(User $user, DeviceProfileVersion $version): bool
    {
        return $this->authorization->allows($user, $version->organization, DeviceProfilePermission::VIEW);
    }

    public function update(User $user, DeviceProfileVersion $version): bool
    {
        return $version->isDraft()
            && ! $version->profile->isArchived()
            && $this->authorization->allows($user, $version->organization, DeviceProfilePermission::UPDATE);
    }

    public function delete(User $user, DeviceProfileVersion $version): bool
    {
        return $version->isDraft()
            && ! $version->profile->isArchived()
            && $this->authorization->allows($user, $version->organization, DeviceProfilePermission::DELETE);
    }

    public function publish(User $user, DeviceProfileVersion $version): bool
    {
        return $version->isDraft()
            && ! $version->profile->isArchived()
            && $this->authorization->allows($user, $version->organization, DeviceProfilePermission::PUBLISH);
    }

    public function retire(User $user, DeviceProfileVersion $version): bool
    {
        return $version->isPublished()
            && $this->authorization->allows($user, $version->organization, DeviceProfilePermission::RETIRE);
    }
}
