<?php

declare(strict_types=1);

namespace App\Domain\Notifications\Services;

/**
 * Whether this deployment can push (spec 033, FR-016): only while both halves of its
 * VAPID key pair are set, as `Payments::enabled()` does for card payments.
 */
final class WebPush
{
    public static function enabled(): bool
    {
        return filled(config('webpush.vapid.public_key')) && filled(config('webpush.vapid.private_key'));
    }

    /** The key browsers subscribe with (`applicationServerKey`); null when push is off. */
    public static function publicKey(): ?string
    {
        return self::enabled() ? (string) config('webpush.vapid.public_key') : null;
    }
}
