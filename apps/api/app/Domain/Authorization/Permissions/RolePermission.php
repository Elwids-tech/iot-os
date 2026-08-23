<?php

declare(strict_types=1);

namespace App\Domain\Authorization\Permissions;

use Althinect\EnumPermission\Concerns\HasPermissionGroup;

enum RolePermission: string
{
    use HasPermissionGroup;

    case VIEW_ANY = 'Role.view-any';
    case VIEW = 'Role.view';
    case CREATE = 'Role.create';
    case UPDATE = 'Role.update';
    case DELETE = 'Role.delete';
    case RESTORE = 'Role.restore';
    case FORCE_DELETE = 'Role.force-delete';
}
