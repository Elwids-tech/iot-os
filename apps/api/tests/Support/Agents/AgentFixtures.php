<?php

declare(strict_types=1);

namespace Tests\Support\Agents;

use App\Domain\Agents\Enums\AccessLevel;
use App\Domain\Agents\Models\AgentConnection;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;
use Laravel\Passport\Client;
use Laravel\Passport\ClientRepository;
use Laravel\Passport\Passport;

/** Builds agent clients, connections and Passport tokens the way sign-in does. */
trait AgentFixtures
{
    /** @var array{private: string, public: string}|null */
    private static ?array $passportKeys = null;

    /** Throwaway signing keys for Passport, made once per test process; nothing is written to disk. */
    protected function usePassportTestKeys(): void
    {
        if (self::$passportKeys === null) {
            $key = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
            openssl_pkey_export($key, $private);
            self::$passportKeys = ['private' => $private, 'public' => openssl_pkey_get_details($key)['key']];
        }
        config(['passport.private_key' => self::$passportKeys['private'], 'passport.public_key' => self::$passportKeys['public']]);
    }

    /**
     * Connects an agent through the real flow (register, authorize, consent, token) and
     * returns its client id and tokens. Callers enable agent access first.
     *
     * @return array{client: string, access_token: string, refresh_token: string}
     */
    protected function connectAgent(User $user, Organization $organization, string $level = 'read'): array
    {
        $callback = 'https://claude.ai/api/mcp/auth_callback';
        $client = $this->postJson('/oauth/register', ['client_name' => 'Claude', 'redirect_uris' => [$callback]])->assertCreated()->json('client_id');
        $verifier = Str::random(64);
        $challenge = rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=');
        $this->actingAs($user, 'web')->get('/oauth/authorize?'.http_build_query([
            'response_type' => 'code', 'client_id' => $client, 'redirect_uri' => $callback, 'state' => 's',
            'code_challenge' => $challenge, 'code_challenge_method' => 'S256',
        ]))->assertRedirect();
        $authToken = $this->withHeader('Origin', 'http://localhost')->actingAs($user, 'web')->getJson('/api/v1/agent-authorizations/current')->assertOk()->json('data.auth_token');
        $redirect = $this->withHeader('Origin', 'http://localhost')->actingAs($user, 'web')->postJson('/api/v1/agent-authorizations/approve', [
            'auth_token' => $authToken, 'organization_uuid' => $organization->uuid, 'access_level' => $level,
        ])->assertOk()->json('data.redirect_to');
        parse_str((string) parse_url($redirect, PHP_URL_QUERY), $query);
        $this->signOutEverywhere();
        $tokens = $this->post('/oauth/token', [
            'grant_type' => 'authorization_code', 'client_id' => $client, 'redirect_uri' => $callback, 'code_verifier' => $verifier, 'code' => $query['code'],
        ])->assertOk()->json();

        return ['client' => $client, 'access_token' => $tokens['access_token'], 'refresh_token' => $tokens['refresh_token']];
    }

    /** Leaves no session, signed-in user or bearer header behind for the next request. */
    protected function signOutEverywhere(): void
    {
        // Routes keep their controller instance between requests in one test, and the
        // authorize controller holds the session guard it was built with (a fresh
        // application per request avoids this in production).
        if ($route = app('router')->getRoutes()->getByName('passport.authorizations.authorize')) {
            $route->controller = null;
        }
        Auth::forgetGuards();
        $this->flushSession();
        $this->withoutToken();
        $this->withoutHeader('Origin');
        $this->app['auth']->shouldUse('web');
    }

    /** A JSON-RPC call to /mcp with an agent token. */
    protected function mcp(string $token, string $method, array $params = [], int $id = 1)
    {
        $this->signOutEverywhere();

        return $this->withToken($token)->postJson('/mcp', ['jsonrpc' => '2.0', 'id' => $id, 'method' => $method, 'params' => (object) $params], [
            'Accept' => 'application/json, text/event-stream', 'MCP-Protocol-Version' => '2025-11-25',
        ]);
    }

    /** Calls a tool and returns the decoded result envelope (or error) with the error flag. */
    protected function callTool(string $token, string $tool, array $arguments = []): array
    {
        $response = $this->mcp($token, 'tools/call', ['name' => $tool, 'arguments' => (object) $arguments])->assertOk();
        $result = $response->json('result');

        return ['error' => (bool) ($result['isError'] ?? false), 'body' => json_decode($result['content'][0]['text'] ?? 'null', true), 'structured' => $result['structuredContent'] ?? null];
    }

    protected function agentClient(string $name = 'Claude', string $redirect = 'https://claude.ai/api/mcp/auth_callback'): Client
    {
        return app(ClientRepository::class)->createAuthorizationCodeGrantClient($name, [$redirect], false);
    }

    protected function agentConnection(User $user, Organization $organization, AccessLevel $level = AccessLevel::READ, ?Client $client = null): AgentConnection
    {
        return AgentConnection::create([
            'user_id' => $user->id,
            'organization_id' => $organization->id,
            'oauth_client_id' => ($client ?? $this->agentClient())->id,
            'access_level' => $level,
            'expires_at' => now()->addDays((int) config('agents.connection_idle_days')),
        ]);
    }

    /** @return array{access: string, refresh: string} the stored ids of a token pair for the connection's client */
    protected function agentTokenRows(User $user, string $clientId): array
    {
        $access = Str::random(80);
        Passport::token()->forceFill(['id' => $access, 'user_id' => $user->id, 'client_id' => $clientId, 'scopes' => ['mcp:use'], 'revoked' => false, 'expires_at' => now()->addHour()])->save();
        $refresh = Str::random(80);
        Passport::refreshToken()->forceFill(['id' => $refresh, 'access_token_id' => $access, 'revoked' => false, 'expires_at' => now()->addDays(90)])->save();

        return ['access' => $access, 'refresh' => $refresh];
    }
}
