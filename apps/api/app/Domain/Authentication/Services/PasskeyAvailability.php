<?php

declare(strict_types=1);

namespace App\Domain\Authentication\Services;

/**
 * Whether passkeys can be used on this deployment (spec 034, FR-018, research R5).
 * Browsers offer passkeys only on secure pages, so every origin allowed to use them (the
 * portal and the admin app, from FRONTEND_URL and ADMIN_FRONTEND_URL) must be served
 * over HTTPS, or from `localhost` on a development stack. Browsers also refuse an IP
 * address as the relying party. The browser's own support is checked by the client.
 */
final class PasskeyAvailability
{
    public const NOT_HTTPS = 'not_https';

    public function available(): bool
    {
        return $this->unavailableReason() === null;
    }

    /** `not_https`, or null when passkeys can be used. */
    public function unavailableReason(): ?string
    {
        $origins = config('passkeys.allowed_origins');
        $relyingParty = (string) config('passkeys.relying_party_id');

        if (! is_array($origins) || $origins === [] || $relyingParty === '' || filter_var(trim($relyingParty, '[]'), FILTER_VALIDATE_IP) !== false) {
            return self::NOT_HTTPS;
        }

        foreach ($origins as $origin) {
            if (! $this->secure(is_string($origin) ? $origin : '')) {
                return self::NOT_HTTPS;
            }
        }

        return null;
    }

    private function secure(string $url): bool
    {
        $scheme = strtolower((string) parse_url($url, PHP_URL_SCHEME));
        $host = strtolower((string) parse_url($url, PHP_URL_HOST));

        return $scheme === 'https' || ($scheme === 'http' && ($host === 'localhost' || str_ends_with($host, '.localhost')));
    }
}
