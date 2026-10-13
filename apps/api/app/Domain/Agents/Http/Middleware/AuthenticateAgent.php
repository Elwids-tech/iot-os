<?php

declare(strict_types=1);

namespace App\Domain\Agents\Http\Middleware;

use App\Domain\Agents\Mcp\AgentContext;
use App\Domain\Agents\Models\AgentConnection;
use App\Domain\Agents\Services\AgentAccess;
use App\Domain\Shared\Models\User;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Laravel\Passport\AccessToken;
use Spatie\Permission\PermissionRegistrar;
use Symfony\Component\HttpFoundation\Response;

/**
 * Every agent call (spec 004 D7). Passport has already validated the bearer token; this
 * decides whether its connection may still act, then enters the connection's organization
 * the way ResolveOrganizationContext does for portal requests.
 */
final class AuthenticateAgent
{
    public function __construct(private readonly AgentAccess $access) {}

    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user('mcp');
        $token = $user instanceof User ? $user->token() : null;
        $clientId = $token instanceof AccessToken ? (string) $token->oauth_client_id : '';
        $connection = $clientId === '' ? null : AgentConnection::query()->active()
            ->where('user_id', $user->getKey())->where('oauth_client_id', $clientId)->with('organization')->first();
        if ($connection === null || $connection->isExpired()) {
            if ($connection !== null || $clientId !== '') {
                AgentConnection::revokeTokens((int) $user->getKey(), $clientId);
            }

            return $this->disconnected();
        }

        $organization = $connection->organization;
        if (! $this->access->organizationEnabled($organization)) {
            return $this->refuse($request, "Agent access is switched off for {$organization->name}. An organization administrator can switch it on in Settings → AI apps.");
        }
        if (! $user->organizations()->whereKey($organization->getKey())->exists()) {
            return $this->refuse($request, "You are no longer a member of {$organization->name}.");
        }
        foreach (['minute' => [config('agents.rate_per_minute'), 60], 'hour' => [config('agents.rate_per_hour'), 3600]] as $window => [$limit, $decay]) {
            $key = "agent-connection:{$connection->id}:{$window}";
            if (! RateLimiter::attempt($key, (int) $limit, fn () => true, $decay)) {
                return $this->refuse($request, 'Too many requests from this connection. Retry in '.RateLimiter::availableIn($key).' seconds.', -32029);
            }
        }
        if ($connection->last_used_at === null || $connection->last_used_at->lt(now()->subMinute())) {
            $connection->touchUse();
        }

        $registrar = app(PermissionRegistrar::class);
        $previousTeam = $registrar->getPermissionsTeamId();
        $registrar->setPermissionsTeamId($organization->getKey());
        $user->unsetRelation('roles')->unsetRelation('permissions');
        app()->instance(AgentContext::class, new AgentContext($connection, $user, $organization));

        try {
            return $next($request);
        } finally {
            app()->forgetInstance(AgentContext::class);
            $registrar->setPermissionsTeamId($previousTeam);
            $user->unsetRelation('roles')->unsetRelation('permissions');
        }
    }

    /**
     * The token outlived its connection, and its tokens are now revoked, so refreshing
     * fails and the agent asks the person to connect again. laravel/mcp's middleware
     * sets the WWW-Authenticate challenge on every 401 from /mcp.
     */
    private function disconnected(): JsonResponse
    {
        return response()->json(['message' => 'This connection was disconnected or has expired. Connect again from your agent.'], 401);
    }

    /** A JSON-RPC error the agent can show, for a connection that exists but may not act now. */
    private function refuse(Request $request, string $message, int $code = -32003): JsonResponse
    {
        $id = $request->json('id');

        return response()->json(['jsonrpc' => '2.0', 'id' => is_int($id) || is_string($id) ? $id : null, 'error' => ['code' => $code, 'message' => $message]]);
    }
}
