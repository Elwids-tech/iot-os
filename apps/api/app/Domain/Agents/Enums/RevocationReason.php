<?php

declare(strict_types=1);

namespace App\Domain\Agents\Enums;

enum RevocationReason: string
{
    case PERSON = 'person';
    case ADMINISTRATOR = 'administrator';
    case MEMBERSHIP_REMOVED = 'membership_removed';
    case PASSWORD_RESET = 'password_reset';
    case REFRESH_REUSE = 'refresh_reuse';
    case REPLACED = 'replaced';
}
