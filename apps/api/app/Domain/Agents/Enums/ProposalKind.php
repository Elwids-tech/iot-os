<?php

declare(strict_types=1);

namespace App\Domain\Agents\Enums;

enum ProposalKind: string
{
    case PROFILE_SECTION = 'profile_section';
    case DECODER_REVISION = 'decoder_revision';
    case DEVICE_REGISTRATION = 'device_registration';
    case DASHBOARD = 'dashboard';
}
