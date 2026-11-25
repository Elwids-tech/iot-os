<?php

declare(strict_types=1);

namespace App\Domain\Entities\Permissions;

use Althinect\EnumPermission\Concerns\HasPermissionGroup;

/** Entity types, their rules and presets: the organization's naming standard (spec 009, FR-018). */
enum EntityTypePermission: string
{
    use HasPermissionGroup;

    case MANAGE = 'EntityType.manage';
}
