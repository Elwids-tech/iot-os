<?php

declare(strict_types=1);

namespace App\Domain\Authorization\Permissions;

use Althinect\EnumPermission\Concerns\HasPermissionGroup;

enum PlatformAdministrationPermission: string
{
    use HasPermissionGroup;

    case ACCESS = 'PlatformAdministration.access';
    case MANAGE_ORGANIZATIONS = 'PlatformAdministration.manage-organizations';
    case MANAGE_RETENTION = 'PlatformAdministration.manage-retention';
    // Reset a locked-out person's two-step sign-in (spec 034, FR-024).
    case RESET_TWO_STEP = 'PlatformAdministration.reset-two-step';
}
