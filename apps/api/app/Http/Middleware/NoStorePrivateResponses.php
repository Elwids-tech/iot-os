<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * A signed-in person's API responses are never kept in the browser's HTTP cache, so
 * nothing of an organization's stays on a shared phone after sign-out (spec 033,
 * SC-005). Laravel's default `no-cache, private` still lets a browser store the body.
 * A response that chose its own lifetime (`max-age`) keeps it.
 */
final class NoStorePrivateResponses
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);
        if ($request->user() !== null && ! $response->headers->hasCacheControlDirective('max-age')) {
            $response->headers->set('Cache-Control', 'no-store, private');
        }

        return $response;
    }
}
