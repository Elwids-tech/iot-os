<?php

declare(strict_types=1);

namespace App\Domain\Devices\Permissions;

use Althinect\EnumPermission\Concerns\HasPermissionGroup;

enum DevicePermission: string
{
    use HasPermissionGroup;

    case VIEW = 'Device.view';
    case MANAGE = 'Device.manage';
    case CONNECTIONS = 'Device.manage-connections';
    case ACTIVATE = 'Device.activate';
    case COMMAND = 'Device.command';
}
