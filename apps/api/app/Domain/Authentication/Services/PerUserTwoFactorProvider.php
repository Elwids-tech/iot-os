<?php

declare(strict_types=1);

namespace App\Domain\Authentication\Services;

use Laravel\Fortify\TwoFactorAuthenticationProvider;

/**
 * Fortify's code check with a replay key per secret (spec 034, research R6).
 *
 * Fortify remembers a used code under `md5($code)` alone, so one person's code would
 * block the same six digits for everyone else for the rest of the window. Keying by the
 * secret as well keeps the guarantee that matters (a code that signed someone in never
 * works for them again) without refusing other people's codes. The window stays at one
 * step either side.
 */
final class PerUserTwoFactorProvider extends TwoFactorAuthenticationProvider
{
    public function verify($secret, $code)
    {
        $code = (string) $code;
        $key = 'two_step.used_codes.'.hash('sha256', $secret.'|'.$code);

        $timestamp = $this->engine->verifyKeyNewer($secret, $code, $this->cache?->get($key));
        if ($timestamp === false) {
            return false;
        }
        if ($timestamp === true) {
            $timestamp = $this->engine->getTimestamp();
        }
        $this->cache?->put($key, $timestamp, ($this->engine->getWindow() ?: 1) * 60);

        return true;
    }
}
