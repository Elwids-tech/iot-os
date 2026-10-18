<?php

declare(strict_types=1);

namespace App\Domain\Support\Enums;

enum TicketPriority: string
{
    case LOW = 'low';
    case NORMAL = 'normal';
    case HIGH = 'high';
    case URGENT = 'urgent';

    /** Sort weight: urgent first. */
    public function rank(): int
    {
        return match ($this) {
            self::URGENT => 0,
            self::HIGH => 1,
            self::NORMAL => 2,
            self::LOW => 3,
        };
    }
}
