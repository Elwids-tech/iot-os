<?php

declare(strict_types=1);

namespace App\Domain\SignUp\Services;

use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Support\Facades\Crypt;

/**
 * When the sign-up form was shown, sealed with the application key (spec 035 FR-041,
 * research R7). A submission sooner than a person could type, or long after the page was
 * loaded, is refused; nobody outside the deployment can make a token.
 */
final class FormToken
{
    public const MIN_SECONDS = 3;

    public const MAX_SECONDS = 7200;

    public function issue(): string
    {
        return Crypt::encryptString('sign-up|'.now()->getTimestamp());
    }

    /**
     * @return 'too_fast'|'form_expired'|null why it is refused, or null when it is good
     */
    public function problem(?string $token): ?string
    {
        if ($token === null || $token === '') {
            return 'form_expired';
        }

        try {
            $value = Crypt::decryptString($token);
        } catch (DecryptException) {
            return 'form_expired';
        }

        if (! preg_match('/^sign-up\|(\d+)$/', $value, $match)) {
            return 'form_expired';
        }

        $age = now()->getTimestamp() - (int) $match[1];

        return match (true) {
            $age < self::MIN_SECONDS => 'too_fast',
            $age > self::MAX_SECONDS => 'form_expired',
            default => null,
        };
    }
}
