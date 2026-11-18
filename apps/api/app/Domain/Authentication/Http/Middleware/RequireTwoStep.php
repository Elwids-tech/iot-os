<?php

declare(strict_types=1);

namespace App\Domain\Authentication\Http\Middleware;

use App\Domain\Shared\Models\User;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

/**
 * Required two-step sign-in (spec 034, FR-020 to FR-022, research R7). A person for
 * whom two-step is required, and who has not set it up, reaches only their own
 * security settings and sign-out until they do:
 *
 * - API routes behind `auth:sanctum` answer `403 two_step_setup_required`, and the
 *   apps open setup;
 * - Passport's authorize page (an agent connection) sends them to the portal's setup.
 *
 * Only people signed in with a browser session are checked. Agent tokens (`mcp`),
 * application tokens and public routes never are (FR-032). The check reads the
 * person's own two-step columns first, so people who have it set up cost no query.
 */
final class RequireTwoStep
{
    public const CODE = 'two_step_setup_required';

    /** What a person who must set up two-step can still reach. */
    private const ALLOWED = [
        'api.v1.me',
        'api.v1.me.security',
        'api.v1.me.two-step.*',
        'api.v1.me.passkeys.*',
        'api.v1.auth.confirm-password',
        'api.v1.auth.confirm-passkey*',
        'api.v1.auth.logout',
    ];

    private const AUTHORIZE = 'passport.authorizations.authorize';

    public function handle(Request $request, Closure $next): Response
    {
        $person = $this->sessionPerson($request);
        if ($person === null || $person->twoStepSatisfied() || self::allows($request->route()?->getName()) || ! $person->twoStepRequired()) {
            return $next($request);
        }

        if ($request->routeIs(self::AUTHORIZE)) {
            return redirect()->away(rtrim((string) config('app.frontend_url'), '/').'/account/security/setup?'.http_build_query(['return' => $request->fullUrl()]));
        }

        return response()->json([
            'code' => self::CODE,
            'message' => 'Set up two-step sign-in to continue.',
        ], 403);
    }

    /** Whether a person who must set up two-step can still reach the route (the contract uses this too). */
    public static function allows(?string $routeName): bool
    {
        return $routeName !== null && Str::is(self::ALLOWED, $routeName);
    }

    /** The person behind the request, when a signed-in browser session made it. */
    private function sessionPerson(Request $request): ?User
    {
        $route = $request->route();
        if ($route === null || ! $request->hasSession() || $request->bearerToken() !== null) {
            return null;
        }

        $checked = $request->routeIs(self::AUTHORIZE) || in_array('auth:sanctum', $route->gatherMiddleware(), true);
        // The session guard says a browser session signed the person in; the request's
        // user is the one the route's own authentication resolved.
        $person = $checked && Auth::guard('web')->check() ? $request->user() : null;

        return $person instanceof User ? $person : null;
    }
}
