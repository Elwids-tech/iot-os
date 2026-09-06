<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Enums;

enum DeviceProfileArtifactStatus: string
{
    case ACTIVE = 'active';
    case RETIRED = 'retired';
}
