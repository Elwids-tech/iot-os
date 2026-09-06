<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Enums;

enum DeviceProfileStatus: string
{
    case DRAFT = 'draft';
    case PUBLISHED = 'published';
    case ARCHIVED = 'archived';
}
