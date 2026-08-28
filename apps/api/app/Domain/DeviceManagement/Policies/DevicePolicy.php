<?php

declare(strict_types=1);

namespace App\Domain\DeviceManagement\Policies;

use App\Domain\Authorization\Services\TenantPermissionAuthorization;
use App\Domain\DeviceManagement\Models\Device;
use App\Domain\DeviceManagement\Permissions\DevicePermission;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;

final readonly class DevicePolicy
{
    public function __construct(private TenantPermissionAuthorization $authorization) {}

    public function viewAny(User $user, Organization $organization): bool
    {
        return $this->authorization->allows($user, $organization, DevicePermission::VIEW_ANY);
    }

    public function view(User $user, Device $device): bool
    {
        return $this->authorization->allows($user, $device->organization, DevicePermission::VIEW);
    }

    public function create(User $user, Organization $organization): bool
    {
        return $this->authorization->allows($user, $organization, DevicePermission::CREATE);
    }

    public function update(User $user, Device $device): bool
    {
        return $device->isDraft()
            && $this->authorization->allows($user, $device->organization, DevicePermission::UPDATE);
    }

    public function delete(User $user, Device $device): bool
    {
        return $device->isDraft()
            && $this->authorization->allows($user, $device->organization, DevicePermission::DELETE);
    }

    public function register(User $user, Device $device): bool
    {
        return $device->isDraft()
            && $this->authorization->allows($user, $device->organization, DevicePermission::REGISTER);
    }

    public function archive(User $user, Device $device): bool
    {
        return ! $device->isArchived()
            && $this->authorization->allows($user, $device->organization, DevicePermission::ARCHIVE);
    }

    public function assignDefinition(User $user, Device $device): bool
    {
        return $device->isDraft()
            && $this->authorization->allows($user, $device->organization, DevicePermission::ASSIGN_DEFINITION);
    }
}
