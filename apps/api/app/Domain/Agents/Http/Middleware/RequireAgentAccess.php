<?php

declare(strict_types=1);

namespace App\Domain\Agents\Http\Middleware;

use App\Domain\Agents\Services\AgentAccess;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** Every agent route answers 404 while the deployment's switch is off (FR-001). */
final class RequireAgentAccess
{
    public function __construct(private readonly AgentAccess $access) {}

    public function handle(Request $request, Closure $next): Response
    {
        if (! $this->access->deploymentEnabled()) {
            return response()->json(['message' => 'Agent access is not available on this platform.'], 404);
        }

        return $next($request);
    }
}
