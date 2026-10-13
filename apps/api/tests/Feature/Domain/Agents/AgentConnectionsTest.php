<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Agents;

use App\Domain\Agents\Enums\RevocationReason;
use App\Domain\Agents\Models\AgentConnection;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Support\Agents\AgentFixtures;
use Tests\TestCase;

/** Connected AI apps: people manage their own connections; administrators oversee everyone's. */
final class AgentConnectionsTest extends TestCase
{
    use AgentFixtures, RefreshDatabase;

    private Organization $acme;

    private User $admin;

    private User $member;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->usePassportTestKeys();
        config(['agents.enabled' => true, 'app.frontend_url' => 'https://app.example.test']);
        $this->withoutMiddleware(ValidateCsrfToken::class);
        $this->acme = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->acme->forceFill(['agent_access_enabled' => true])->save();
        $this->admin = User::where('email', 'shared.operator@example.test')->firstOrFail();
        $this->member = User::where('email', 'acme.member@example.test')->firstOrFail();
    }

    private function portal(User $user): static
    {
        $this->signOutEverywhere();

        return $this->actingAs($user, 'web');
    }

    public function test_people_list_and_disconnect_their_own_connections(): void
    {
        $agent = $this->connectAgent($this->member, $this->acme);
        $this->callTool($agent['access_token'], 'get_overview');

        $mine = $this->portal($this->member)->getJson('/api/v1/me/agent-connections')->assertOk()->json('data');
        $this->assertCount(1, $mine);
        $this->assertSame('Claude', $mine[0]['agent']['name']);
        $this->assertSame('claude.ai', $mine[0]['agent']['redirect_host']);
        $this->assertSame('Acme Manufacturing', $mine[0]['organization']['name']);
        $this->assertSame('active', $mine[0]['state']);
        $this->assertNotNull($mine[0]['last_used_at']);

        $this->portal($this->admin)->getJson('/api/v1/me/agent-connections')->assertOk()->assertJsonCount(0, 'data');
        $this->portal($this->admin)->deleteJson('/api/v1/me/agent-connections/'.$mine[0]['uuid'])->assertNotFound();

        $activity = $this->portal($this->member)->getJson('/api/v1/organizations/'.$this->acme->uuid.'/agent-connections/'.$mine[0]['uuid'].'/activity')->assertOk();
        $activity->assertJsonPath('data.0.tool', 'get_overview')->assertJsonPath('data.0.outcome', 'answered');

        $this->portal($this->member)->deleteJson('/api/v1/me/agent-connections/'.$mine[0]['uuid'])->assertNoContent();
        $this->assertSame(RevocationReason::PERSON, AgentConnection::firstOrFail()->revoked_reason);
        $this->mcp($agent['access_token'], 'tools/list')->assertUnauthorized();
        $this->portal($this->member)->getJson('/api/v1/me/agent-connections')->assertJsonPath('data.0.state', 'revoked');
    }

    public function test_administrators_see_and_disconnect_every_connection_and_members_do_not(): void
    {
        $agent = $this->connectAgent($this->member, $this->acme);
        $uuid = AgentConnection::firstOrFail()->uuid;

        $this->portal($this->member)->getJson('/api/v1/organizations/'.$this->acme->uuid.'/agent-connections')->assertForbidden();
        $this->portal($this->member)->deleteJson('/api/v1/organizations/'.$this->acme->uuid.'/agent-connections/'.$uuid)->assertForbidden();

        $all = $this->portal($this->admin)->getJson('/api/v1/organizations/'.$this->acme->uuid.'/agent-connections')->assertOk();
        $all->assertJsonPath('data.0.user.email', 'acme.member@example.test');
        $this->portal($this->admin)->getJson('/api/v1/organizations/'.$this->acme->uuid.'/agent-connections/'.$uuid.'/activity')->assertOk();

        $this->portal($this->admin)->deleteJson('/api/v1/organizations/'.$this->acme->uuid.'/agent-connections/'.$uuid)->assertNoContent();
        $this->assertSame(RevocationReason::ADMINISTRATOR, AgentConnection::firstOrFail()->revoked_reason);
        $this->assertTrue(DB::table('device_audit_events')->where('action', 'agents.connection_revoked')->where('resource_uuid', $uuid)->where('actor_id', $this->admin->id)->exists());
        $this->mcp($agent['access_token'], 'tools/list')->assertUnauthorized();
        $this->portal($this->member)->getJson('/api/v1/me/agent-connections')->assertJsonPath('data.0.revoked_reason', 'administrator');
    }

    public function test_switching_the_organization_off_shows_connections_as_unavailable(): void
    {
        $this->connectAgent($this->member, $this->acme);
        $this->portal($this->admin)->putJson('/api/v1/organizations/'.$this->acme->uuid.'/agent-access', ['enabled' => false])->assertOk();

        $this->portal($this->member)->getJson('/api/v1/me/agent-connections')->assertJsonPath('data.0.state', 'unavailable');
        $pending = $this->portal($this->member)->getJson('/api/v1/agent-authorizations/current');
        $pending->assertNotFound();
    }

    public function test_another_organization_cannot_reach_a_connection(): void
    {
        $this->connectAgent($this->member, $this->acme);
        $uuid = AgentConnection::firstOrFail()->uuid;
        $northstar = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $northstarAdmin = User::where('email', 'northstar.admin@example.test')->firstOrFail();

        $this->portal($northstarAdmin)->getJson('/api/v1/organizations/'.$northstar->uuid.'/agent-connections')->assertOk()->assertJsonCount(0, 'data');
        $this->portal($northstarAdmin)->deleteJson('/api/v1/organizations/'.$northstar->uuid.'/agent-connections/'.$uuid)->assertNotFound();
        $this->portal($northstarAdmin)->getJson('/api/v1/organizations/'.$northstar->uuid.'/agent-connections/'.$uuid.'/activity')->assertNotFound();
        $this->assertNull(AgentConnection::firstOrFail()->revoked_at);
    }
}
