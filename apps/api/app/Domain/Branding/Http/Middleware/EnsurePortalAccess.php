<?php

declare(strict_types=1);

namespace App\Domain\Branding\Http\Middleware;

use App\Domain\Branding\Services\PortalAccess;
use App\Domain\Branding\Services\PortalAddresses;
use App\Domain\Shared\Models\User;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

/**
 * Keeps a signed-in person out of an address they may not use (spec 036, FR-020 and
 * FR-023), on every request and not only at sign-in: a name under the platform's domain
 * shares the platform's session, and a person can lose their last organization under an
 * account while signed in. Runs once `auth:sanctum` has resolved the person.
 *
 * A session started on a custom domain belongs to that domain alone: anywhere else it
 * is ended with `401`.
 *
 * The answer is `403 not_available_here`. A session that belongs to the address's own
 * host is ended; one shared with the platform's address is left alone, so opening
 * someone else's portal does not sign a person out of their own.
 */
final class EnsurePortalAccess
{
    public function __construct(
        private readonly PortalAccess $access,
        private readonly PortalAddresses $addresses,
    ) {}

    public function handle(Request $request, Closure $next): Response
    {
        // A session works only where it was started (research R6): one from a custom
        // domain is refused on the platform's hosts and on any other domain, and the
        // reverse. Browsers never send the cookie across hosts; this covers a copied one,
        // and a domain removed and claimed again.
        if ($this->addresses->enabled() && ! $request->routeIs('api.v1.portal.*') && $request->hasSession() && Auth::guard('web')->check() && ! $this->access->sessionBelongs($request)) {
            Auth::guard('web')->logout();
            Auth::guard('sanctum')->forgetUser();
            $request->session()->invalidate();
            $request->session()->regenerateToken();

            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        if ($this->access->address($request) === null || $request->routeIs('api.v1.auth.logout')) {
            return $next($request);
        }
        $route = $request->route();
        $user = $route !== null && in_array('auth:sanctum', $route->gatherMiddleware(), true) ? $request->user() : null;
        if (! $user instanceof User || $this->access->admits($user, $request)) {
            return $next($request);
        }

        if ($this->access->ownsSession($request) && $request->hasSession() && Auth::guard('web')->check()) {
            Auth::guard('web')->logout();
            Auth::guard('sanctum')->forgetUser();
            $request->session()->invalidate();
            $request->session()->regenerateToken();
        }

        return response()->json([
            'code' => PortalAccess::CODE,
            'message' => 'This account cannot sign in at this address.',
        ], 403);
    }
}
