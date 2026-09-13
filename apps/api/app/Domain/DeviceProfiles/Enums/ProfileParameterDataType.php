<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Enums;

enum ProfileParameterDataType: string
{
    case BOOLEAN = 'boolean';
    case INTEGER = 'integer';
    case NUMBER = 'number';
    case ENUM = 'enum';
    case STRING = 'string';
    case TIMESTAMP = 'timestamp';
    case BYTES = 'bytes';
}
