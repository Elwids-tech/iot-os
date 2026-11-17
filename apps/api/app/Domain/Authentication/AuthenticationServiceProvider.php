<?php

declare(strict_types=1);

namespace App\Domain\Authentication;

use App\Domain\Authentication\Services\PerUserTwoFactorProvider;
use Illuminate\Contracts\Cache\Repository;
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
}
