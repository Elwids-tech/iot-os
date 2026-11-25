<?php

declare(strict_types=1);

namespace App\Domain\Entities\Permissions;

use Althinect\EnumPermission\Concerns\HasPermissionGroup;

/**
 * The entity hierarchy (spec 009, FR-018). View sees the tree; manage changes
 * entities and, later, placements. Types, rules and presets have their own
 * permission (EntityTypePermission).
 */
enum EntityPermission: string
{
    use HasPermissionGroup;

    case VIEW = 'Entity.view';
    case MANAGE = 'Entity.manage';
}
