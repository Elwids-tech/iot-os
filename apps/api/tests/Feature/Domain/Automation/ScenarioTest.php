<?php

namespace Tests\Feature\Domain\Automation;

use App\Domain\Automation\Models\Workflow;
use App\Domain\Automation\Services\ScenarioSimulation;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Factory;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

final class ScenarioTest extends TestCase
{
    use RefreshDatabase;

    private Workflow $workflow;

    private string $url;

    private array $definition;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $org = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->actingAs(User::where('is_super_admin', true)->firstOrFail(), 'sanctum');
        DB::table('automation_settings')->insertOrIgnore(['organization_id' => $org->id]);
        DB::table('automation_settings')->where('organization_id', $org->id)->update(['enabled' => true]);
        $this->workflow = Workflow::create(['organization_id' => $org->id, 'name' => 'Scenario test', 'draft_revision' => 1, 'definition_hash' => str_repeat('a', 64), 'definition' => [], 'workflow' => [
            'schema_version' => 'automation-workflow.v2', 'organization_uuid' => $org->uuid,
            'bindings' => [], 'nodes' => [['id' => 'condition', 'type' => 'constant.v1'], ['id' => 'action', 'type' => 'action.command.v1']], 'edges' => [],
        ]]);
        $this->url = '/api/v1/organizations/'.$org->uuid.'/workflows/'.$this->workflow->uuid.'/scenarios';
        $this->definition = ['steps' => [['label' => 'Initial', 'at_seconds' => 0, 'device_uuid' => null, 'readings' => [], 'expected_actions' => [], 'expected_outputs' => [['node_id' => 'condition', 'port' => 'out', 'known' => true, 'value' => false]]]]];
        config(['devices.runtime_token' => str_repeat('t', 40), 'devices.runtime_url' => 'http://runtime:8081']);
        Http::preventStrayRequests();
    }

    private function save(): string
    {
        return $this->postJson($this->url, ['name' => 'False stays false', 'revision' => 0, 'draft_revision' => 1, 'definition' => $this->definition])->assertCreated()->json('data.uuid');
    }

    private function fake(array $intents = [], mixed $value = false, bool $known = true, bool $truncated = false): void
    {
        Http::fake(['*/internal/dag/simulate' => Http::response(['steps' => [['intents' => $intents, 'trace_truncated' => $truncated, 'trace' => [['node_id' => 'condition', 'outputs' => ['out' => ['known' => $known, 'value' => $value]]]]]]])]);
    }

    public function test_persists_exact_revisions_and_never_dispatches_live_actions(): void
    {
        $id = $this->save();
        $this->fake();
        $this->postJson($this->url.'/'.$id.'/runs', ['revision' => 1, 'draft_revision' => 1])->assertOk()->assertJsonPath('data.result.passed', true)->assertJsonPath('data.scenario_revision', 1)->assertJsonPath('data.draft_revision', 1);
        $this->workflow->update(['draft_revision' => 2]);
        $this->getJson($this->url.'/'.$id.'/runs')->assertOk()->assertJsonPath('data.0.draft_revision', 1)->assertJsonPath('data.0.scenario.steps.0.expected_outputs.0.value', false);
        $this->postJson($this->url.'/'.$id.'/runs', ['revision' => 1, 'draft_revision' => 1])->assertConflict();
        $this->putJson($this->url.'/'.$id, ['name' => 'Updated', 'revision' => 0, 'draft_revision' => 2, 'definition' => $this->definition])->assertConflict();
        Http::assertSentCount(1);
        $this->assertDatabaseCount('automation_actions', 0);
        $this->assertDatabaseCount('device_commands', 0);
        $this->assertDatabaseCount('device_outbox', 0);
    }

    public function test_unexpected_action_unknown_and_zero_are_not_false(): void
    {
        $id = $this->save();
        $this->fake([['node_id' => 'action']], 0);
        $response = $this->postJson($this->url.'/'.$id.'/runs', ['revision' => 1, 'draft_revision' => 1])->assertOk()->assertJsonPath('data.result.passed', false);
        $this->assertFalse($response->json('data.result.checks.1.passed'));
        $this->assertFalse($response->json('data.result.checks.2.passed'));
        Http::swap(new Factory);
        $this->fake([], false, false);
        $this->postJson($this->url.'/'.$id.'/runs', ['revision' => 1, 'draft_revision' => 1])->assertOk()->assertJsonPath('data.result.passed', false);
    }

    public function test_truncated_or_missing_evidence_cannot_pass(): void
    {
        $id = $this->save();
        $this->fake([], false, true, true);
        $this->postJson($this->url.'/'.$id.'/runs', ['revision' => 1, 'draft_revision' => 1])->assertOk()->assertJsonPath('data.result.passed', false);
    }

    public function test_rejects_stale_nodes_invalid_times_and_foreign_devices(): void
    {
        $this->definition['steps'][0]['expected_actions'] = ['removed' => 1];
        $this->postJson($this->url, ['name' => 'Invalid', 'revision' => 0, 'draft_revision' => 1, 'definition' => $this->definition])->assertUnprocessable();
        $this->definition['steps'][0]['expected_actions'] = [];
        $this->definition['steps'][0]['at_seconds'] = 10;
        $this->postJson($this->url, ['name' => 'Invalid', 'revision' => 0, 'draft_revision' => 1, 'definition' => $this->definition])->assertUnprocessable();
        $this->definition['steps'][0]['at_seconds'] = 0;
        $this->definition['steps'][0]['device_uuid'] = '30000000-0000-4000-8000-000000000100';
        $this->postJson($this->url, ['name' => 'Invalid', 'revision' => 0, 'draft_revision' => 1, 'definition' => $this->definition])->assertUnprocessable();
        Http::assertNothingSent();
    }

    public function test_tenant_and_manage_permissions(): void
    {
        $id = $this->save();
        $other = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $this->getJson('/api/v1/organizations/'.$other->uuid.'/workflows/'.$this->workflow->uuid.'/scenarios')->assertNotFound();
        $otherWorkflow = $this->workflow->replicate();
        $otherWorkflow->uuid = (string) Str::uuid();
        $otherWorkflow->save();
        $this->getJson(str_replace($this->workflow->uuid, $otherWorkflow->uuid, $this->url).'/'.$id.'/runs')->assertNotFound();
        $this->actingAs(User::where('email', 'acme.member@example.test')->firstOrFail(), 'sanctum');
        $this->getJson($this->url)->assertOk();
        $this->postJson($this->url.'/'.$id.'/runs', ['revision' => 1, 'draft_revision' => 1])->assertForbidden();
        $this->deleteJson($this->url.'/'.$id, ['revision' => 1])->assertForbidden();
    }

    public function test_groups_same_device_readings_and_preserves_zero_false_and_age(): void
    {
        $device = (string) Str::uuid();
        $config = (string) Str::uuid();
        $graph = $this->workflow->workflow;
        foreach (['number', 'boolean'] as $type) {
            $graph['bindings'][] = ['role' => $type, 'device_uuid' => $device, 'configuration_uuid' => $config, 'generation' => 1, 'parameter_uuid' => (string) Str::uuid(), 'data_type' => $type, 'unit' => '', 'fresh_seconds' => 30];
            $graph['nodes'][] = ['id' => $type, 'type' => 'source.parameter.v1', 'config' => ['binding' => $type]];
        }
        $this->workflow->update(['workflow' => $graph]);
        $this->definition['steps'][0]['device_uuid'] = $device;
        $this->definition['steps'][0]['readings'] = [
            ['binding' => 'number', 'value' => 0, 'quality' => 'good', 'age_seconds' => 0],
            ['binding' => 'boolean', 'value' => false, 'quality' => 'bad', 'age_seconds' => 60],
        ];
        $steps = app(ScenarioSimulation::class)->steps($this->definition, $this->workflow);
        $this->assertCount(1, $steps);
        $this->assertCount(2, $steps[0]['event']['readings']);
        $this->assertSame(0, $steps[0]['event']['readings'][0]['value']);
        $this->assertFalse($steps[0]['event']['readings'][1]['value']);
        $this->assertSame(60, strtotime($steps[0]['at']) - strtotime($steps[0]['event']['readings'][1]['observed_at']));
    }
}
