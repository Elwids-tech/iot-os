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
    /** Moving devices to another organization of the billing account (spec 031); needed in both. */
    case MOVE = 'Device.move';
}
