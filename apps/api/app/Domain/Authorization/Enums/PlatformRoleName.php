<?php

declare(strict_types=1);

namespace App\Domain\Authorization\Enums;

use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;

enum PlatformRoleName: string
{
    case PLATFORM_ADMINISTRATOR = 'platform-administrator';

    public function displayName(): string
    {
        return match ($this) {
            self::PLATFORM_ADMINISTRATOR => 'Platform Administrator',
        };
    }

    /**
     * @return list<string>
     */
    public function permissions(): array
    {
        return match ($this) {
            self::PLATFORM_ADMINISTRATOR => array_map(
                static fn (PlatformAdministrationPermission $permission): string => $permission->value,
                PlatformAdministrationPermission::cases(),
            ),
        };
    }
}
