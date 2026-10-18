<?php

declare(strict_types=1);

namespace App\Domain\Support\Enums;

enum TicketType: string
{
    case BUG = 'bug';
    case FEATURE_REQUEST = 'feature_request';
    case IMPROVEMENT = 'improvement';

    public function label(): string
    {
        return match ($this) {
            self::BUG => 'Bug',
            self::FEATURE_REQUEST => 'Feature request',
            self::IMPROVEMENT => 'Improvement',
        };
    }
}
