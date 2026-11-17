<?php

declare(strict_types=1);

namespace App\Domain\Automation\Services;

use App\Domain\Automation\Models\Alert;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;

/** What `AlertRecipientCheck` decided for one delivery: send it, cancel it, or wait. */
final readonly class AlertRecipientVerdict
{
    public const SEND = 'send';

    public const CANCEL = 'cancel';

    public const RELEASE = 'release';

    private function __construct(
        public string $action,
        public ?string $reason = null,
        public ?Alert $alert = null,
        public ?User $user = null,
        public ?Organization $organization = null,
    ) {}

    public static function send(Alert $alert, User $user, Organization $organization): self
    {
        return new self(self::SEND, null, $alert, $user, $organization);
    }

    public static function cancel(string $reason): self
    {
        return new self(self::CANCEL, $reason);
    }

    /** The execution is still being applied; try again in 30 seconds. */
    public static function release(): self
    {
        return new self(self::RELEASE);
    }
}
