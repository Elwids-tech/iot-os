<?php

declare(strict_types=1);

namespace App\Domain\Authentication\Http\Middleware;

use App\Domain\Authentication\Services\Impersonation;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * While a super administrator acts as someone else, that person's own sign-in security
 * stays theirs: two-step, passkeys and password confirmation answer `403 impersonating`,
 * and so does connecting an AI agent in their name.
 */
final class RestrictImpersonation
{
    public const CODE = 'impersonating';

    private const ROUTES = [
        'api.v1.auth.confirm-password',
        'api.v1.auth.confirm-passkey*',
        'api.v1.me.two-step.*',
        'api.v1.me.passkeys.*',
        'passport.authorizations.*',
    ];

    private const PATHS = [
        'api/v1/agent-authorizations/approve',
    ];

    public function __construct(private readonly Impersonation $impersonation) {}

    public function handle(Request $request, Closure $next): Response
    {
        if (($request->routeIs(self::ROUTES) || $request->is(self::PATHS)) && $this->impersonation->active($request)) {
            return response()->json([
                'code' => self::CODE,
                'message' => 'Leave impersonation to do this. It belongs to the person you are acting as.',
            ], 403);
        }

        return $next($request);
    }
}
