<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Agents;

use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

final class AgentAccessSettingsTest extends TestCase
{
    use RefreshDatabase;

    private Organization $acme;

    private string $url;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        config(['agents.enabled' => true]);
        $this->acme = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->url = '/api/v1/organizations/'.$this->acme->uuid.'/agent-access';
    }

    private function person(string $email): User
    {
        return User::where('email', $email)->firstOrFail();
    }

    public function test_the_deployment_switch_hides_agent_access(): void
    {
        config(['agents.enabled' => false]);
        $admin = $this->person('shared.operator@example.test');

        $this->actingAs($admin)->getJson($this->url)->assertNotFound();
        $this->actingAs($admin)->putJson($this->url, ['enabled' => true])->assertNotFound();
        $this->actingAs($admin)->getJson('/api/v1/me')->assertOk()
            ->assertJsonPath('data.organizations.0.capabilities.features.agent_access', false);
        $this->assertFalse((bool) $this->acme->fresh()->agent_access_enabled);
    }

    public function test_organizations_start_switched_off(): void
    {
        $this->assertFalse((bool) Organization::factory()->create()->fresh()->agent_access_enabled);
        $this->assertFalse((bool) $this->acme->agent_access_enabled);
    }

    public function test_members_read_the_setting_and_only_administrators_change_it(): void
    {
        $member = $this->person('acme.member@example.test');
        $admin = $this->person('shared.operator@example.test');

        $this->actingAs($member)->getJson($this->url)->assertOk()
            ->assertExactJson(['data' => ['enabled' => false, 'can_manage' => false, 'connector_url' => config('agents.resource')]]);
        $this->actingAs($member)->putJson($this->url, ['enabled' => true])->assertForbidden();
        $this->assertFalse((bool) $this->acme->fresh()->agent_access_enabled);

        $this->actingAs($admin)->putJson($this->url, ['enabled' => true])->assertOk()
            ->assertJsonPath('data.enabled', true)->assertJsonPath('data.can_manage', true);
        $this->assertTrue((bool) $this->acme->fresh()->agent_access_enabled);
        $this->assertNotNull($this->acme->fresh()->agent_access_changed_at);
        $this->actingAs($member)->getJson($this->url)->assertOk()->assertJsonPath('data.enabled', true);

        $this->actingAs($admin)->putJson($this->url, ['enabled' => false])->assertOk()->assertJsonPath('data.enabled', false);
        $actions = DB::table('device_audit_events')->where('organization_id', $this->acme->id)->where('actor_id', $admin->id)
            ->where('action', 'like', 'agents.%')->orderBy('id')->pluck('action')->all();
        $this->assertSame(['agents.access_enabled', 'agents.access_disabled'], $actions);
        $this->actingAs($admin)->putJson($this->url, ['enabled' => 'sometimes'])->assertUnprocessable();
    }

    public function test_capabilities_carry_the_switch_and_who_may_change_it(): void
    {
        $this->acme->forceFill(['agent_access_enabled' => true])->save();
        $admin = $this->person('shared.operator@example.test');
        $member = $this->person('acme.member@example.test');

        $organizations = collect($this->actingAs($admin)->getJson('/api/v1/me')->assertOk()->json('data.organizations'))->keyBy('slug');
        $this->assertSame(['enabled' => true, 'manage' => true], $organizations['acme-manufacturing']['capabilities']['agents']);
        $this->assertSame(['enabled' => false, 'manage' => false], $organizations['northstar-utilities']['capabilities']['agents']);
        $this->assertTrue($organizations['acme-manufacturing']['capabilities']['features']['agent_access']);

        $this->actingAs($member)->getJson('/api/v1/organizations/'.$this->acme->uuid.'/context')->assertOk()
            ->assertJsonPath('data.capabilities.agents', ['enabled' => true, 'manage' => false]);
    }

    public function test_another_organizations_administrator_cannot_change_it(): void
    {
        $other = $this->person('northstar.admin@example.test');

        $this->actingAs($other)->putJson($this->url, ['enabled' => true])->assertForbidden();
        $this->actingAs($other)->getJson($this->url)->assertForbidden();
        $this->assertFalse((bool) $this->acme->fresh()->agent_access_enabled);
    }
}
