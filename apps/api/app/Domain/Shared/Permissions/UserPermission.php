<?php

declare(strict_types=1);

namespace App\Domain\Shared\Permissions;

use Althinect\EnumPermission\Concerns\HasPermissionGroup;

enum UserPermission: string
{
    use HasPermissionGroup;

    case VIEW_ANY = 'User.view-any';
    case VIEW = 'User.view';
    case CREATE = 'User.create';
    case UPDATE = 'User.update';
    case DELETE = 'User.delete';
    case RESTORE = 'User.restore';
    case FORCE_DELETE = 'User.force-delete';
}
