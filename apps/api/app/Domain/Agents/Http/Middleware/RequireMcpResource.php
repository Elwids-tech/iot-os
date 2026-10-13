<?php

declare(strict_types=1);

namespace App\Domain\Agents\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * RFC 8707: tokens are only for the MCP endpoint. A `resource` that names anything else
 * is refused with invalid_target; a missing one is accepted, because Claude has been
 * seen to omit it. The authorize step answers 400 rather than redirecting, so an
 * unvalidated redirect address is never used.
 */
final class RequireMcpResource
{
    public function handle(Request $request, Closure $next): Response
    {
        $resource = $request->input('resource');
        if ($resource === null || $resource === '') {
            return $next($request);
        }
        if (! is_string($resource) || rtrim($resource, '/') !== rtrim((string) config('agents.resource'), '/')) {
            return response()->json([
                'error' => 'invalid_target',
                'error_description' => 'This server only issues tokens for '.config('agents.resource').'.',
            ], 400);
        }

        return $next($request);
    }
}
