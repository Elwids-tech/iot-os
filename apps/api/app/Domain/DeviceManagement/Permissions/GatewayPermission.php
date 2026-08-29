<?php

declare(strict_types=1);

namespace App\Domain\DeviceManagement\Permissions;

use Althinect\EnumPermission\Concerns\HasPermissionGroup;

enum GatewayPermission: string
{
    use HasPermissionGroup;

    case VIEW_ANY = 'Gateway.view-any';
    case VIEW = 'Gateway.view';
    case CREATE = 'Gateway.create';
    case UPDATE = 'Gateway.update';
    case DELETE = 'Gateway.delete';
}
