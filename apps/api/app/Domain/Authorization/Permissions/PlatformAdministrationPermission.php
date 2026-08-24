<?php

declare(strict_types=1);

namespace App\Domain\Authorization\Permissions;

use Althinect\EnumPermission\Concerns\HasPermissionGroup;

enum PlatformAdministrationPermission: string
{
    use HasPermissionGroup;

    case ACCESS = 'PlatformAdministration.access';
    case MANAGE_ORGANIZATIONS = 'PlatformAdministration.manage-organizations';
}
