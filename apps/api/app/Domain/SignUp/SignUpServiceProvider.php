<?php

declare(strict_types=1);

namespace App\Domain\SignUp;

use App\Domain\SignUp\Services\SignUps;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Str;

/**
 * Self sign-up (spec 035). Its limits are the first line against floods (FR-040,
 * research R7); the form token, hidden field, daily ceiling and email confirmation
 * are in `SignUps`.
 */
final class SignUpServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        $tooMany = static fn (string $message) => static fn (Request $request, array $headers) => response()->json([
            'message' => sprintf($message, $headers['Retry-After'] ?? 60),
            'retry_after' => (int) ($headers['Retry-After'] ?? 60),
        ], 429, $headers);

        RateLimiter::for('sign-up', static function (Request $request) use ($tooMany): array {
            $email = $request->input('email');
            $response = $tooMany('Too many sign-up attempts. Try again in %d seconds.');

            return [
                Limit::perHour(5)->by('sign-up-ip:'.$request->ip())->response($response),
                Limit::perHour(3)->by('sign-up-email:'.hash('sha256', is_string($email) ? Str::lower(trim($email)) : 'invalid'))->response($response),
            ];
        });

        // Keyed by the browser's waiting sign-up, so one person cannot flood another's inbox.
        RateLimiter::for('sign-up-resend', static function (Request $request) use ($tooMany): array {
            // The waiting sign-up stands for its email address.
            $key = 'sign-up-resend-email:'.($request->hasSession() ? (string) $request->session()->get(SignUps::SESSION_KEY) : $request->ip());
            $response = $tooMany('You can ask for another email in %d seconds.');

            return [
                Limit::perMinute(1)->by($key.':minute')->response($response),
                Limit::perHour(5)->by($key.':hour')->response($response),
            ];
        });

        RateLimiter::for('sign-up-confirm', static fn (Request $request) => Limit::perMinute(10)->by('sign-up-confirm-ip:'.$request->ip())
            ->response($tooMany('Too many attempts. Try again in %d seconds.')));

        // The waiting page polls every 3 seconds; a few people behind one address fit.
        RateLimiter::for('sign-up-status', static fn (Request $request) => Limit::perMinute(120)
            ->by('sign-up-status-ip:'.$request->ip()));
    }
}
