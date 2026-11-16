<?php

declare(strict_types=1);

namespace App\Domain\Authentication\Services;

use App\Domain\Authentication\Models\KeptSignIn;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cookie as Cookies;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Cookie;

/**
 * The `iot_kept` cookie: `{uuid}.{secret}` for one kept sign-in, encrypted by
 * `EncryptCookies` like the session cookie, HttpOnly, on the session's domain, for a
 * fixed 30 days (research R11). Reads configuration on each call, so it holds no state
 * between requests under Octane.
 */
final class KeptSignInCookie
{
    public const NAME = 'iot_kept';

    /** The session key naming the kept sign-in this session was started or resumed from. */
    public const SESSION_KEY = 'kept_sign_in_id';

    public const MINUTES = KeptSignIn::DAYS * 24 * 60;

    public function make(KeptSignIn $record, string $secret): Cookie
    {
        return Cookies::make(
            self::NAME,
            $record->uuid.'.'.$secret,
            self::MINUTES,
            config('session.path', '/'),
            config('session.domain'),
            config('session.secure'),
            true,
            false,
            config('session.same_site', 'lax'),
        );
    }

    public function forget(): Cookie
    {
        return Cookies::forget(self::NAME, config('session.path', '/'), config('session.domain'));
    }

    public function present(Request $request): bool
    {
        return $request->cookies->has(self::NAME);
    }

    /** The record the request's cookie names, when its secret matches; live or not. */
    public function record(Request $request): ?KeptSignIn
    {
        $value = $request->cookies->get(self::NAME);
        if (! is_string($value) || substr_count($value, '.') !== 1) {
            return null;
        }
        [$uuid, $secret] = explode('.', $value, 2);
        // PostgreSQL rejects a malformed uuid outright, so check before querying.
        if ($secret === '' || ! Str::isUuid($uuid)) {
            return null;
        }
        $record = KeptSignIn::query()->where('uuid', $uuid)->first();

        return $record !== null && $record->matches($secret) ? $record : null;
    }

    /** "Chrome on Android" and the like, from the sign-in's user agent. */
    public function label(?string $userAgent): string
    {
        $agent = trim((string) $userAgent);
        $browser = match (true) {
            Str::contains($agent, ['Edg/', 'EdgA/', 'EdgiOS/']) => 'Edge',
            Str::contains($agent, ['OPR/', 'Opera']) => 'Opera',
            Str::contains($agent, 'SamsungBrowser/') => 'Samsung Internet',
            Str::contains($agent, ['Firefox/', 'FxiOS/']) => 'Firefox',
            Str::contains($agent, ['Chrome/', 'CriOS/', 'Chromium/']) => 'Chrome',
            Str::contains($agent, 'Safari/') => 'Safari',
            default => null,
        };
        $system = match (true) {
            Str::contains($agent, 'iPhone') => 'iPhone',
            Str::contains($agent, 'iPad') => 'iPad',
            Str::contains($agent, 'Android') => 'Android',
            Str::contains($agent, 'Windows') => 'Windows',
            Str::contains($agent, 'CrOS') => 'ChromeOS',
            Str::contains($agent, ['Macintosh', 'Mac OS X']) => 'macOS',
            Str::contains($agent, 'Linux') => 'Linux',
            default => null,
        };
        $label = match (true) {
            $browser !== null && $system !== null => "{$browser} on {$system}",
            $browser !== null || $system !== null => (string) ($browser ?? $system),
            $agent !== '' => $agent,
            default => 'Unknown browser',
        };

        return Str::limit($label, 120, '');
    }
}
