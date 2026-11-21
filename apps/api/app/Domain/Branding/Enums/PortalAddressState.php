<?php

declare(strict_types=1);

namespace App\Domain\Branding\Enums;

/** Where a portal address stands (spec 036, data-model.md "States"). */
enum PortalAddressState: string
{
    case WaitingDns = 'waiting_dns';
    case Active = 'active';
    case Unreachable = 'unreachable';
    case Suspended = 'suspended';
    case Lapsed = 'lapsed';
    case Released = 'released';

    /** Still held by its account: counts towards one name and one domain. */
    public function isLive(): bool
    {
        return $this !== self::Released && $this !== self::Lapsed;
    }

    /** The portal answers here. A failed check keeps serving; only links fall back. */
    public function serves(): bool
    {
        return $this === self::Active || $this === self::Unreachable;
    }
}
