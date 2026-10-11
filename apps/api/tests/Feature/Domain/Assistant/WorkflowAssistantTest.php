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
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Factory;
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
        $graph = [...$this->empty, 'bindings' => [['device_uuid' => (string) Str::uuid()]]];
        $this->message($conversation, graph: $graph)->assertUnprocessable();
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
