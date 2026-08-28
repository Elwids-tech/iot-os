<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Enums;

enum DefinitionState: string
{
    case DRAFT = 'draft';
    case PUBLISHED = 'published';
    case RETIRED = 'retired';
}
