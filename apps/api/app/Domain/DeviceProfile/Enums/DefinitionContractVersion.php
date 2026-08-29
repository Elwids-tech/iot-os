<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Enums;

enum DefinitionContractVersion: string
{
    case V1 = 'v1';
    case V2 = 'v2';
}
