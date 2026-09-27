<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Http;

use App\Domain\Integrations\Models\IntegrationApplication;
use App\Domain\Shared\Models\Organization;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Laravel\Sanctum\PersonalAccessToken;

final class AuthenticateApplication
{
    public function handle(Request $request, Closure $next, string $ability)
    {
        // Neither cookies nor personal user tokens grant machine access.
        $plain = $request->bearerToken();
        abort_unless($plain && strlen($plain) <= 256, 401, 'Application token required.');
        $token = PersonalAccessToken::findToken($plain);
        $application = $token?->tokenable;
        abort_unless($application instanceof IntegrationApplication && ! $application->revoked_at && $token->expires_at && $token->expires_at->isFuture(), 401, 'Application token is invalid or expired.');
        $organization = $request->route('organization');
        abort_unless($organization instanceof Organization && $organization->id === $application->organization_id, 404);
        abort_unless(in_array($ability, $application->abilities, true) && in_array($ability, $token->abilities, true), 403, 'Application ability is not granted.');
        if ($ability === 'events:read') {
            $canReadEvents = collect(['alerts:read', 'geofences:read'])->contains(fn ($required) => in_array($required, $application->abilities, true) && in_array($required, $token->abilities, true));
            abort_unless($canReadEvents, 403, 'Alert or geofence read access is required for the event feed.');
        }
        if ($ability === 'geofences:activate') {
            abort_unless(in_array('geofences:manage', $application->abilities, true) && in_array('geofences:manage', $token->abilities, true), 403, 'Geofence management access is required for activation.');
        }
        $key = 'integration-application:'.$application->uuid;
        if (! RateLimiter::attempt($key, 60, fn () => true, 60)) {
            return response()->json(['message' => 'Application rate limit exceeded.'], 429)->header('Retry-After', (string) RateLimiter::availableIn($key));
        }
        $request->attributes->set('integration_application', $application);
        $token->forceFill(['last_used_at' => now()])->save();

        return $next($request)->header('Cache-Control', 'no-store');
    }
}
