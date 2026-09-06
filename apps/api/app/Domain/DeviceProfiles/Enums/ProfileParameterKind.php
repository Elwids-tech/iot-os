<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Enums;

enum ProfileParameterKind: string
{
    case STATE = 'state';
    case MEASUREMENT = 'measurement';
    case COUNTER = 'counter';
    case EVENT = 'event';
    case DERIVED = 'derived';
}
