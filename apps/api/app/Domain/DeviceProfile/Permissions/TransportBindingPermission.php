<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Permissions;

use Althinect\EnumPermission\Concerns\HasPermissionGroup;

enum TransportBindingPermission: string
{
    use HasPermissionGroup;

    case VIEW_ANY = 'TransportBinding.view-any';
    case VIEW = 'TransportBinding.view';
    case CREATE = 'TransportBinding.create';
    case UPDATE = 'TransportBinding.update';
    case DELETE = 'TransportBinding.delete';
    case PUBLISH = 'TransportBinding.publish';
    case RETIRE = 'TransportBinding.retire';
}
