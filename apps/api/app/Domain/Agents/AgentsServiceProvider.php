<?php

declare(strict_types=1);

namespace App\Domain\Agents;

use Carbon\CarbonInterval;
use Illuminate\Support\ServiceProvider;
use Laravel\Passport\Passport;

/**
 * Passport serves AI agents only (spec 004, ADR-018). Its default routes stay off;
 * the agent routes register the authorize and token endpoints they need.
 */
final class AgentsServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        Passport::ignoreRoutes();
    }

    public function boot(): void
    {
        Passport::tokensExpireIn(CarbonInterval::hour());
        Passport::refreshTokensExpireIn(CarbonInterval::days(90));
    }
}
