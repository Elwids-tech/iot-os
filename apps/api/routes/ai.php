<?php

declare(strict_types=1);

use App\Domain\Agents\Http\Controllers\AuthorizationController;
use App\Domain\Agents\Http\Middleware\RequireAgentAccess;
use App\Domain\Agents\Http\Middleware\RequireMcpResource;
use Illuminate\Support\Facades\Route;
use Laravel\Mcp\Facades\Mcp;
use Laravel\Mcp\Server\Http\Controllers\OAuthRegisterController;
use Laravel\Passport\Http\Controllers\AccessTokenController;

/*
 * AI agents (spec 004, ADR-018). laravel/mcp serves discovery, Passport issues codes
 * and tokens, and the portal's /connect page takes consent. Everything here answers
 * 404 while IOT_AGENTS_ENABLED is false.
 */
Route::middleware(RequireAgentAccess::class)->group(function (): void {
    Mcp::oauthRoutes(registration: false);

    // Dynamic client registration, rate limited (clients register once per connection).
    Route::post('oauth/register', OAuthRegisterController::class)
        ->middleware('throttle:10,1')
        ->name('mcp.oauth.register');

    // Passport's endpoints under the names laravel/mcp's metadata points at. Consent is
    // always asked, and Passport's own approve and deny routes are not registered: the
    // portal completes consent.
    Route::get('oauth/authorize', [AuthorizationController::class, 'authorize'])
        ->middleware(['web', RequireMcpResource::class])
        ->name('passport.authorizations.authorize');
    Route::post('oauth/token', [AccessTokenController::class, 'issueToken'])
        ->middleware(['throttle:60,1', RequireMcpResource::class])
        ->name('passport.token');
});
