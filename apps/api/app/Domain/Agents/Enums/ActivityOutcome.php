<?php

declare(strict_types=1);

namespace App\Domain\Agents\Enums;

enum ActivityOutcome: string
{
    case ANSWERED = 'answered';
    case REFUSED = 'refused';
    case FAILED = 'failed';
}
