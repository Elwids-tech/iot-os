<?php

declare(strict_types=1);

namespace App\Domain\DeviceManagement\Enums;

enum DeviceLifecycleState: string
{
    case DRAFT = 'draft';
    case REGISTERED = 'registered';
    case ARCHIVED = 'archived';
}
