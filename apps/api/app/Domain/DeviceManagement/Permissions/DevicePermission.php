<?php

declare(strict_types=1);

namespace App\Domain\DeviceManagement\Permissions;

use Althinect\EnumPermission\Concerns\HasPermissionGroup;

enum DevicePermission: string
{
    use HasPermissionGroup;

    case VIEW_ANY = 'Device.view-any';
    case VIEW = 'Device.view';
    case CREATE = 'Device.create';
    case UPDATE = 'Device.update';
    case DELETE = 'Device.delete';
    case REGISTER = 'Device.register';
    case ARCHIVE = 'Device.archive';
    case ASSIGN_DEFINITION = 'Device.assign-definition';
}
