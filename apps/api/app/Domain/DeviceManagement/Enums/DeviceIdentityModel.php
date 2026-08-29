<?php

declare(strict_types=1);

namespace App\Domain\DeviceManagement\Enums;

enum DeviceIdentityModel: string
{
    case V1_DIRECT = 'v1_direct';
    case LOGICAL_V2 = 'logical_v2';
}
