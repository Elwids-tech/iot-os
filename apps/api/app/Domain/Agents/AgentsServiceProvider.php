<?php

declare(strict_types=1);

namespace App\Domain\Agents;

use App\Domain\Agents\Http\Controllers\AuthorizationController;
use Carbon\CarbonInterval;
use Illuminate\Contracts\Auth\StatefulGuard;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\Auth;
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
        // Passport binds the session guard for its own controller; ours extends it.
        $this->app->when(AuthorizationController::class)->needs(StatefulGuard::class)
            ->give(fn () => Auth::guard(config('passport.guard')));
    }

    public function boot(): void
    {
        Passport::tokensExpireIn(CarbonInterval::hour());
        Passport::refreshTokensExpireIn(CarbonInterval::days(90));
        // Passport keeps the pending request in the session; the portal's /connect page
        // shows it and completes it through ConsentController.
        Passport::authorizationView(fn (): RedirectResponse => redirect()->away(rtrim((string) config('app.frontend_url'), '/').'/connect'));
    }
}
