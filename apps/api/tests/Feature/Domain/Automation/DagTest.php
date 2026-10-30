<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Automation;

use App\Domain\Automation\Models\Deployment;
use App\Domain\Automation\Models\Workflow;
use App\Domain\Automation\Services\DagActions;
use App\Domain\Automation\Services\WorkflowDeploymentService;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceConfiguration;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Factory;
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
        $this->putJson($base.'/layout', ['layout_revision' => 1, 'layout' => ['positions' => [], 'labels' => ['source' => str_repeat('x', 81)]]])->assertUnprocessable();
        $this->putJson($base.'/layout', ['layout_revision' => 1, 'layout' => ['positions' => [], 'labels' => ['source' => 'Probe temperature']]])->assertOk()->assertJsonPath('data.layout.labels.source', 'Probe temperature')->assertJsonPath('data.definition_hash', $w['definition_hash']);
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

    public function test_grants_without_expiry_stay_current_and_expired_grants_stop_commands(): void
    {
        $w = $this->draft();
        $base = $this->url.'/'.$w['uuid'];
        $grant = ['node_id' => 'command', 'binding' => 'sensor', 'value' => 0, 'cooldown_seconds' => 60, 'max_per_minute' => 1, 'expires_at' => null];
        $input = ['operation_uuid' => (string) Str::uuid(), 'target_state' => 'active', 'draft_revision' => 1, 'expected_generation' => 0, 'command_grants' => [$grant]];
        $this->postJson($base.'/deployments', [...$input, 'command_grants' => [[...$grant, 'expires_at' => now()->addYears(2)->toIso8601String()]]])->assertUnprocessable();
        $this->postJson($base.'/deployments', $input)->assertStatus(202);

        $workflow = Workflow::firstOrFail();
        $graph = $w['workflow'];
        $actions = app(DagActions::class);
        foreach (['open' => null, 'expired' => now()->subMinute()->toIso8601String()] as $key => $expiry) {
            $operation = (string) Str::uuid();
            Deployment::create(['uuid' => $operation, 'automation_workflow_id' => $workflow->id, 'generation' => 10 + count(Deployment::all()), 'draft_revision' => 1, 'target' => 'active', 'definition' => [...$graph, 'version_uuid' => $operation], 'definition_hash' => str_repeat('a', 64), 'command_grants' => [[...$grant, 'expires_at' => $expiry]], 'status' => 'succeeded', 'created_by' => $this->actor->id, 'created_at' => now()]);
            $workflow->update(['applied_deployment_uuid' => $operation, 'desired_deployment_uuid' => $operation, 'pending_operation_uuid' => null]);
            DB::table('automation_command_targets')->delete();
            $intent = ['id' => hash('sha256', 'grant-'.$key), 'operation_uuid' => $operation, 'organization_uuid' => $this->org->uuid, 'workflow_uuid' => $workflow->uuid, 'node_id' => 'command', 'kind' => 'action.command.v1', 'config' => $graph['nodes'][2]['config'], 'expires_at' => now()->addSeconds(30)->toIso8601String(), 'occurred_at' => now()->toIso8601String(), 'trigger' => 'episode:1', 'correlation_key' => 'default'];
            DB::transaction(fn () => $actions->accept($intent));
            $actions->tick($intent['id']);
            if ($expiry === null) {
                $command = DB::table('device_commands')->latest('id')->first();
                $this->assertDatabaseHas('automation_actions', ['id' => $intent['id'], 'status' => 'accepted']);
                $this->assertTrue($actions->authorizeDispatch($intent['id'], $command->uuid));
                DB::table('device_commands')->where('id', $command->id)->update(['status' => 'succeeded', 'outstanding_key' => null]);
            } else {
                $this->assertDatabaseHas('automation_actions', ['id' => $intent['id'], 'status' => 'failed', 'diagnostic' => 'Command authorization expired.']);
            }
        }
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
        $this->assertDatabaseHas('automation_actions', ['id' => $intent['id'], 'status' => 'cancelled']);
    }

    public function test_timeline_uses_deployed_snapshot_and_exact_intent_evidence(): void
    {
        $w = $this->draft();
        $workflow = Workflow::where('uuid', $w['uuid'])->firstOrFail();
        $operation = (string) Str::uuid();
        $graph = $w['workflow'];
        $graph['version_uuid'] = $operation;
        $deployment = Deployment::create([
            'uuid' => $operation, 'automation_workflow_id' => $workflow->id,
            'generation' => 1, 'draft_revision' => 1, 'target' => 'active',
            'definition' => $graph, 'definition_hash' => str_repeat('a', 64),
            'command_grants' => [], 'status' => 'succeeded',
            'created_by' => $this->actor->id, 'created_at' => now(),
        ]);
        $id = hash('sha256', 'timeline-action');
        $pending = hash('sha256', 'timeline-pending');
        $intent = ['occurred_at' => now()->toIso8601String(), 'config' => $graph['nodes'][2]['config']];
        DB::table('automation_actions')->insert([
            'id' => $id, 'organization_id' => $this->org->id,
            'automation_deployment_id' => $deployment->id, 'node_id' => 'command',
            'kind' => 'action.command.v1', 'intent' => json_encode($intent),
            'status' => 'observed', 'created_at' => now(), 'updated_at' => now(), 'expires_at' => now()->addMinute(),
        ]);
        $entry = [
            'id' => '17', 'operation_uuid' => $operation, 'at' => now()->toIso8601String(),
            'trigger' => 'telemetry', 'outcome' => 'triggered',
            'source' => ['device_uuid' => $graph['bindings'][0]['device_uuid']],
            'trace' => [['node_id' => 'compare', 'status' => 'matched', 'inputs' => [], 'outputs' => []]],
            'intent_ids' => [$id, $pending], 'trace_truncated' => false,
        ];
        Http::swap(new Factory);
        Http::fake(['*/internal/dag/timeline*' => Http::response(['data' => $entry])]);
        $edited = $graph;
        $edited['nodes'][1]['config']['value'] = 99;
        $workflow->update(['workflow' => $edited, 'draft_revision' => 2]);
        $base = $this->url.'/'.$workflow->uuid.'/timeline';
        $this->getJson($base.'/17')->assertOk()
            ->assertJsonPath('data.draft_revision', 1)
            ->assertJsonPath('data.trace.0.config.value', 25)
            ->assertJsonPath('data.source.device_name', 'Simulator')
            ->assertJsonPath('data.actions.0.id', $id)
            ->assertJsonPath('data.actions.0.status', 'observed')
            ->assertJsonPath('data.actions.0.command', null)
            ->assertJsonPath('data.actions.1.status', 'awaiting_dispatch');
        Http::swap(new Factory);
        Http::fake(['*/internal/dag/timeline*' => Http::response(['data' => [$entry], 'next_cursor' => '17', 'retention_limit' => 1000])]);
        $this->getJson($base.'?before=18')->assertOk()->assertJsonPath('next_cursor', '17');
        Http::assertSent(fn ($request) => str_contains($request->url(), 'before=18'));
        $this->getJson($base.'?before=-1')->assertUnprocessable();
        $this->getJson($base.'/invalid')->assertUnprocessable();
        $other = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $this->getJson('/api/v1/organizations/'.$other->uuid.'/workflows/'.$workflow->uuid.'/timeline')->assertNotFound();
        $entry['operation_uuid'] = (string) Str::uuid();
        Http::swap(new Factory);
        Http::fake(['*/internal/dag/timeline*' => Http::response(['data' => $entry])]);
        $this->getJson($base.'/17')->assertNotFound();
    }

    private function multiSettingGraph(): void
    {
        $configuration = DeviceConfiguration::firstOrFail();
        $definition = $configuration->definition;
        $profile = json_decode($definition['profile_canonical_json'], true);
        $parameter = (string) Str::uuid();
        $profile['parameters'][] = ['uuid' => $parameter, 'key' => 'power', 'label' => 'Power', 'kind' => 'state', 'data_type' => 'boolean', 'reports_state' => true, 'accepts_command' => true];
        $definition['profile_canonical_json'] = json_encode($profile);
        $definition['mappings'][] = ['parameter_uuid' => $parameter, 'command_metric' => 'Power'];
        DB::table('device_configurations')->where('id', $configuration->id)->update(['definition' => json_encode($definition)]);
        $this->graph['bindings'][] = [...$this->graph['bindings'][0], 'role' => 'power', 'parameter_uuid' => $parameter, 'data_type' => 'boolean', 'unit' => ''];
        $this->graph['nodes'][2]['config'] = ['settings' => ['sensor' => 0, 'power' => true], 'cooldown_seconds' => 60, 'ttl_seconds' => 30];
    }

    public function test_multiple_settings_require_exact_grants_and_dispatch_independently(): void
    {
        $this->multiSettingGraph();
        $w = $this->draft();
        $url = $this->url.'/'.$w['uuid'].'/deployments';
        $grant = ['node_id' => 'command', 'binding' => 'sensor', 'value' => 0, 'cooldown_seconds' => 60, 'max_per_minute' => 1, 'expires_at' => now()->addDay()->toIso8601String()];
        $input = ['operation_uuid' => (string) Str::uuid(), 'target_state' => 'active', 'draft_revision' => 1, 'expected_generation' => 0, 'command_grants' => [$grant]];
        $this->postJson($url, $input)->assertUnprocessable();
        $input['command_grants'][] = $grant;
        $this->postJson($url, $input)->assertUnprocessable();
        $input['command_grants'][1] = [...$grant, 'binding' => 'power', 'value' => false];
        $this->postJson($url, $input)->assertUnprocessable();
        $input['command_grants'][1]['value'] = true;
        $this->postJson($url, $input)->assertStatus(202);
        $d = Deployment::firstOrFail();
        Workflow::firstOrFail()->update(['applied_deployment_uuid' => $d->uuid, 'desired_deployment_uuid' => $d->uuid, 'pending_operation_uuid' => null]);
        $actions = app(DagActions::class);
        foreach ($input['command_grants'] as $g) {
            $intent = ['id' => hash('sha256', 'multi-'.$g['binding']), 'operation_uuid' => $d->uuid, 'organization_uuid' => $this->org->uuid, 'workflow_uuid' => $w['uuid'], 'node_id' => 'command', 'kind' => 'action.command.v1', 'config' => ['binding' => $g['binding'], 'value' => $g['value'], 'cooldown_seconds' => 60, 'ttl_seconds' => 30], 'expires_at' => now()->addSeconds(30)->toIso8601String(), 'occurred_at' => now()->toIso8601String(), 'trigger' => 'episode:1:'.$g['binding']];
            DB::transaction(function () use ($actions, $intent) {
                $actions->accept($intent);
                $actions->accept($intent);
            });
            $actions->tick($intent['id']);
            $record = DB::table('automation_actions')->where('id', $intent['id'])->first();
            $this->assertNotNull($record->command_uuid, $record->diagnostic ?? 'No command');
            $this->assertTrue($actions->authorizeDispatch($intent['id'], $record->command_uuid));
        }
        $this->assertDatabaseCount('device_commands', 2);
        $this->assertDatabaseCount('automation_actions', 2);
    }

    public function test_controllable_resources_filter_before_pagination_and_hydrate_selection(): void
    {
        $this->draft();
        $control = Device::firstOrFail();
        $configuration = DeviceConfiguration::firstOrFail();
        for ($i = 0; $i < 26; $i++) {
            $device = $control->replicate(['uuid', 'code', 'applied_configuration_uuid']);
            $device->uuid = (string) Str::uuid();
            $device->code = 'readonly-'.$i;
            $device->name = 'Read only '.$i;
            $device->save();
            $copy = $configuration->replicate(['uuid', 'device_id']);
            $copy->uuid = (string) Str::uuid();
            $copy->device_id = $device->id;
            $definition = $copy->definition;
            $definition['mappings'][0]['command_metric'] = null;
            $copy->definition = $definition;
            $copy->created_at = now();
            $copy->save();
            $device->update(['applied_configuration_uuid' => $copy->uuid]);
        }
        $this->getJson($this->url.'/dag/resources?controllable=1')->assertOk()->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.device_uuid', $control->uuid);
        $this->getJson($this->url.'/dag/resources?controllable=1&device_uuid='.$control->uuid)->assertOk()->assertJsonCount(1, 'data');
        $this->getJson($this->url.'/dag/resources?controllable=1&search=Read')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson($this->url.'/dag/resources')->assertOk()->assertJsonPath('meta.total', 27);
    }

    public function test_resources_give_the_running_poll_interval_of_a_polled_device(): void
    {
        $device = Device::firstOrFail();
        $resource = fn () => collect($this->getJson($this->url.'/dag/resources')->assertOk()->json('data'))->firstWhere('device_uuid', $device->uuid);
        $this->assertNull($resource()['poll_interval_seconds']);
        $row = fn (array $values) => [...$values, 'uuid' => (string) Str::uuid(), 'created_at' => now(), 'updated_at' => now()];
        $poll = ['type' => 'poll', 'interval_seconds' => 600];
        $adapter = DB::table('device_adapters')->insertGetId($row(['organization_id' => $this->org->id, 'device_profile_artifact_id' => DeviceProfileArtifact::firstOrFail()->id, 'name' => 'Vendor API', 'code' => '', 'fixtures' => '[]', 'source' => json_encode([...$poll, 'interval_seconds' => 120]), 'created_by' => $this->actor->id]));
        $revision = $row(['device_adapter_id' => $adapter, 'revision' => 1, 'content_hash' => str_repeat('c', 64), 'definition' => json_encode(['source' => $poll]), 'secret_snapshot' => '', 'created_by' => $this->actor->id]);
        DB::table('device_adapter_revisions')->insert($revision);
        $candidate = DB::table('device_adapter_candidates')->insertGetId($row(['organization_id' => $this->org->id, 'device_adapter_id' => $adapter, 'source_device_id' => 'unit-1', 'sparkplug_device_id' => 'src-unit-1', 'preview' => '{}', 'last_seen_at' => now()]));
        DB::table('device_installations')->insert($row(['organization_id' => $this->org->id, 'device_id' => $device->id, 'device_adapter_candidate_id' => $candidate, 'adapter_revision_uuid' => $revision['uuid'], 'manufacturer_serial' => 'unit-1', 'started_at' => now(), 'created_by' => $this->actor->id]));
        // Until a revision is applied, the saved settings are the only interval there is.
        $this->assertSame(120, $resource()['poll_interval_seconds']);
        DB::table('device_adapters')->where('id', $adapter)->update(['applied_revision_uuid' => $revision['uuid']]);
        $this->assertSame(600, $resource()['poll_interval_seconds']);
        DB::table('device_adapter_revisions')->where('uuid', $revision['uuid'])->update(['definition' => json_encode(['source' => ['type' => 'webhook']])]);
        $this->assertNull($resource()['poll_interval_seconds']);
    }

    public function test_authoring_rejects_invalid_setting_values_and_unmapped_controls(): void
    {
        $this->multiSettingGraph();
        $this->draft();
        $this->graph['nodes'][2]['config']['settings']['power'] = 'true';
        $this->postJson($this->url.'/dag/validate', ['workflow' => $this->graph])->assertUnprocessable();
        $this->graph['nodes'][2]['config']['settings']['power'] = true;
        $configuration = DeviceConfiguration::firstOrFail();
        $definition = $configuration->definition;
        $definition['mappings'][1]['command_metric'] = null;
        DB::table('device_configurations')->where('id', $configuration->id)->update(['definition' => json_encode($definition)]);
        $this->postJson($this->url.'/dag/validate', ['workflow' => $this->graph])->assertUnprocessable();
    }

    public function test_a_device_in_review_is_named_apart_from_a_changed_binding(): void
    {
        $this->freezeTime();
        $draft = $this->draft();
        $workflow = Workflow::where('uuid', $draft['uuid'])->firstOrFail();
        $deployment = fn (int $generation, string $status, ?string $diagnostic = null) => Deployment::create(['uuid' => (string) Str::uuid(), 'automation_workflow_id' => $workflow->id, 'generation' => $generation, 'draft_revision' => 1, 'target' => 'active', 'definition' => $draft['workflow'], 'definition_hash' => str_repeat('a', 64), 'status' => $status, 'diagnostic' => $diagnostic, 'created_by' => $this->actor->id, 'created_at' => now(), 'completed_at' => now()]);
        $issue = fn () => collect($this->getJson($this->url.'/dag')->assertOk()->json('data'))->firstWhere('uuid', $draft['uuid'])['last_issue']['message'] ?? null;

        // The runtime refused activation because the bound device needs review (ADR-025).
        $deployment(1, 'failed', 'device_review_required: sensor');
        $message = 'Device "Simulator" needs review because its source stopped announcing the metrics its configuration was approved for. Review clears when the source announces them again or when you activate the device’s configuration. Then activate this automation again.';
        $this->assertSame('Device "Simulator" needs review: its source no longer announces its approved metrics. Activate again once it does or the device is reactivated.', $issue());
        $this->assertSame($message, $this->getJson($this->url.'/'.$draft['uuid'])->assertOk()->json('data.deployment_diagnostic'));

        // A running execution suspended for review records its own reason; a changed binding still records binding_changed.
        $applied = $deployment(2, 'succeeded');
        $workflow->update(['applied_deployment_uuid' => $applied->uuid, 'desired_deployment_uuid' => $applied->uuid, 'deployment_generation' => 2, 'deployment_status' => 'applied']);
        $suspend = fn (string $reason) => app(WorkflowDeploymentService::class)->event('workflow.suspended.v1', ['rule_uuid' => $workflow->uuid, 'organization_uuid' => $this->org->uuid, 'operation_uuid' => $applied->uuid, 'reason' => $reason]);
        $suspend('device_review_required: sensor');
        $this->assertSame('device_review_required', $applied->fresh()->stopped_reason);
        $this->assertSame('suspended', $workflow->fresh()->deployment_status);
        $this->assertSame('Suspended: a bound device needs review: its source no longer announces its approved metrics. Activate again once it does or the device is reactivated.', $issue());
        $suspend('binding_changed: sensor');
        $this->assertSame('binding_changed', $applied->fresh()->stopped_reason);
        $this->assertSame('Suspended: a bound device configuration changed. Review the bindings and reactivate.', $issue());

        // The editor's live execution says which device needs review.
        Http::swap(new Factory);
        Http::fake(['*/internal/dag/execution*' => Http::response(['enabled' => false, 'stopped_reason' => 'device_review_required: sensor', 'consumer_healthy' => true])]);
        $this->assertSame($message, $this->getJson($this->url.'/'.$draft['uuid'].'/execution')->assertOk()->json('data.stopped_reason'));
    }

    public function test_directory_summarises_triggers_activity_and_issues_with_a_fixed_query_count(): void
    {
        $this->freezeTime();
        $first = $this->draft();
        $workflow = Workflow::where('uuid', $first['uuid'])->firstOrFail();
        $deployment = fn (int $generation, string $status, $at, ?string $diagnostic = null) => Deployment::create(['uuid' => (string) Str::uuid(), 'automation_workflow_id' => $workflow->id, 'generation' => $generation, 'draft_revision' => 1, 'target' => 'active', 'definition' => $first['workflow'], 'definition_hash' => str_repeat('a', 64), 'status' => $status, 'diagnostic' => $diagnostic, 'created_by' => $this->actor->id, 'created_at' => $at, 'completed_at' => $at]);
        $applied = $deployment(1, 'succeeded', now()->subHours(3));
        $action = fn (string $id, string $status, $at, ?string $diagnostic = null) => DB::table('automation_actions')->insert(['id' => hash('sha256', $id), 'organization_id' => $this->org->id, 'automation_deployment_id' => $applied->id, 'node_id' => 'command', 'kind' => 'action.command.v1', 'status' => $status, 'intent' => '{}', 'diagnostic' => $diagnostic, 'expires_at' => $at, 'created_at' => $at, 'updated_at' => $at]);
        $action('older-problem', 'uncertain', now()->subHours(2), 'Older uncertainty.');
        $action('latest-problem', 'failed', now()->subHour(), 'Device rejected the value.');
        $action('latest', 'succeeded', now()->subMinutes(5));
        $workflow->update(['deployment_generation' => 1, 'deployment_status' => 'applied']);
        $second = $this->postJson($this->url, ['name' => 'Second', 'workflow' => $this->graph])->assertCreated()->json('data');

        $rows = collect($this->getJson($this->url.'/dag')->assertOk()->assertJsonCount(2, 'data')->json('data'))->keyBy('uuid');
        $row = $rows[$first['uuid']];
        $this->assertSame([['node_id' => 'source', 'device_uuid' => Device::firstOrFail()->uuid, 'device_name' => 'Simulator', 'parameter' => 'temperature']], $row['triggers']);
        $this->assertSame(now()->subMinutes(5)->toIso8601ZuluString(), $row['last_action_at']);
        $this->assertSame(['target' => 'active', 'status' => 'succeeded', 'at' => now()->subHours(3)->toIso8601ZuluString(), 'draft_revision' => 1], $row['last_deployment']);
        $this->assertSame(['source' => 'action', 'message' => 'Device rejected the value.', 'at' => now()->subHour()->toIso8601ZuluString()], $row['last_issue']);
        $this->assertSame(now()->toIso8601ZuluString(), $row['updated_at']);
        $this->assertSame($row['triggers'], $rows[$second['uuid']]['triggers']);
        $this->assertNull($rows[$second['uuid']]['last_action_at']);
        $this->assertNull($rows[$second['uuid']]['last_deployment']);
        $this->assertNull($rows[$second['uuid']]['last_issue']);

        // A newer failed activation outranks the older action failure and supplies the diagnostic.
        $deployment(2, 'failed', now()->subMinutes(30), 'Runtime rejected the graph.');
        $row = collect($this->getJson($this->url.'/dag')->assertOk()->json('data'))->firstWhere('uuid', $first['uuid']);
        $this->assertSame(['source' => 'deployment', 'message' => 'Runtime rejected the graph.', 'at' => now()->subMinutes(30)->toIso8601ZuluString()], $row['last_issue']);
        $this->assertSame('Runtime rejected the graph.', $row['deployment_diagnostic']);
        $this->assertSame('failed', $row['last_deployment']['status']);

        // Directory columns are aggregated per page, not queried per row.
        DB::enableQueryLog();
        $this->getJson($this->url.'/dag')->assertOk();
        $queries = count(DB::getQueryLog());
        for ($i = 0; $i < 4; $i++) {
            $this->postJson($this->url, ['name' => 'More '.$i, 'workflow' => $this->graph])->assertCreated();
        }
        DB::flushQueryLog();
        $this->getJson($this->url.'/dag')->assertOk()->assertJsonCount(6, 'data');
        $this->assertSame($queries, count(DB::getQueryLog()));
    }
}
