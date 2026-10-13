<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Agents\OAuth;

use App\Domain\Agents\Enums\AccessLevel;
use App\Domain\Agents\Enums\RevocationReason;
use App\Domain\Agents\Models\AgentConnection;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;
use Laravel\Passport\Passport;
use Tests\Support\Agents\AgentFixtures;
use Tests\TestCase;

/**
 * Claude's sign-in, step by step, against Passport and laravel/mcp (contracts/oauth.md).
 */
final class AgentOAuthFlowTest extends TestCase
{
    use AgentFixtures, RefreshDatabase;

    private const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';

    private const PORTAL = 'https://app.example.test';

    private User $person;

    private Organization $acme;

    private Organization $northstar;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->usePassportTestKeys();
        config(['agents.enabled' => true, 'app.frontend_url' => self::PORTAL]);
        $this->withoutMiddleware(ValidateCsrfToken::class);
        $this->person = User::where('email', 'shared.operator@example.test')->firstOrFail();
        $this->acme = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->northstar = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $this->acme->forceFill(['agent_access_enabled' => true])->save();
    }

    public function test_discovery_describes_the_resource_and_passport(): void
    {
        $resource = $this->getJson('/.well-known/oauth-protected-resource/mcp')->assertOk()->json();
        $this->assertSame(url('/mcp'), $resource['resource']);
        $this->assertSame([url('/')], $resource['authorization_servers']);

        $server = $this->getJson('/.well-known/oauth-authorization-server')->assertOk()->json();
        $this->assertSame(url('/oauth/authorize'), $server['authorization_endpoint']);
        $this->assertSame(url('/oauth/token'), $server['token_endpoint']);
        $this->assertSame(url('/oauth/register'), $server['registration_endpoint']);
        $this->assertSame(['S256'], $server['code_challenge_methods_supported']);
        $this->assertContains('none', $server['token_endpoint_auth_methods_supported']);
        $this->assertNotContains('offline_access', $server['scopes_supported']);
    }

    public function test_everything_answers_not_found_while_the_deployment_switch_is_off(): void
    {
        config(['agents.enabled' => false]);

        $this->getJson('/.well-known/oauth-authorization-server')->assertNotFound();
        $this->getJson('/.well-known/oauth-protected-resource/mcp')->assertNotFound();
        $this->postJson('/oauth/register', ['client_name' => 'Claude', 'redirect_uris' => [self::CALLBACK]])->assertNotFound();
        $this->get('/oauth/authorize?client_id=x')->assertNotFound();
        $this->post('/oauth/token', ['grant_type' => 'authorization_code'])->assertNotFound();
        $this->stateful()->actingAs($this->person)->getJson('/api/v1/agent-authorizations/current')->assertNotFound();
    }

    public function test_registration_validates_and_is_rate_limited(): void
    {
        $this->postJson('/oauth/register', ['client_name' => 'Claude', 'redirect_uris' => ['not a url']])
            ->assertStatus(400)->assertJsonPath('error', 'invalid_redirect_uri');
        config(['mcp.redirect_domains' => ['https://claude.ai', 'http://localhost']]);
        $this->postJson('/oauth/register', ['client_name' => 'Lookalike', 'redirect_uris' => ['https://claude.ai.attacker.test/cb']])
            ->assertStatus(400)->assertJsonPath('error', 'invalid_redirect_uri');
        $this->postJson('/oauth/register', ['client_name' => 'Claude Code', 'redirect_uris' => ['http://localhost:53123/callback']])
            ->assertCreated()->assertJsonPath('token_endpoint_auth_method', 'none');
        $created = $this->postJson('/oauth/register', ['client_name' => 'Claude', 'redirect_uris' => [self::CALLBACK]])->assertCreated()->json();
        $this->assertTrue(Str::isUuid($created['client_id']));

        for ($attempt = 0; $attempt < 10; $attempt++) {
            $last = $this->postJson('/oauth/register', ['client_name' => 'Claude', 'redirect_uris' => [self::CALLBACK]]);
        }
        $last->assertStatus(429);
    }

    public function test_a_signed_out_person_signs_in_on_the_portal_first(): void
    {
        $client = $this->register();
        [, $challenge] = $this->pkce();
        $authorize = $this->authorizeUrl($client, $challenge);

        $response = $this->get($authorize)->assertRedirect();
        $location = (string) $response->headers->get('Location');
        $this->assertStringStartsWith(self::PORTAL.'/connect?return=', $location);
        parse_str((string) parse_url($location, PHP_URL_QUERY), $query);
        $this->assertStringStartsWith(url('/oauth/authorize').'?', $query['return']);
        parse_str((string) parse_url($query['return'], PHP_URL_QUERY), $returned);
        parse_str((string) parse_url($authorize, PHP_URL_QUERY), $sent);
        $this->assertEqualsCanonicalizing($sent, $returned);
    }

    public function test_connecting_with_consent_issues_tokens_for_the_chosen_organization(): void
    {
        $client = $this->register();
        [$verifier, $challenge] = $this->pkce();

        $this->actingAs($this->person)->get($this->authorizeUrl($client, $challenge))->assertRedirect(self::PORTAL.'/connect');
        $pending = $this->stateful()->actingAs($this->person)->getJson('/api/v1/agent-authorizations/current')->assertOk()->json('data');
        $this->assertSame('Claude', $pending['client']['name']);
        $this->assertTrue($pending['client']['self_declared']);
        $this->assertSame('claude.ai', $pending['redirect_host']);
        $this->assertSame(['read', 'draft'], $pending['access_levels']);
        $organizations = collect($pending['organizations'])->keyBy('name');
        $this->assertTrue($organizations['Acme Manufacturing']['available']);
        $this->assertFalse($organizations['Northstar Utilities']['available']);
        $this->assertSame('switched_off', $organizations['Northstar Utilities']['reason']);

        $this->approve($pending['auth_token'], $this->northstar, 'read')->assertForbidden();
        $this->approve('not-the-token', $this->acme, 'read')->assertStatus(409);

        // The mismatch consumed the request, as Passport does; the agent starts again.
        $this->actingAs($this->person)->get($this->authorizeUrl($client, $challenge))->assertRedirect();
        $token = $this->stateful()->actingAs($this->person)->getJson('/api/v1/agent-authorizations/current')->json('data.auth_token');
        $redirect = $this->approve($token, $this->acme, 'draft')->assertOk()->json('data.redirect_to');
        $this->assertStringStartsWith(self::CALLBACK.'?', $redirect);
        parse_str((string) parse_url($redirect, PHP_URL_QUERY), $query);
        $this->assertSame('state-123', $query['state']);

        $connection = AgentConnection::query()->active()->where('user_id', $this->person->id)->firstOrFail();
        $this->assertSame($this->acme->id, $connection->organization_id);
        $this->assertSame(AccessLevel::DRAFT, $connection->access_level);
        $this->assertSame($client, (string) $connection->oauth_client_id);

        $this->forgetSignIn();
        $this->exchange($client, 'wrong-verifier-'.Str::random(43), $query['code'])->assertStatus(400)->assertJsonPath('error', 'invalid_grant');
        $tokens = $this->exchange($client, $verifier, $query['code'])->assertOk()->json();
        $this->assertSame('Bearer', $tokens['token_type']);
        $this->assertSame(3600, $tokens['expires_in']);
        $this->exchange($client, $verifier, $query['code'])->assertStatus(400)->assertJsonPath('error', 'invalid_grant');

        $refreshed = $this->post('/oauth/token', ['grant_type' => 'refresh_token', 'client_id' => $client, 'refresh_token' => $tokens['refresh_token']])->assertOk()->json();
        $this->assertNotSame($tokens['refresh_token'], $refreshed['refresh_token']);
        $this->post('/oauth/token', ['grant_type' => 'refresh_token', 'client_id' => $client, 'refresh_token' => $tokens['refresh_token']])
            ->assertStatus(400)->assertJsonPath('error', 'invalid_grant');
    }

    public function test_approving_again_replaces_the_connection_and_revokes_its_tokens(): void
    {
        $client = $this->register();
        $first = $this->connect($client, $this->acme, 'read');
        $issued = $this->agentTokenRows($this->person, $client);
        $this->northstar->forceFill(['agent_access_enabled' => true])->save();

        $second = $this->connect($client, $this->northstar, 'draft');

        $this->assertSame(RevocationReason::REPLACED, $first->fresh()->revoked_reason);
        $this->assertTrue((bool) Passport::token()->newQuery()->findOrFail($issued['access'])->revoked);
        $this->assertTrue((bool) Passport::refreshToken()->newQuery()->findOrFail($issued['refresh'])->revoked);
        $this->assertNull($second->revoked_at);
        $this->assertSame($this->northstar->id, $second->organization_id);
        $this->assertSame(1, AgentConnection::query()->active()->where('user_id', $this->person->id)->count());
    }

    public function test_denying_sends_access_denied_to_the_agent(): void
    {
        $client = $this->register();
        [, $challenge] = $this->pkce();
        $this->actingAs($this->person)->get($this->authorizeUrl($client, $challenge));
        $token = $this->stateful()->actingAs($this->person)->getJson('/api/v1/agent-authorizations/current')->json('data.auth_token');

        $redirect = $this->stateful()->actingAs($this->person)->postJson('/api/v1/agent-authorizations/deny', ['auth_token' => $token])->assertOk()->json('data.redirect_to');

        parse_str((string) parse_url($redirect, PHP_URL_QUERY), $query);
        $this->assertSame('access_denied', $query['error']);
        $this->assertSame('state-123', $query['state']);
        $this->assertSame(0, AgentConnection::count());
        $this->stateful()->actingAs($this->person)->getJson('/api/v1/agent-authorizations/current')->assertNotFound();
    }

    public function test_a_resource_other_than_the_mcp_endpoint_is_refused(): void
    {
        $client = $this->register();
        [, $challenge] = $this->pkce();

        $this->actingAs($this->person)->get($this->authorizeUrl($client, $challenge, 'https://other.example.test/mcp'))
            ->assertStatus(400)->assertJsonPath('error', 'invalid_target');
        $this->actingAs($this->person)->get($this->authorizeUrl($client, $challenge, url('/mcp').'/'))->assertRedirect(self::PORTAL.'/connect');
        $this->forgetSignIn();
        $this->post('/oauth/token', ['grant_type' => 'authorization_code', 'client_id' => $client, 'code' => 'x', 'code_verifier' => 'y', 'redirect_uri' => self::CALLBACK, 'resource' => 'https://other.example.test/mcp'])
            ->assertStatus(400)->assertJsonPath('error', 'invalid_target');
    }

    public function test_an_agent_token_reaches_neither_the_portal_nor_the_integration_api(): void
    {
        $client = $this->register();
        $tokens = $this->tokensFor($client);

        $this->forgetSignIn();
        $this->withToken($tokens['access_token'])->getJson('/api/v1/me')->assertUnauthorized();
        $this->forgetSignIn();
        $this->withToken($tokens['access_token'])->getJson('/api/integration/v1/organizations/'.$this->acme->uuid.'/devices')->assertUnauthorized();
    }

    private function stateful(): static
    {
        return $this->withHeader('Origin', 'http://localhost');
    }

    private function forgetSignIn(): void
    {
        Auth::forgetGuards();
        $this->flushSession();
        $this->withoutToken();
        $this->app['auth']->shouldUse('web');
    }

    private function register(): string
    {
        return $this->postJson('/oauth/register', ['client_name' => 'Claude', 'redirect_uris' => [self::CALLBACK]])->assertCreated()->json('client_id');
    }

    /** @return array{string, string} a PKCE verifier and its S256 challenge */
    private function pkce(): array
    {
        $verifier = Str::random(64);

        return [$verifier, rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=')];
    }

    private function authorizeUrl(string $client, string $challenge, ?string $resource = null): string
    {
        return '/oauth/authorize?'.http_build_query(array_filter([
            'response_type' => 'code', 'client_id' => $client, 'redirect_uri' => self::CALLBACK, 'scope' => 'mcp:use',
            'state' => 'state-123', 'code_challenge' => $challenge, 'code_challenge_method' => 'S256', 'resource' => $resource ?? url('/mcp'),
        ]));
    }

    private function approve(string $authToken, Organization $organization, string $level)
    {
        return $this->stateful()->actingAs($this->person)->postJson('/api/v1/agent-authorizations/approve', [
            'auth_token' => $authToken, 'organization_uuid' => $organization->uuid, 'access_level' => $level,
        ]);
    }

    private function exchange(string $client, string $verifier, string $code)
    {
        return $this->post('/oauth/token', [
            'grant_type' => 'authorization_code', 'client_id' => $client, 'redirect_uri' => self::CALLBACK,
            'code_verifier' => $verifier, 'code' => $code, 'resource' => url('/mcp'),
        ]);
    }

    private function connect(string $client, Organization $organization, string $level): AgentConnection
    {
        [, $challenge] = $this->pkce();
        $this->actingAs($this->person)->get($this->authorizeUrl($client, $challenge))->assertRedirect();
        $token = $this->stateful()->actingAs($this->person)->getJson('/api/v1/agent-authorizations/current')->json('data.auth_token');
        $this->approve($token, $organization, $level)->assertOk();

        return AgentConnection::query()->active()->where('user_id', $this->person->id)->where('oauth_client_id', $client)->firstOrFail();
    }

    /** @return array{access_token: string, refresh_token: string} */
    private function tokensFor(string $client): array
    {
        [$verifier, $challenge] = $this->pkce();
        $this->actingAs($this->person)->get($this->authorizeUrl($client, $challenge))->assertRedirect();
        $token = $this->stateful()->actingAs($this->person)->getJson('/api/v1/agent-authorizations/current')->json('data.auth_token');
        parse_str((string) parse_url($this->approve($token, $this->acme, 'read')->json('data.redirect_to'), PHP_URL_QUERY), $query);
        $this->forgetSignIn();

        return $this->exchange($client, $verifier, $query['code'])->assertOk()->json();
    }
}
