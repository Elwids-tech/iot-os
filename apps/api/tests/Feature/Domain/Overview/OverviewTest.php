<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Overview;

use App\Domain\Automation\Models\Alert;
use App\Domain\Automation\Models\Deployment;
use App\Domain\Automation\Models\Workflow;
use App\Domain\Devices\Models\Device;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

final class OverviewTest extends TestCase
{
    use RefreshDatabase;

    private Organization $org;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->org = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
    }

    private function device(Organization $org, string $code, string $lifecycle, string $presence, ?int $runtimeSecondsAgo = null, ?int $seenHoursAgo = null): Device
    {
        return Device::create(['organization_id' => $org->id, 'name' => ucfirst($code), 'code' => $code, 'lifecycle' => $lifecycle, 'presence' => $presence,
            'runtime_seen_at' => $runtimeSecondsAgo === null ? null : now()->subSeconds($runtimeSecondsAgo),
            'last_seen_at' => $seenHoursAgo === null ? null : now()->subHours($seenHoursAgo)]);
    }

    private function alert(Organization $org, Device $device, bool $active, bool $acknowledged): void
    {
        $definition = ['binding' => ['device_uuid' => $device->uuid]];
        $actor = User::where('is_super_admin', true)->firstOrFail();
        $workflow = Workflow::create(['organization_id' => $org->id, 'name' => 'Boundary '.Str::random(4), 'workflow' => ['nodes' => []], 'definition' => $definition, 'definition_hash' => str_repeat('a', 64), 'updated_by' => $actor->id]);
        $deployment = Deployment::create(['automation_workflow_id' => $workflow->id, 'generation' => 1, 'draft_revision' => 1, 'target' => 'active', 'status' => 'succeeded', 'definition' => $definition, 'definition_hash' => str_repeat('a', 64), 'created_by' => $actor->id, 'created_at' => now()]);
        Alert::create(['organization_id' => $org->id, 'automation_workflow_id' => $workflow->id, 'automation_deployment_id' => $deployment->id, 'episode' => 1, 'activated_at' => now()->subHour(),
            'cleared_at' => $active ? null : now(), 'acknowledged_at' => $acknowledged ? now() : null]);
    }

    public function test_home_summarizes_attention_items_with_the_device_list_presence_rule(): void
    {
        $online = $this->device($this->org, 'online', 'active', 'online', 5, 0);
        $this->device($this->org, 'stale-online', 'active', 'online', 120, 30);
        $this->device($this->org, 'offline', 'active', 'offline', null, 2);
        $this->device($this->org, 'new', 'registered', 'unseen');
        $this->device($this->org, 'retired', 'archived', 'offline');
        $this->alert($this->org, $online, active: true, acknowledged: false);
        $this->alert($this->org, $online, active: false, acknowledged: false);
        $northstar = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $this->alert($northstar, $this->device($northstar, 'foreign', 'active', 'online', 5, 0), active: true, acknowledged: false);

        $this->actingAs(User::where('email', 'acme.member@example.test')->firstOrFail(), 'sanctum');
        $this->getJson('/api/v1/organizations/'.$this->org->uuid.'/overview')->assertOk()
            ->assertJsonPath('data.devices.active', 3)
            ->assertJsonPath('data.devices.online', 1)
            ->assertJsonPath('data.devices.unknown', 1)
            ->assertJsonPath('data.devices.offline', 1)
            ->assertJsonPath('data.devices.registered', 1)
            ->assertJsonPath('data.devices.silent', 1)
            ->assertJsonPath('data.alerts.active', 1)
            ->assertJsonPath('data.alerts.active_unacknowledged', 1)
            ->assertJsonPath('data.alerts.unacknowledged', 2)
            ->assertJsonPath('data.alerts.latest_active.0.device_name', 'Online')
            ->assertJsonCount(1, 'data.alerts.latest_active');

        $this->actingAs(User::where('email', 'northstar.member@example.test')->firstOrFail(), 'sanctum');
        $this->getJson('/api/v1/organizations/'.$this->org->uuid.'/overview')->assertForbidden();
    }
}
