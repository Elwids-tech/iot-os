<?php

declare(strict_types=1);

namespace App\Domain\Agents\Enums;

enum ProposalStatus: string
{
    case OPEN = 'open';
    case APPLIED = 'applied';
    case DISCARDED = 'discarded';
    case EXPIRED = 'expired';
    case SUPERSEDED = 'superseded';
}
