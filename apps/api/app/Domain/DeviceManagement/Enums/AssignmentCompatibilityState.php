<?php

declare(strict_types=1);

namespace App\Domain\DeviceManagement\Enums;

enum AssignmentCompatibilityState: string
{
    case V1_UNMIGRATED = 'v1_unmigrated';
    case V2_ROUTE_PENDING = 'v2_route_pending';
    case V2_ROUTE_AWARE = 'v2_route_aware';
}
