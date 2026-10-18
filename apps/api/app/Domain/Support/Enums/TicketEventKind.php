<?php

declare(strict_types=1);

namespace App\Domain\Support\Enums;

enum TicketEventKind: string
{
    case CREATED = 'created';
    case STATUS = 'status';
    case PRIORITY = 'priority';
    case TYPE = 'type';
    case TITLE = 'title';
    case ASSIGNEE = 'assignee';
    case PARTICIPANT_ADDED = 'participant_added';
    case PARTICIPANT_REMOVED = 'participant_removed';
    case PARTICIPANT_LEFT = 'participant_left';

    /** Priority and assignee are the team's working state; people never see them. */
    public function isInternal(): bool
    {
        return in_array($this, [self::PRIORITY, self::ASSIGNEE], true);
    }
}
