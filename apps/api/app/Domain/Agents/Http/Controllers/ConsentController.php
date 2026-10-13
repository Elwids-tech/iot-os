<?php

declare(strict_types=1);

namespace App\Domain\Agents\Http\Controllers;

use App\Domain\Agents\Enums\AccessLevel;
use App\Domain\Agents\Enums\RevocationReason;
use App\Domain\Agents\Models\AgentConnection;
use App\Domain\Agents\Services\AgentAccess;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Laravel\Passport\Bridge\Client as BridgeClient;
use Laravel\Passport\Bridge\Scope;
use Laravel\Passport\Bridge\User as BridgeUser;
use Laravel\Passport\Exceptions\InvalidAuthTokenException;
use Laravel\Passport\Http\Controllers\RetrievesAuthRequestFromSession;
use Laravel\Passport\Passport;
use League\OAuth2\Server\AuthorizationServer;
use League\OAuth2\Server\Exception\OAuthServerException;
use League\OAuth2\Server\RequestTypes\AuthorizationRequest;
use League\OAuth2\Server\RequestTypes\AuthorizationRequestInterface;
use Psr\Http\Message\ResponseInterface;

/**
 * The portal's /connect page. Passport has validated the agent's request (client,
 * redirect address, PKCE) and kept it in the session; the person picks one
 * organization and an access level, and Passport then issues the code (spec 004 D5).
 */
final class ConsentController
{
    use RetrievesAuthRequestFromSession;

    public function __construct(
        private readonly AgentAccess $access,
        private readonly AuthorizationServer $server,
    ) {}

    /**
     * The agent connection waiting for the signed-in person's decision.
     *
     * @return array{data: array{auth_token: string, client: array{name: string, self_declared: bool, client_uri: string|null}, redirect_host: string, organizations: list<array{uuid: string, name: string, available: bool, reason: string|null, can_manage: bool}>, access_levels: list<string>}}
     */
    public function current(Request $request): array
    {
        $user = $request->user();
        // Passport keeps the request in the browser session; other clients have none.
        abort_unless($request->hasSession(), 404, 'No agent connection is waiting for approval.');
        $authToken = $request->session()->get('authToken');
        $authRequest = $this->pending($request);
        abort_unless(is_string($authToken) && $authRequest !== null && $this->belongsTo($authRequest, $user), 404, 'No agent connection is waiting for approval.');
        $client = Passport::client()->newQuery()->find($authRequest->getClient()->getIdentifier());

        return ['data' => [
            'auth_token' => $authToken,
            'client' => [
                'name' => (string) ($client?->name ?? $authRequest->getClient()->getName()),
                // Registration is dynamic, so every name is the agent's own claim (research D4).
                'self_declared' => true,
                'client_uri' => is_string($client?->client_uri ?? null) ? $client->client_uri : null,
            ],
            'redirect_host' => (string) parse_url((string) $authRequest->getRedirectUri(), PHP_URL_HOST),
            'organizations' => $user->organizations()->orderBy('name')->get()->map(fn (Organization $organization): array => [
                'uuid' => $organization->uuid,
                'name' => $organization->name,
                'available' => (bool) $organization->agent_access_enabled,
                'reason' => $organization->agent_access_enabled ? null : 'switched_off',
                'can_manage' => $this->access->canManage($user, $organization),
            ])->values()->all(),
            'access_levels' => array_map(static fn (AccessLevel $level): string => $level->value, AccessLevel::cases()),
        ]];
    }

    /**
     * Approve the connection for one organization and access level, and return the agent's callback address.
     *
     * @return array{data: array{redirect_to: string}}
     */
    public function approve(Request $request, ResponseInterface $psrResponse): array
    {
        $input = $request->validate([
            'auth_token' => ['required', 'string'],
            'organization_uuid' => ['required', 'uuid'],
            'access_level' => ['required', Rule::enum(AccessLevel::class)],
        ]);
        $user = $request->user();
        $organization = $user->organizations()->where('organizations.uuid', $input['organization_uuid'])->first();
        abort_unless($organization instanceof Organization, 403, 'You are not a member of this organization.');
        abort_unless($this->access->organizationEnabled($organization), 403, 'Agent access is switched off for this organization.');
        $authRequest = $this->retrieve($request, $user);

        DB::transaction(function () use ($user, $organization, $authRequest, $input): void {
            $clientId = $authRequest->getClient()->getIdentifier();
            AgentConnection::query()->active()->where('user_id', $user->id)->where('oauth_client_id', $clientId)->lockForUpdate()
                ->each(fn (AgentConnection $previous) => $previous->revoke(RevocationReason::REPLACED, $user));
            AgentConnection::create([
                'user_id' => $user->id,
                'organization_id' => $organization->id,
                'oauth_client_id' => $clientId,
                'access_level' => AccessLevel::from($input['access_level']),
                'expires_at' => now()->addDays((int) config('agents.connection_idle_days')),
            ]);
        });

        $authRequest->setUser(new BridgeUser((string) $user->getAuthIdentifier()));
        $authRequest->setAuthorizationApproved(true);

        return ['data' => ['redirect_to' => $this->location($this->server->completeAuthorizationRequest($authRequest, $psrResponse))]];
    }

    /**
     * Refuse the connection and return the agent's callback address with access_denied.
     *
     * @return array{data: array{redirect_to: string}}
     */
    public function deny(Request $request, ResponseInterface $psrResponse): array
    {
        $request->validate(['auth_token' => ['required', 'string']]);
        $authRequest = $this->retrieve($request, $request->user());
        $authRequest->setAuthorizationApproved(false);

        try {
            $response = $this->server->completeAuthorizationRequest($authRequest, $psrResponse);
        } catch (OAuthServerException $denied) {
            $response = $denied->generateHttpResponse($psrResponse);
        }

        return ['data' => ['redirect_to' => $this->location($response)]];
    }

    private function retrieve(Request $request, User $user): AuthorizationRequestInterface
    {
        abort_unless($request->hasSession(), 404, 'No agent connection is waiting for approval.');
        try {
            $authRequest = $this->getAuthRequestFromSession($request);
        } catch (InvalidAuthTokenException) {
            abort(409, 'This connection request was replaced or has expired. Start it again from your agent.');
        } catch (\Exception) {
            abort(404, 'No agent connection is waiting for approval.');
        }
        abort_unless($this->belongsTo($authRequest, $user), 409, 'This connection request was started by someone else. Start it again from your agent.');

        return $authRequest;
    }

    /** Read the pending request without consuming it. */
    private function pending(Request $request): ?AuthorizationRequestInterface
    {
        $serialized = $request->session()->get('authRequest');
        if (! is_string($serialized)) {
            return null;
        }
        $authRequest = unserialize($serialized, ['allowed_classes' => [AuthorizationRequest::class, BridgeClient::class, Scope::class, BridgeUser::class]]);

        return $authRequest instanceof AuthorizationRequestInterface ? $authRequest : null;
    }

    /** Passport records the signed-in person when it stores the request. */
    private function belongsTo(AuthorizationRequestInterface $authRequest, User $user): bool
    {
        return (string) $authRequest->getUser()?->getIdentifier() === (string) $user->getAuthIdentifier();
    }

    private function location(ResponseInterface $response): string
    {
        $location = $response->getHeaderLine('Location');
        abort_if($location === '', 500, 'The authorization server returned no redirect.');

        return $location;
    }
}
