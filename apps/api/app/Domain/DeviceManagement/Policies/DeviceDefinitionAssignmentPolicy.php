<?php

declare(strict_types=1);

namespace App\Domain\DeviceManagement\Policies;

use App\Domain\Authorization\Services\TenantPermissionAuthorization;
use App\Domain\DeviceManagement\Models\DeviceDefinitionAssignment;
use App\Domain\DeviceManagement\Permissions\DevicePermission;
use App\Domain\Shared\Models\User;

final readonly class DeviceDefinitionAssignmentPolicy
{
    public function __construct(private TenantPermissionAuthorization $authorization) {}

    public function view(User $user, DeviceDefinitionAssignment $assignment): bool
    {
        return $this->authorization->allows($user, $assignment->organization, DevicePermission::VIEW);
    }

    public function update(User $user, DeviceDefinitionAssignment $assignment): bool
    {
        return ! $assignment->isLocked()
            && $assignment->device->isDraft()
            && $this->authorization->allows(
                $user,
                $assignment->organization,
                DevicePermission::ASSIGN_DEFINITION,
            );
    }
}
