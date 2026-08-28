<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Permissions;

use Althinect\EnumPermission\Concerns\HasPermissionGroup;

enum DeviceProfilePermission: string
{
    use HasPermissionGroup;

    case VIEW_ANY = 'DeviceProfile.view-any';
    case VIEW = 'DeviceProfile.view';
    case CREATE = 'DeviceProfile.create';
    case UPDATE = 'DeviceProfile.update';
    case DELETE = 'DeviceProfile.delete';
    case PUBLISH = 'DeviceProfile.publish';
    case RETIRE = 'DeviceProfile.retire';
}
