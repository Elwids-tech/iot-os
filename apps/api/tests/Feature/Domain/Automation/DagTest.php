<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Automation;

use App\Domain\Automation\Models\Deployment;
use App\Domain\Automation\Models\Workflow;
use App\Domain\Automation\Services\DagActions;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceConfiguration;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

final class DagTest extends TestCase
{
    use RefreshDatabase;

    private Organization $org;

    private User $actor;

    private string $url;

    private array $graph;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->org = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->actor = User::where('is_super_admin', true)->firstOrFail();
        $this->actingAs($this->actor, 'sanctum');
        $this->url = '/api/v1/organizations/'.$this->org->uuid.'/workflows';
        $profile = DeviceProfile::create(['organization_id' => $this->org->id, 'code' => 'dag', 'name' => 'DAG']);
        $parameter = (string) Str::uuid();
        $canonical = json_encode(['parameters' => [['uuid' => $parameter, 'key' => 'temperature', 'data_type' => 'number', 'unit' => 'C', 'reports_state' => true, 'accepts_command' => true]]]);
        $artifact = DeviceProfileArtifact::create(['device_profile_id' => $profile->id, 'revision' => 1, 'definition' => [], 'definition_hash' => str_repeat('a', 64), 'status' => 'active', 'compiled_at' => now(), 'compiled_by' => $this->actor->id]);
        $device = Device::create(['organization_id' => $this->org->id, 'name' => 'Simulator', 'code' => 'dag-sim', 'lifecycle' => 'active', 'deployment_status' => 'applied', 'deployment_generation' => 1]);
        $configuration = DeviceConfiguration::create(['device_id' => $device->id, 'device_profile_artifact_id' => $artifact->id, 'revision' => 1, 'definition_hash' => str_repeat('b', 64), 'definition' => ['profile_canonical_json' => $canonical, 'mappings' => [['parameter_uuid' => $parameter, 'command_metric' => 'set', 'metric' => 'temperature']]], 'created_at' => now()]);
        $device->update(['applied_configuration_uuid' => $configuration->uuid]);
        $this->graph = ['schema_version' => 'automation-workflow.v2', 'bindings' => [['role' => 'sensor', 'device_uuid' => $device->uuid, 'configuration_uuid' => $configuration->uuid, 'generation' => 1, 'parameter_uuid' => $parameter, 'data_type' => 'number', 'unit' => 'C', 'fresh_seconds' => 120]], 'nodes' => [['id' => 'source', 'type' => 'source.parameter.v1', 'config' => ['binding' => 'sensor']], ['id' => 'compare', 'type' => 'compare.v1', 'config' => ['operator' => 'gt', 'value' => 25]], ['id' => 'command', 'type' => 'action.command.v1', 'config' => ['binding' => 'sensor', 'value' => 0, 'cooldown_seconds' => 60, 'ttl_seconds' => 30]]], 'edges' => [['source' => 'source', 'source_port' => 'out', 'target' => 'compare', 'target_port' => 'in'], ['source' => 'compare', 'source_port' => 'out', 'target' => 'command', 'target_port' => 'in']]];
        config(['devices.runtime_token' => str_repeat('t', 40), 'devices.runtime_url' => 'http://runtime:8081']);
        Http::preventStrayRequests();
        Http::fake(fn ($request) => str_ends_with($request->url(), '/compile') ? Http::response(['valid' => true, 'definition' => $request['workflow'], 'definition_hash' => hash('sha256', json_encode($request['workflow']))]) : Http::response(['already_at_target' => false, 'session_id' => 'sim-session']));
    }

    private function draft(): array
    {
        $this->putJson($this->url.'/dag/settings', ['enabled' => true, 'stopped' => false, 'revision' => 0])->assertOk();

        return $this->postJson($this->url, ['name' => 'DAG', 'workflow' => $this->graph])->assertCreated()->json('data');
    }

    public function test_feature_gate_revision_conflict_layout_and_tenant_isolation(): void
    {
        $this->postJson($this->url, ['name' => 'DAG', 'workflow' => $this->graph])->assertForbidden();
        $w = $this->draft();
        $this->assertSame(0, $w['layout_revision']);
        $this->assertSame(0, $w['deployment_generation']);
        $base = $this->url.'/'.$w['uuid'];
        $this->putJson($base.'/layout', ['layout_revision' => 0, 'layout' => ['positions' => ['source' => ['x' => 20, 'y' => 30]]]])->assertOk()->assertJsonPath('data.draft_revision', 1)->assertJsonPath('data.definition_hash', $w['definition_hash'])->assertJsonPath('data.layout_revision', 1);
        $this->putJson($base.'/layout', ['layout_revision' => 0, 'layout' => ['positions' => []]])->assertConflict();
        $this->putJson($base, ['name' => 'Edited', 'workflow' => $w['workflow'], 'draft_revision' => 1])->assertOk()->assertJsonPath('data.draft_revision', 2);
        $this->putJson($base, ['name' => 'Stale', 'workflow' => $w['workflow'], 'draft_revision' => 1])->assertConflict();
        $other = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $this->getJson('/api/v1/organizations/'.$other->uuid.'/workflows/'.$w['uuid'])->assertNotFound();
        $this->actingAs(User::where('email', 'acme.member@example.test')->firstOrFail(), 'sanctum');
        $this->getJson($base)->assertOk();
        $this->putJson($base, [])->assertForbidden();
        $this->postJson($base.'/deployments', [])->assertForbidden();
    }

    public function test_activation_grants_are_immutable_and_retries_do_not_duplicate(): void
    {
        $w = $this->draft();
        $base = $this->url.'/'.$w['uuid'];
        $input = ['operation_uuid' => (string) Str::uuid(), 'target_state' => 'active', 'draft_revision' => 1, 'expected_generation' => 0];
        $this->postJson($base.'/deployments', $input)->assertUnprocessable();
        $input['command_grants'] = [['node_id' => 'command', 'binding' => 'sensor', 'value' => 0, 'cooldown_seconds' => 60, 'max_per_minute' => 1, 'expires_at' => now()->addDay()->toIso8601String()]];
        $this->postJson($base.'/deployments', $input)->assertStatus(202)->assertJsonPath('data.deployment_status', 'pending');
        $this->postJson($base.'/deployments', $input)->assertStatus(202);
        $this->assertDatabaseCount('automation_deployments', 1);
        $this->assertDatabaseCount('device_outbox', 1);
        $input['command_grants'][0]['value'] = 10;
        $this->postJson($base.'/deployments', $input)->assertConflict();
        $d = Deployment::firstOrFail();
        $this->expectException(\LogicException::class);
        $d->update(['command_grants' => []]);
    }

    public function test_action_dedupe_stop_expiry_and_uncertain_delivery(): void
    {
        $w = $this->draft();
        $workflow = Workflow::firstOrFail();
        $operation = (string) Str::uuid();
        $graph = $w['workflow'];
        $graph['version_uuid'] = $operation;
        $d = Deployment::create(['uuid' => $operation, 'automation_workflow_id' => $workflow->id, 'generation' => 1, 'draft_revision' => 1, 'target' => 'active', 'definition' => $graph, 'definition_hash' => str_repeat('a', 64), 'command_grants' => [['node_id' => 'command', 'binding' => 'sensor', 'value' => 0, 'cooldown_seconds' => 60, 'max_per_minute' => 1, 'expires_at' => now()->addDay()->toIso8601String()]], 'status' => 'succeeded', 'created_by' => $this->actor->id, 'created_at' => now()]);
        $workflow->update(['applied_deployment_uuid' => $operation, 'desired_deployment_uuid' => $operation]);
        $intent = ['id' => hash('sha256', 'action-one'), 'operation_uuid' => $operation, 'organization_uuid' => $this->org->uuid, 'workflow_uuid' => $workflow->uuid, 'node_id' => 'command', 'kind' => 'action.command.v1', 'config' => $graph['nodes'][2]['config'], 'expires_at' => now()->addSeconds(30)->toIso8601String(), 'occurred_at' => now()->toIso8601String(), 'trigger' => 'episode:1', 'correlation_key' => 'default'];
        $actions = app(DagActions::class);
        DB::transaction(function () use ($actions, $intent) {
            $actions->accept($intent);
            $actions->accept($intent);
        });
        $this->assertDatabaseCount('automation_actions', 1);
        $actions->tick($intent['id']);
        $command = DB::table('device_commands')->first();
        $this->assertNotNull($command);
        $this->assertTrue($actions->authorizeDispatch($intent['id'], $command->uuid));
        $this->assertFalse($actions->authorizeDispatch($intent['id'], (string) Str::uuid()));
        $actions->tick($intent['id']);
        $this->assertDatabaseCount('device_commands', 1);
        DB::table('device_commands')->where('id', $command->id)->update(['status' => 'uncertain', 'outstanding_key' => null]);
        $actions->tick($intent['id']);
        $this->assertDatabaseHas('automation_actions', ['id' => $intent['id'], 'status' => 'uncertain']);
        $intent['id'] = hash('sha256', 'action-two');
        DB::transaction(fn () => $actions->accept($intent));
        $actions->tick($intent['id']);
        $this->assertDatabaseHas('automation_actions', ['id' => $intent['id'], 'status' => 'failed']);
        $this->assertDatabaseCount('device_commands', 1);
        $intent['id'] = hash('sha256', 'action-three');
        $intent['expires_at'] = now()->subSecond()->toIso8601String();
        DB::transaction(fn () => $actions->accept($intent));
        $actions->tick($intent['id']);
        $this->assertDatabaseHas('automation_actions', ['id' => $intent['id'], 'status' => 'expired']);
        $intent['id'] = hash('sha256', 'action-four');
        $intent['expires_at'] = now()->addMinute()->toIso8601String();
        DB::transaction(fn () => $actions->accept($intent));
        $this->putJson($this->url.'/dag/settings', ['enabled' => true, 'stopped' => true, 'revision' => 1])->assertOk();
        $actions->tick($intent['id']);
        $this->assertDatabaseHas('automation_actions',['id' => $intent['id'], 'status' => 'cancelled']);
    }
}
