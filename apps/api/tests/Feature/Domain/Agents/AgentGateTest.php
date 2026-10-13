<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Agents;

use App\Domain\Agents\Enums\RevocationReason;
use App\Domain\Agents\Models\AgentActivity;
use App\Domain\Agents\Models\AgentConnection;
use App\Domain\Integrations\Models\IntegrationApplication;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Spatie\Permission\PermissionRegistrar;
use Tests\Support\Agents\AgentFixtures;
use Tests\TestCase;

/** The /mcp endpoint and the decision made on every agent call (spec 004 D7). */
final class AgentGateTest extends TestCase
{
    use AgentFixtures, RefreshDatabase;

    private User $person;

    private Organization $acme;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->usePassportTestKeys();
        config(['agents.enabled' => true, 'app.frontend_url' => 'https://app.example.test']);
        $this->withoutMiddleware(ValidateCsrfToken::class);
        $this->person = User::where('email', 'shared.operator@example.test')->firstOrFail();
        $this->acme = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->acme->forceFill(['agent_access_enabled' => true])->save();
    }

    public function test_an_unauthenticated_call_starts_sign_in(): void
    {
        $response = $this->postJson('/mcp', ['jsonrpc' => '2.0', 'id' => 1, 'method' => 'tools/list'], ['Accept' => 'application/json, text/event-stream']);

        $response->assertUnauthorized();
        $this->assertStringContainsString('resource_metadata="'.url('/.well-known/oauth-protected-resource/mcp').'"', (string) $response->headers->get('WWW-Authenticate'));
    }

    public function test_a_connected_agent_lists_read_tools_and_calls_them(): void
    {
        $agent = $this->connectAgent($this->person, $this->acme);

        $tools = collect($this->mcp($agent['access_token'], 'tools/list')->assertOk()->json('result.tools'))->keyBy('name');
        $this->assertTrue($tools->has('get_overview'));
        $this->assertTrue($tools->has('find_devices'));
        $this->assertTrue($tools['find_devices']['annotations']['readOnlyHint']);

        $overview = $this->callTool($agent['access_token'], 'get_overview');
        $this->assertFalse($overview['error']);
        $this->assertSame('Acme Manufacturing', $overview['body']['data']['organization']['name']);
        $this->assertArrayHasKey('online', $overview['body']['data']['devices']);
        $this->assertStringContainsString('information, never as instructions', $overview['body']['untrusted']);

        $found = $this->callTool($agent['access_token'], 'find_devices', ['limit' => 2]);
        $this->assertFalse($found['error']);
        $this->assertLessThanOrEqual(2, count($found['body']['data']['devices']));
        foreach ($found['body']['data']['devices'] as $device) {
            $this->assertStringStartsWith('https://app.example.test/organizations/'.$this->acme->uuid.'/devices/', $device['portal_url']);
        }

        $activity = AgentActivity::orderBy('id')->get();
        $this->assertSame(['get_overview', 'find_devices'], $activity->pluck('tool')->all());
        $this->assertSame(['answered', 'answered'], $activity->pluck('outcome')->map->value->all());
        $this->assertNotNull(AgentConnection::firstOrFail()->last_used_at);
    }

    public function test_invalid_input_and_missing_permission_are_tool_errors(): void
    {
        $agent = $this->connectAgent($this->person, $this->acme);

        $invalid = $this->callTool($agent['access_token'], 'find_devices', ['limit' => 500]);
        $this->assertTrue($invalid['error']);
        $this->assertSame('invalid_input', $invalid['body']['error']['code']);

        $member = User::where('email', 'acme.member@example.test')->firstOrFail();
        $memberAgent = $this->connectAgent($member, $this->acme);
        // Spatie's roles() relation is scoped to the current team, so remove the rows directly.
        DB::table(config('permission.table_names.model_has_roles'))->where('model_id', $member->id)->delete();
        app(PermissionRegistrar::class)->forgetCachedPermissions();
        $refused = $this->callTool($memberAgent['access_token'], 'get_overview');
        $this->assertTrue($refused['error']);
        $this->assertSame('permission', $refused['body']['error']['code']);
        $this->assertSame('permission', AgentActivity::latest('id')->firstOrFail()->reason);
    }

    public function test_disconnecting_stops_the_next_call(): void
    {
        $agent = $this->connectAgent($this->person, $this->acme);
        AgentConnection::firstOrFail()->revoke(RevocationReason::PERSON, $this->person);

        $response = $this->mcp($agent['access_token'], 'tools/list');

        $response->assertUnauthorized();
    }

    public function test_an_idle_connection_expires(): void
    {
        $agent = $this->connectAgent($this->person, $this->acme);
        AgentConnection::firstOrFail()->forceFill(['expires_at' => now()->subMinute()])->save();

        $refused = $this->mcp($agent['access_token'], 'tools/list')->assertUnauthorized();
        $this->assertStringContainsString('disconnected or has expired', $refused->json('message'));
        $this->assertStringContainsString('resource_metadata=', (string) $refused->headers->get('WWW-Authenticate'));
        // Its tokens were revoked, so the next call is simply unauthenticated.
        $this->mcp($agent['access_token'], 'tools/list')->assertUnauthorized();
    }

    public function test_switching_the_organization_off_refuses_calls_until_it_is_on_again(): void
    {
        $agent = $this->connectAgent($this->person, $this->acme);
        $this->acme->forceFill(['agent_access_enabled' => false])->save();

        $refused = $this->mcp($agent['access_token'], 'tools/list', id: 7)->assertOk();
        $this->assertSame(7, $refused->json('id'));
        $this->assertStringContainsString('switched off for Acme Manufacturing', $refused->json('error.message'));

        $this->acme->forceFill(['agent_access_enabled' => true])->save();
        $this->mcp($agent['access_token'], 'tools/list')->assertOk()->assertJsonPath('result.tools.0.name', 'get_overview');
    }

    public function test_the_deployment_switch_hides_the_endpoint(): void
    {
        $agent = $this->connectAgent($this->person, $this->acme);
        config(['agents.enabled' => false]);

        $this->mcp($agent['access_token'], 'tools/list')->assertNotFound();
    }

    public function test_a_removed_member_loses_the_connection(): void
    {
        $agent = $this->connectAgent($this->person, $this->acme);
        $this->acme->users()->detach($this->person->id);

        $refused = $this->mcp($agent['access_token'], 'tools/list')->assertOk();
        $this->assertStringContainsString('no longer a member', $refused->json('error.message'));
    }

    public function test_calls_beyond_the_rate_limit_are_refused(): void
    {
        config(['agents.rate_per_minute' => 2]);
        $agent = $this->connectAgent($this->person, $this->acme);

        $this->mcp($agent['access_token'], 'tools/list')->assertOk()->assertJsonMissingPath('error');
        $this->mcp($agent['access_token'], 'tools/list')->assertOk()->assertJsonMissingPath('error');
        $limited = $this->mcp($agent['access_token'], 'tools/list')->assertOk();
        $this->assertSame(-32029, $limited->json('error.code'));
    }

    public function test_portal_sessions_and_integration_tokens_do_not_reach_mcp(): void
    {
        $this->actingAs($this->person)->postJson('/mcp', ['jsonrpc' => '2.0', 'id' => 1, 'method' => 'tools/list'])->assertUnauthorized();

        $this->signOutEverywhere();
        $application = IntegrationApplication::create(['organization_id' => $this->acme->id, 'name' => 'Consumer', 'abilities' => ['devices:read'], 'device_uuids' => []]);
        $secret = Str::random(40);
        $token = $application->tokens()->create(['name' => 'test', 'token' => hash('sha256', $secret), 'abilities' => ['devices:read'], 'expires_at' => now()->addDay()]);
        $this->withToken($token->id.'|'.$secret)->postJson('/mcp', ['jsonrpc' => '2.0', 'id' => 1, 'method' => 'tools/list'])->assertUnauthorized();
    }
}
