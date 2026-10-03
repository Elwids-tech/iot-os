<?php

declare(strict_types=1);

namespace App\Domain\Authorization\Enums;

use App\Domain\Authorization\Permissions\RolePermission;
use App\Domain\DeviceProfiles\Permissions\DeviceProfilePermission;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Shared\Permissions\OrganizationPermission;
use App\Domain\Shared\Permissions\UserPermission;

enum OrganizationRoleName: string
{
    case ORGANIZATION_ADMIN = 'organization-admin';
    case MODERATOR = 'moderator';
    case MEMBER = 'member';

    public function displayName(): string
    {
        return match ($this) {
            self::ORGANIZATION_ADMIN => 'Organization Admin',
            self::MODERATOR => 'Moderator',
            self::MEMBER => 'Member',
        };
    }

    /**
     * @return list<string>
     */
    public function permissions(): array
    {
        return match ($this) {
            self::ORGANIZATION_ADMIN => [
                ...array_map(static fn ($permission): string => $permission->value, OrganizationPermission::cases()),
                ...array_map(static fn ($permission): string => $permission->value, UserPermission::cases()),
                ...array_map(static fn ($permission): string => $permission->value, RolePermission::cases()),
                ...array_map(static fn ($permission): string => $permission->value, DeviceProfilePermission::cases()),
                ...array_map(static fn ($permission): string => $permission->value, DevicePermission::cases()),
                ...array_map(static fn ($permission): string => $permission->value, \App\Domain\Automation\Permissions\WorkflowPermission::cases()),
            ],
            self::MODERATOR => [
                DevicePermission::VIEW->value,
                \App\Domain\Automation\Permissions\WorkflowPermission::VIEW->value,
                OrganizationPermission::VIEW->value,
                UserPermission::VIEW_ANY->value,
                UserPermission::VIEW->value,
                DeviceProfilePermission::VIEW_ANY->value,
                DeviceProfilePermission::VIEW->value,
                DeviceProfilePermission::VALIDATE->value,
            ],
            self::MEMBER => [
                DevicePermission::VIEW->value,
                \App\Domain\Automation\Permissions\WorkflowPermission::VIEW->value,
                OrganizationPermission::VIEW->value,
                DeviceProfilePermission::VIEW_ANY->value,
                DeviceProfilePermission::VIEW->value,
            ],
        };
    }
}
