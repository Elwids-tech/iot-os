<?php

declare(strict_types=1);

namespace App\Domain\Support\Enums;

enum TicketStatus: string
{
    case NEW = 'new';
    case IN_REVIEW = 'in_review';
    case NEEDS_INFO = 'needs_info';
    case PLANNED = 'planned';
    case IN_PROGRESS = 'in_progress';
    case RESOLVED = 'resolved';
    case DECLINED = 'declined';

    public function isOpen(): bool
    {
        return ! in_array($this, [self::RESOLVED, self::DECLINED], true);
    }

    public function label(): string
    {
        return match ($this) {
            self::NEW => 'New',
            self::IN_REVIEW => 'In review',
            self::NEEDS_INFO => 'Needs information',
            self::PLANNED => 'Planned',
            self::IN_PROGRESS => 'In progress',
            self::RESOLVED => 'Resolved',
            self::DECLINED => 'Declined',
        };
    }

    /**
     * @return list<string>
     */
    public static function openValues(): array
    {
        return array_values(array_map(static fn (self $status): string => $status->value, array_filter(self::cases(), static fn (self $status): bool => $status->isOpen())));
    }
}
