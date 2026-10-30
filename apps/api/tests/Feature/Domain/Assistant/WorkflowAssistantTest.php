<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Assistant;

use App\Domain\Assistant\Agents\WorkflowAssistant;
use App\Domain\Assistant\Jobs\RunAssistant;
use App\Domain\Assistant\Models\AssistantConversation;
use App\Domain\Assistant\Models\AssistantRun;
use App\Domain\Assistant\Tools\WorkflowAssistantTools;
use App\Domain\Automation\Models\Deployment;
use App\Domain\Automation\Models\Workflow;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceConfiguration;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Factory;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Laravel\Ai\Tools\Request;
use Tests\TestCase;

final class WorkflowAssistantTest extends TestCase
{
    use RefreshDatabase;

    private Organization $org;

    private string $base;

    private array $empty = ['schema_version' => 'automation-workflow.v2', 'bindings' => [], 'nodes' => [], 'edges' => []];

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        Queue::fake();
        Http::preventStrayRequests();
        WorkflowAssistant::fake(['I can help configure this draft.']);
        config(['assistant.enabled' => true, 'ai.providers.openai.key' => 'test-only', 'assistant.daily_budget_usd' => 10]);
        $this->org = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->actingAs(User::where('is_super_admin', true)->firstOrFail(), 'sanctum');
        DB::table('automation_settings')->insert(['organization_id' => $this->org->id, 'enabled' => true]);
        $this->base = '/api/v1/organizations/'.$this->org->uuid.'/assistant';
    }

    private function conversation(): AssistantConversation
    {
        $id = $this->postJson($this->base.'/conversations', ['scope' => 'automation'])->assertCreated()->json('data.id');

        return AssistantConversation::findOrFail($id);
    }

    private function message(AssistantConversation $conversation, ?string $request = null, ?array $graph = null)
    {
        return $this->postJson($this->base.'/conversations/'.$conversation->id.'/messages', [
            'request_id' => $request ?? (string) Str::uuid(), 'text' => 'Help me configure this automation.',
            'target' => ['name' => 'Test draft', 'workflow' => $graph ?? $this->empty],
        ]);
    }

    public function test_automation_scope_requires_workflow_permissions_feature_gate_and_private_ownership(): void
    {
        $conversation = $this->conversation();
        $this->getJson($this->base.'/conversations')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson($this->base.'/settings?scope=automation')->assertOk()->assertJsonPath('data.enabled', true);
        $this->actingAs(User::where('email', 'acme.member@example.test')->firstOrFail(), 'sanctum');
        $this->postJson($this->base.'/conversations', ['scope' => 'automation'])->assertForbidden();
        $this->getJson($this->base.'/conversations/'.$conversation->id)->assertNotFound();
        $this->actingAs(User::where('is_super_admin', true)->firstOrFail(), 'sanctum');
        $other = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $this->getJson('/api/v1/organizations/'.$other->uuid.'/assistant/conversations/'.$conversation->id)->assertNotFound();
        DB::table('automation_settings')->where('organization_id', $this->org->id)->update(['enabled' => false]);
        $this->postJson($this->base.'/conversations', ['scope' => 'automation'])->assertForbidden();
    }

    public function test_queue_routes_to_automation_agent_and_retries_preserve_original_context(): void
    {
        $conversation = $this->conversation();
        $request = (string) Str::uuid();
        $id = $this->message($conversation, $request)->assertAccepted()->json('data.id');
        $changed = [...$this->empty, 'nodes' => [['id' => 'new', 'type' => 'compare.v1', 'config' => []]]];
        $this->message($conversation, $request, $changed)->assertAccepted()->assertJsonPath('data.id', $id);
        $this->assertSame([], $conversation->fresh()->onboarding_state['target']['workflow']['nodes']);
        $this->message($conversation)->assertConflict();
        (new RunAssistant($id))->handle();
        $this->assertSame('completed', AssistantRun::findOrFail($id)->status);
        $this->assertSame('I can help configure this draft.', AssistantRun::findOrFail($id)->answer);
        $this->assertDatabaseCount('automation_workflows', 0);
        $this->assertDatabaseCount('device_commands', 0);
        $this->assertSame(0.0, AssistantRun::findOrFail($id)->reserved_usd);
    }

    public function test_the_draft_is_stored_exactly_as_the_editor_sent_it(): void
    {
        $conversation = $this->conversation();
        $device = Device::create(['organization_id' => $this->org->id, 'code' => 'yard-alarm', 'name' => 'Yard alarm']);
        $graph = [...$this->empty, 'bindings' => [[
            'role' => 'alarm', 'device_uuid' => $device->uuid, 'configuration_uuid' => (string) Str::uuid(), 'generation' => 1,
            'parameter_uuid' => (string) Str::uuid(), 'data_type' => 'boolean', 'unit' => '', 'fresh_seconds' => 60,
        ]]];
        $this->postJson($this->base.'/conversations/'.$conversation->id.'/messages', [
            'request_id' => (string) Str::uuid(), 'text' => 'Turn the alarm off after 3 seconds.',
            'target' => ['name' => 'Alarm ', 'workflow' => $graph],
        ])->assertAccepted();
        // The editor recognises its own draft in a proposal only if a unitless binding keeps its "" and the name its spaces.
        $target = $conversation->fresh()->onboarding_state['target'];
        $this->assertSame('', $target['workflow']['bindings'][0]['unit']);
        $this->assertSame('Alarm ', $target['name']);
    }

    public function test_preview_validates_without_saving_and_profile_approval_cannot_apply_it(): void
    {
        $conversation = $this->conversation();
        $id = $this->message($conversation)->assertAccepted()->json('data.id');
        $run = AssistantRun::findOrFail($id);
        $run->update(['status' => 'running']);
        config(['devices.runtime_token' => str_repeat('x', 40), 'devices.runtime_url' => 'http://runtime:8081']);
        // Compiler behavior is tested by the runtime suite. This verifies the proposal boundary.
        Http::fake(['*' => fn ($request) => Http::response(['valid' => true, 'diagnostics' => [], 'definition' => $request['workflow']])]);
        $graph = [...$this->empty, 'nodes' => [
            ['id' => 'limit', 'type' => 'compare.v1', 'config' => ['operator' => 'gt', 'value' => 25]],
            ['id' => 'event', 'type' => 'action.event.v1', 'config' => ['name' => 'test']],
        ]];
        $tool = new WorkflowAssistantTools($run);
        $result = json_decode($tool->handle(new Request(['action' => 'preview_workflow', 'arguments_json' => json_encode(['summary' => 'Review this draft', 'workflow' => $graph])])), true);
        $this->assertArrayHasKey('id', $result, json_encode($result));
        $proposal = $conversation->proposals()->findOrFail($result['id']);
        $this->assertSame('workflow', $proposal->section);
        $this->assertSame($this->empty, $proposal->before['workflow']);
        $this->assertDatabaseCount('automation_workflows', 0);
        $this->assertDatabaseCount('automation_deployments', 0);
        $this->assertDatabaseCount('device_commands', 0);
        $this->postJson($this->base.'/conversations/'.$conversation->id.'/proposals/'.$proposal->id.'/decision', [])->assertUnprocessable();
        $run->update(['status' => 'cancelled']);
        $result = json_decode($tool->handle(new Request(['action' => 'preview_workflow', 'arguments_json' => json_encode(['summary' => 'Stopped', 'workflow' => $graph])])), true);
        $this->assertArrayHasKey('error', $result);
        $this->assertDatabaseCount('assistant_proposals', 1);
    }

    public function test_invalid_compiler_result_and_unknown_devices_cannot_be_proposed(): void
    {
        $conversation = $this->conversation();
        $graph = [...$this->empty, 'bindings' => [['role' => 'sensor', 'device_uuid' => (string) Str::uuid()]]];
        $this->message($conversation, graph: $graph)->assertUnprocessable()->assertJsonPath('message', 'The device for sensor is no longer available. Rebind or remove it in the editor, then ask again.');
        $id = $this->message($conversation)->assertAccepted()->json('data.id');
        $run = AssistantRun::findOrFail($id);
        $run->update(['status' => 'running']);
        $tool = new WorkflowAssistantTools($run);
        $result = json_decode($tool->handle(new Request(['action' => 'preview_workflow', 'arguments_json' => json_encode(['summary' => 'Invalid', 'workflow' => $this->empty])])), true);
        $this->assertArrayHasKey('error', $result);
        $this->assertDatabaseCount('assistant_proposals', 0);
        $this->assertDatabaseCount('automation_workflows', 0);
        config(['devices.runtime_token' => str_repeat('x', 40), 'devices.runtime_url' => 'http://runtime:8081']);
        Http::fake(['*' => Http::response(['valid' => false, 'diagnostics' => [['node_id' => 'limit', 'message' => 'Required input is not connected.']]])]);
        $graph = [...$this->empty, 'nodes' => [
            ['id' => 'limit', 'type' => 'compare.v1', 'config' => ['operator' => 'gt', 'value' => 25]],
            ['id' => 'event', 'type' => 'action.event.v1', 'config' => ['name' => 'test']],
        ]];
        $result = json_decode($tool->handle(new Request(['action' => 'preview_workflow', 'arguments_json' => json_encode(['summary' => 'Invalid connections', 'workflow' => $graph])])), true);
        $this->assertStringContainsString('Required input is not connected', json_encode($result));
        $this->assertDatabaseCount('assistant_proposals', 0);
    }

    public function test_discovery_batches_authorized_resources_and_documents_multi_setting_shape(): void
    {
        $conversation = $this->conversation();
        $id = $this->message($conversation)->assertAccepted()->json('data.id');
        $run = AssistantRun::findOrFail($id);
        $run->update(['status' => 'running']);
        config(['devices.runtime_token' => str_repeat('x', 40), 'devices.runtime_url' => 'http://runtime:8081']);
        Http::fake(['*' => Http::response([])]);
        $result = json_decode((new WorkflowAssistantTools($run))->handle(new Request([
            'action' => 'discover', 'arguments_json' => json_encode(['device_search' => 'Unknown', 'control_search' => 'Unknown', 'geofence_search' => 'Unknown']),
        ])), true);
        $this->assertSame([], $result['devices']['data']);
        $this->assertSame([], $result['controllable_devices']['data']);
        $this->assertSame([], $result['geofences']['data']);
        $config = $result['schema']['multi_setting_command_example']['config'];
        $this->assertArrayNotHasKey('binding', $config);
        $this->assertArrayNotHasKey('value', $config);
        $this->assertSame(['alarm_enabled' => true, 'alarm_volume' => 20], $config['settings']);
    }

    /** A device reconfigured since a draft bound it: [device, earlier configuration, parameter UUID]. */
    private function reconfiguredDevice(): array
    {
        $actor = User::where('is_super_admin', true)->firstOrFail();
        $profile = DeviceProfile::create(['organization_id' => $this->org->id, 'code' => 'assistant', 'name' => 'Assistant']);
        $parameter = (string) Str::uuid();
        $canonical = json_encode(['parameters' => [['uuid' => $parameter, 'key' => 'temperature', 'data_type' => 'number', 'unit' => 'C', 'reports_state' => true]]]);
        $artifact = DeviceProfileArtifact::create(['device_profile_id' => $profile->id, 'revision' => 1, 'definition' => [], 'definition_hash' => str_repeat('a', 64), 'status' => 'active', 'compiled_at' => now(), 'compiled_by' => $actor->id]);
        $device = Device::create(['organization_id' => $this->org->id, 'name' => 'Assistant sensor', 'code' => 'assistant-sensor', 'lifecycle' => 'active', 'deployment_status' => 'applied', 'deployment_generation' => 2, 'applied_generation' => 2]);
        [$earlier, $current] = array_map(fn (int $revision) => DeviceConfiguration::create(['device_id' => $device->id, 'device_profile_artifact_id' => $artifact->id, 'revision' => $revision, 'definition_hash' => str_repeat((string) $revision, 64), 'definition' => ['profile_canonical_json' => $canonical, 'mappings' => []], 'created_at' => now()]), [1, 2]);
        $device->update(['applied_configuration_uuid' => $current->uuid]);

        return [$device->fresh(), $earlier, $parameter];
    }

    private function preview(AssistantRun $run, array $workflow): array
    {
        return json_decode((new WorkflowAssistantTools($run))->handle(new Request(['action' => 'preview_workflow', 'arguments_json' => json_encode(['summary' => 'Edit', 'workflow' => $workflow])])), true);
    }

    public function test_outdated_and_missing_bindings_are_named_so_the_model_can_refresh_them(): void
    {
        [$device, $earlier, $parameter] = $this->reconfiguredDevice();
        $binding = ['role' => 'sensor', 'device_uuid' => $device->uuid, 'configuration_uuid' => $earlier->uuid, 'generation' => 1, 'parameter_uuid' => $parameter, 'data_type' => 'number', 'unit' => 'C', 'fresh_seconds' => 120];
        $graph = [...$this->empty, 'bindings' => [$binding], 'nodes' => [
            ['id' => 'source', 'type' => 'source.parameter.v1', 'config' => ['binding' => 'sensor']],
            ['id' => 'event', 'type' => 'action.event.v1', 'config' => ['name' => 'test']],
        ]];
        // The editor saves bindings to an earlier configuration, so the assistant must accept the draft and say what to refresh.
        $conversation = $this->conversation();
        $run = AssistantRun::findOrFail($this->message($conversation, graph: $graph)->assertAccepted()->json('data.id'));
        $instructions = (new WorkflowAssistant($run))->instructions();
        $this->assertStringContainsString("Outdated bindings in the current draft:\n- Binding sensor: device {$device->uuid} was reconfigured and now has configuration {$device->applied_configuration_uuid}, generation 2; the draft has {\"configuration_uuid\":\"{$earlier->uuid}\",\"generation\":1}.", $instructions);
        // "Email me when…" is the most common request; email is an alert plus its notification settings.
        $this->assertStringContainsString('there is no email node', $instructions);
        $this->assertStringContainsString('Settings → Notifications', $instructions);
        $run->update(['status' => 'running']);
        config(['devices.runtime_token' => str_repeat('x', 40), 'devices.runtime_url' => 'http://runtime:8081']);
        Http::fake(['*' => fn ($request) => Http::response(['valid' => true, 'diagnostics' => [], 'definition' => $request['workflow']])]);

        $result = $this->preview($run, $graph);
        $this->assertSame('The automation operation was not completed.', $result['error']);
        $this->assertStringStartsWith('Binding sensor: device '.$device->uuid.' was reconfigured', $result['details']['bindings'][0]);
        $this->assertStringContainsString('Call find_devices with device_uuid '.$device->uuid, $result['details']['bindings'][0]);
        $missing = [...$binding, 'role' => 'alarm', 'device_uuid' => (string) Str::uuid()];
        $result = $this->preview($run, [...$graph, 'bindings' => [$missing]]);
        $this->assertStringStartsWith('Binding alarm: device '.$missing['device_uuid'].' no longer exists', $result['details']['bindings'][0]);
        $result = $this->preview($run, [...$graph, 'bindings' => [[...$binding, 'device_uuid' => 'not-a-uuid']]]);
        $this->assertStringStartsWith('Binding sensor: device not-a-uuid no longer exists', $result['details']['bindings'][0]);
        $this->assertDatabaseCount('assistant_proposals', 0);
        Http::assertNothingSent();

        $refreshed = [...$binding, 'configuration_uuid' => $device->applied_configuration_uuid, 'generation' => 2];
        $result = $this->preview($run, [...$graph, 'bindings' => [$refreshed]]);
        $this->assertArrayHasKey('id', $result, json_encode($result));
        $this->assertSame($refreshed, $conversation->proposals()->findOrFail($result['id'])->changes[0]['values']['workflow']['bindings'][0]);

        // Whole numbers written as text or decimals, and upper-case UUIDs, are the same binding, not an outdated one.
        $loose = [...$refreshed, 'generation' => '2', 'fresh_seconds' => 120.0, 'configuration_uuid' => strtoupper($device->applied_configuration_uuid)];
        $result = $this->preview($run, [...$graph, 'bindings' => [$loose]]);
        $this->assertArrayHasKey('id', $result, json_encode($result));
        $this->assertSame($refreshed, $conversation->proposals()->findOrFail($result['id'])->changes[0]['values']['workflow']['bindings'][0]);

        // Left out, the configuration and generation can only be the applied ones, and freshness takes the editor's 120 s.
        $result = $this->preview($run, [...$graph, 'bindings' => [Arr::except($refreshed, ['configuration_uuid', 'generation', 'fresh_seconds'])]]);
        $this->assertArrayHasKey('id', $result, json_encode($result));
        $this->assertEquals([...$refreshed, 'fresh_seconds' => 120], $conversation->proposals()->findOrFail($result['id'])->changes[0]['values']['workflow']['bindings'][0]);
        // A configuration that is present but earlier is still refused, saying what the draft has.
        $result = $this->preview($run, [...$graph, 'bindings' => [Arr::except($binding, ['generation'])]]);
        $this->assertStringContainsString('the draft has {"configuration_uuid":"'.$earlier->uuid.'","generation":null}', $result['details']['bindings'][0]);
    }

    public function test_drafts_with_detailed_geofences_send_their_geometry_by_reference(): void
    {
        // 257 points at full precision is about 10,000 characters, so three boundaries passed the old 30,000 limit.
        $ring = array_map(fn (int $i) => [79.8 + 0.01 * cos(2 * M_PI * $i / 256) + $i * 1e-12, 6.9 + 0.01 * sin(2 * M_PI * $i / 256)], range(0, 255));
        $polygon = ['type' => 'Polygon', 'coordinates' => [[...$ring, $ring[0]]]];
        $fences = array_map(fn (int $i) => ['id' => 'fence'.$i, 'type' => 'geofence.v1', 'config' => ['geometry' => $polygon, 'condition' => 'inside']], range(1, 4));
        $graph = [...$this->empty, 'nodes' => [...$fences, ['id' => 'event', 'type' => 'action.event.v1', 'config' => ['name' => 'test']]]];
        $this->assertGreaterThan(30000, strlen(json_encode($graph)));
        $conversation = $this->conversation();
        $run = AssistantRun::findOrFail($this->message($conversation, graph: $graph)->assertAccepted()->json('data.id'));
        $this->assertSame($polygon, $conversation->fresh()->onboarding_state['target']['workflow']['nodes'][0]['config']['geometry']);
        $instructions = (new WorkflowAssistant($run))->instructions();
        $this->assertStringContainsString('{"draft_geometry":"fence1","points":257,"bounds":[79.79,6.89,79.81,6.91]}', $instructions);
        $this->assertStringNotContainsString((string) json_encode($ring[1]), $instructions);
        $this->assertLessThan(30000, strlen($instructions));

        $run->update(['status' => 'running']);
        config(['devices.runtime_token' => str_repeat('x', 40), 'devices.runtime_url' => 'http://runtime:8081']);
        Http::fake(['*' => fn ($request) => Http::response(['valid' => true, 'diagnostics' => [], 'definition' => $request['workflow']])]);
        // The model keeps one boundary, moves another to a new node and drops the rest.
        $proposed = [...$this->empty, 'nodes' => [
            ['id' => 'fence1', 'type' => 'geofence.v1', 'config' => ['geometry' => ['draft_geometry' => 'fence1', 'points' => 257], 'condition' => 'outside']],
            ['id' => 'depot', 'type' => 'geofence.v1', 'config' => ['geometry' => ['draft_geometry' => 'fence2'], 'condition' => 'inside']],
            ['id' => 'event', 'type' => 'action.event.v1', 'config' => ['name' => 'test']],
        ]];
        $result = $this->preview($run, $proposed);
        $this->assertArrayHasKey('id', $result, json_encode($result));
        $nodes = $conversation->proposals()->findOrFail($result['id'])->changes[0]['values']['workflow']['nodes'];
        $this->assertSame([$polygon, $polygon], [$nodes[0]['config']['geometry'], $nodes[1]['config']['geometry']]);
        $this->assertSame('outside', $nodes[0]['config']['condition']);
        $proposed['nodes'][1]['config']['geometry'] = ['draft_geometry' => 'event'];
        $this->assertStringStartsWith('Node depot: draft_geometry must name a node of the current draft', $this->preview($run, $proposed)['details']['geometry'][0]);
        $this->assertDatabaseCount('assistant_proposals', 1);
    }

    public function test_draft_limits_follow_the_compiler_and_the_model_context(): void
    {
        $conversation = $this->conversation();
        $event = ['id' => 'event', 'type' => 'action.event.v1', 'config' => ['name' => str_repeat('x', 270000)]];
        $this->message($conversation, graph: [...$this->empty, 'nodes' => [$event]])->assertUnprocessable()->assertJsonPath('message', 'This draft is too large to save as a workflow.');
        config(['assistant.max_draft_characters' => 200]);
        $event['config']['name'] = str_repeat('x', 200);
        $this->message($conversation, graph: [...$this->empty, 'nodes' => [$event]])->assertUnprocessable()->assertJsonPath('message', 'This draft is too large for the assistant. Edit it manually.');
        $this->assertDatabaseCount('assistant_runs', 0);
    }

    private function executionFixture(): array
    {
        $actor = User::where('is_super_admin', true)->firstOrFail();
        $graph = [...$this->empty, 'nodes' => [['id' => 'threshold', 'type' => 'compare.v1', 'config' => ['operator' => 'gt', 'value' => 25]]]];
        $workflow = Workflow::create(['organization_id' => $this->org->id, 'name' => 'Execution test', 'workflow' => $graph, 'definition' => $graph, 'definition_hash' => str_repeat('a', 64), 'updated_by' => $actor->id]);
        $deployment = Deployment::create([
            'automation_workflow_id' => $workflow->id, 'generation' => 1, 'draft_revision' => 1, 'target' => 'active',
            'definition' => $graph, 'definition_hash' => str_repeat('a', 64), 'command_grants' => [],
            'status' => 'succeeded', 'created_by' => $actor->id, 'created_at' => now(),
        ]);
        $conversationId = $this->postJson($this->base.'/conversations', ['scope' => 'automation', 'workflow_uuid' => $workflow->uuid])->assertCreated()->json('data.id');
        $conversation = AssistantConversation::findOrFail($conversationId);
        config(['devices.runtime_token' => str_repeat('x', 40), 'devices.runtime_url' => 'http://runtime:8081']);
        $entry = [
            'id' => '17', 'operation_uuid' => $deployment->uuid, 'at' => now()->toIso8601String(),
            'source' => null, 'trigger' => 'timer', 'outcome' => 'evaluated', 'intent_ids' => [], 'trace_truncated' => false,
            'trace' => [['node_id' => 'threshold', 'status' => 'not_matched', 'reason' => 'Condition is false.',
                'inputs' => ['in' => ['known' => true, 'value' => 20]], 'outputs' => ['out' => ['known' => true, 'value' => false]]]],
        ];

        return [$workflow, $conversation, $entry];
    }

    public function test_execution_explanations_pin_authoritative_snapshot_and_idempotent_retries(): void
    {
        [$workflow, $conversation, $entry] = $this->executionFixture();
        Http::fake(['*/internal/dag/timeline*' => Http::response(['data' => $entry])]);
        $draft = $workflow->workflow;
        $draft['uuid'] = $workflow->uuid;
        $draft['nodes'][0]['config']['value'] = 99;
        $requestId = (string) Str::uuid();
        $input = ['request_id' => $requestId, 'text' => 'Explain this execution.', 'execution_id' => '17',
            'execution_context' => ['outcome' => 'forged success'],
            'target' => ['name' => $workflow->name, 'workflow' => $draft, 'draft_revision' => 2]];
        $url = $this->base.'/conversations/'.$conversation->id.'/messages';
        $runId = $this->postJson($url, $input)->assertAccepted()
            ->assertJsonPath('data.execution.evaluation_id', '17')
            ->assertJsonPath('data.execution.draft_revision', 1)
            ->assertJsonPath('data.execution.steps.0.node_id', 'threshold')->json('data.id');
        $run = AssistantRun::findOrFail($runId);
        $this->assertSame(25, $run->execution_context['evaluation']['trace'][0]['config']['value']);
        $this->assertSame('[step:1]', $run->execution_context['evaluation']['trace'][0]['citation']);
        $this->assertSame(99, $conversation->fresh()->onboarding_state['target']['workflow']['nodes'][0]['config']['value']);
        $this->postJson($url, [...$input, 'execution_id' => '999'])->assertAccepted()->assertJsonPath('data.id', $runId)->assertJsonPath('data.execution.evaluation_id', '17');
        Http::assertSentCount(1);
        $instructions = (new WorkflowAssistant($run))->instructions();
        $this->assertStringContainsString('Command confirmed_at means approval to send', $instructions);
        $this->assertStringContainsString('[step:1]', $instructions);
        $this->assertStringContainsString('Condition is false.', $instructions);
        $this->assertStringNotContainsString('forged success', $instructions);
        (new RunAssistant($runId))->handle();
        $this->assertSame('completed', $run->fresh()->status);
        $this->assertDatabaseCount('device_commands', 0);
        $this->assertDatabaseCount('assistant_proposals', 0);
        $this->assertDatabaseCount('automation_deployments', 1);
        $this->assertSame(1, $workflow->fresh()->draft_revision);
    }

    public function test_execution_evidence_is_scoped_and_oversized_or_unavailable_history_does_not_queue(): void
    {
        [$workflow, $conversation, $entry] = $this->executionFixture();
        $url = $this->base.'/conversations/'.$conversation->id.'/messages';
        $input = ['request_id' => (string) Str::uuid(), 'text' => 'Explain', 'execution_id' => '17',
            'target' => ['name' => $workflow->name, 'workflow' => [...$workflow->workflow, 'uuid' => $workflow->uuid]]];
        $entry['operation_uuid'] = (string) Str::uuid();
        Http::fake(['*/internal/dag/timeline*' => Http::response(['data' => $entry])]);
        $this->postJson($url, $input)->assertNotFound();
        $this->assertDatabaseCount('assistant_runs', 0);
        $this->postJson($url, [...$input, 'execution_id' => '-1'])->assertUnprocessable();
        $other = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $this->postJson('/api/v1/organizations/'.$other->uuid.'/assistant/conversations/'.$conversation->id.'/messages', $input)->assertNotFound();
        $entry['operation_uuid'] = Deployment::firstOrFail()->uuid;
        Http::swap(new Factory);
        Http::fake(['*/internal/dag/timeline*' => Http::response(['data' => $entry])]);
        config(['assistant.max_context_characters' => 100]);
        $this->postJson($url, $input)->assertUnprocessable();
        $this->assertDatabaseCount('assistant_runs', 0);
        Queue::assertNothingPushed();
    }
}
