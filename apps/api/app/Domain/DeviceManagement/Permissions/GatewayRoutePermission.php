<?php

declare(strict_types=1);

namespace App\Domain\DeviceManagement\Permissions;

use Althinect\EnumPermission\Concerns\HasPermissionGroup;

enum GatewayRoutePermission: string
{
    use HasPermissionGroup;

    case VIEW_ANY = 'GatewayRoute.view-any';
    case VIEW = 'GatewayRoute.view';
    case CREATE = 'GatewayRoute.create';
    case UPDATE = 'GatewayRoute.update';
    case DELETE = 'GatewayRoute.delete';
}
