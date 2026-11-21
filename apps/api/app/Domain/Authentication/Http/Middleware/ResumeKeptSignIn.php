<?php

declare(strict_types=1);

namespace App\Domain\Authentication\Http\Middleware;

use App\Domain\Authentication\Models\KeptSignIn;
use App\Domain\Authentication\Services\KeptSignInCookie;
use App\Domain\Branding\Services\PortalAccess;
use Closure;
use Illuminate\Auth\SessionGuard;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cookie;
use Laravel\Sanctum\Http\Middleware\EnsureFrontendRequestsAreStateful;
use Symfony\Component\HttpFoundation\Response;

/**
 * Keeps a browser signed in for 30 days when it asked to be (spec 033, FR-011a, R11).
 * Runs in the `api` group after Sanctum's stateful middleware has started the session,
 * and before `auth:sanctum` (it sits ahead of it in the priority list):
 *
 * - a session started or resumed from a kept sign-in whose record has ended or expired
 *   is signed out, so a sign-out elsewhere, a password reset or a removed device takes
 *   effect on that browser's next request;
 * - a session with no user and an `iot_kept` cookie naming a live record signs that
 *   person back in on `web`, as a password sign-in would.
 *
 * Only stateful frontend requests: Passport and application tokens never reach it.
 * It holds no state between requests (Octane).
 */
final class ResumeKeptSignIn
{
    public function __construct(
        private readonly KeptSignInCookie $cookie,
        private readonly PortalAccess $access,
    ) {}

    public function handle(Request $request, Closure $next): Response
    {
        if (! $request->hasSession() || $request->bearerToken() !== null || ! EnsureFrontendRequestsAreStateful::fromFrontend($request)) {
            return $next($request);
        }

        $session = $request->session();
        /** @var SessionGuard $guard */
        $guard = Auth::guard('web');
        $keptId = $session->get(KeptSignInCookie::SESSION_KEY);

        if ($keptId !== null && $guard->check()) {
            $record = KeptSignIn::query()->find($keptId);
            if ($record !== null && $record->isLive() && $record->user_id === (int) $guard->id()) {
                $record->touchUse();

                return $next($request);
            }
            $guard->logout();
            // As SessionController::destroy does: drop a user the sanctum guard may hold.
            Auth::guard('sanctum')->forgetUser();
            $session->invalidate();
            $session->regenerateToken();
            Cookie::queue($this->cookie->forget());

            return $next($request);
        }

        if ($guard->check() || ! $this->cookie->present($request)) {
            return $next($request);
        }

        $record = $this->cookie->record($request);
        $user = $record?->isLive() ? $record->user : null;
        if ($record === null || $user === null) {
            // A stale or forged cookie: stop the browser sending it.
            Cookie::queue($this->cookie->forget());

            return $next($request);
        }

        // A kept sign-in does not open an address its person may not use (spec 036,
        // FR-020). The cookie stays: on the platform's domain it is theirs elsewhere.
        if (! $this->access->admits($user, $request)) {
            return $next($request);
        }

        $guard->login($user);
        $session->regenerate();
        $session->put([
            KeptSignInCookie::SESSION_KEY => $record->getKey(),
            // As Sanctum's AuthenticateSession stores it, so a later password change
            // still signs this session out.
            'password_hash_web' => $guard->hashPasswordForCookie($user->getAuthPassword()),
        ]);
        $record->touchUse();

        return $next($request);
    }
}
