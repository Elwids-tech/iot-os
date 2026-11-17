<?php

declare(strict_types=1);

namespace App\Domain\Notifications\Services;

/**
 * What one push service said about one device (spec 033, research R12).
 *
 * - `accepted`: the push service took it (2xx). Not proof the phone showed it.
 * - `gone`: the subscription no longer exists (404, 410) or belongs to another key
 *   (403 naming a key mismatch); the device is deleted and never tried again.
 * - `rejected`: refused for another reason (other 4xx, or a key the package can't
 *   encrypt to); retrying will not help.
 * - `transport_failed`: no answer, 429 or 5xx; worth retrying.
 */
final readonly class PushResult
{
    public const ACCEPTED = 'accepted';

    public const GONE = 'gone';

    public const REJECTED = 'rejected';

    public const TRANSPORT_FAILED = 'transport_failed';

    public function __construct(
        public string $outcome,
        public ?int $status,
        public ?string $reason = null,
    ) {}

    public function accepted(): bool
    {
        return $this->outcome === self::ACCEPTED;
    }

    public function transient(): bool
    {
        return $this->outcome === self::TRANSPORT_FAILED;
    }
}
