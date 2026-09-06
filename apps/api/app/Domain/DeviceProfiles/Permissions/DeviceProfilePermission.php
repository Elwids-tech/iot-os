<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Permissions;

use Althinect\EnumPermission\Concerns\HasPermissionGroup;

enum DeviceProfilePermission: string
{
    use HasPermissionGroup;

    case VIEW_ANY = 'DeviceProfile.view-any';
    case VIEW = 'DeviceProfile.view';
    case CREATE = 'DeviceProfile.create';
    case UPDATE = 'DeviceProfile.update';
    case DELETE_DRAFT = 'DeviceProfile.delete-draft';
    case VALIDATE = 'DeviceProfile.validate';
    case PUBLISH = 'DeviceProfile.publish';
    case MANAGE_TRANSPORT_BINDINGS = 'TransportBinding.manage';
}
