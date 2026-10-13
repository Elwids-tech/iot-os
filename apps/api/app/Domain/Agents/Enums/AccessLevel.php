<?php

declare(strict_types=1);

namespace App\Domain\Agents\Enums;

enum AccessLevel: string
{
    case READ = 'read';
    case DRAFT = 'draft';
}
