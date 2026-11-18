<?php

declare(strict_types=1);

namespace App\Domain\Authentication;

use App\Domain\Authentication\Services\PerUserTwoFactorProvider;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Contracts\Cache\Repository;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Laravel\Fortify\Contracts\TwoFactorAuthenticationProvider;
use Laravel\Fortify\Fortify;
use PragmaRX\Google2FA\Google2FA;

/**
 * Two-step sign-in (spec 034, ADR-048). Fortify supplies the two-factor actions and the
 * code provider; its routes stay off, and the Authentication domain's own routes call
 * the actions.
 */
final class AuthenticationServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        Fortify::ignoreRoutes();

        $this->app->singleton(TwoFactorAuthenticationProvider::class, fn ($app) => new PerUserTwoFactorProvider(
            $app->make(Google2FA::class),
            $app->make(Repository::class),
        ));
    }

    public function boot(): void
    {
        // Passkey routes (spec 034): 6 a minute for each route, per signed-in person, or
        // per address before sign-in, so asking for options does not use up the answer.
        RateLimiter::for('passkeys', static function (Request $request): Limit {
            $route = (string) $request->route()?->getName();
            $user = $request->user();

            return $user !== null
                ? Limit::perMinute(6)->by('passkeys-user:'.$route.'|'.$user->getAuthIdentifier())
                : Limit::perMinute(6)->by('passkeys-ip:'.$route.'|'.$request->ip());
        });
    }
}
