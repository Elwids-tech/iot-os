<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Automation;

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
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

final class WorkflowTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private string $url;

    private array $graph;

    private bool $rejectCompilation = false;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->organization = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $actor = User::where('email', 'super-admin@example.test')->firstOrFail();
        $this->actingAs($actor, 'sanctum');
        $this->url = '/api/v1/organizations/'.$this->organization->uuid.'/workflows';
        $this->graph = json_decode(file_get_contents(base_path('../../contracts/rules/v1/workflow.fixture.json')), true);
        $device = Device::create(['organization_id' => $this->organization->id, 'name' => 'GPS tag', 'code' => 'gps-tag']);
        $profile = DeviceProfile::create(['organization_id' => $this->organization->id, 'code' => 'gps', 'name' => 'GPS']);
        $artifact = DeviceProfileArtifact::create(['device_profile_id' => $profile->id, 'revision' => 1, 'definition' => [], 'definition_hash' => str_repeat('a', 64), 'status' => 'active', 'compiled_at' => now(), 'compiled_by' => $actor->id]);
        $configuration = DeviceConfiguration::create(['device_id' => $device->id, 'device_profile_artifact_id' => $artifact->id, 'revision' => 1, 'definition_hash' => str_repeat('b', 64), 'definition' => [], 'created_at' => now()]);
        $this->graph['nodes'][0]['config']['binding'] = [...$this->graph['nodes'][0]['config']['binding'], 'organization_uuid' => $this->organization->uuid, 'device_uuid' => $device->uuid, 'configuration_uuid' => $configuration->uuid];
        config(['devices.runtime_token' => str_repeat('t', 40), 'devices.runtime_url' => 'http://runtime:8081']);
        Http::preventStrayRequests();
        Http::fake(function ($request) {
            if (str_ends_with($request->url(), '/compile')) {
                if ($this->rejectCompilation) {
                    return Http::response(['message' => 'Invalid graph'], 422);
                }
                $w = $request['workflow'];

                return Http::response(['valid' => true, 'definition_hash' => hash('sha256', json_encode($w)), 'definition' => ['uuid' => $w['uuid'], 'version_uuid' => $w['version_uuid'], 'binding' => $w['nodes'][0]['config']['binding']]]);
            }

            return Http::response(['mode' => 'side-effect-free', 'results' => []]);
        });
    }

    private function create(): array
    {
        return $this->postJson($this->url, ['name' => 'Paddock boundary', 'workflow' => $this->graph])->assertCreated()->assertJsonPath('data.status', 'draft')->assertJsonPath('data.draft_revision', 1)->assertJsonMissingPath('data.id')->json('data');
    }

    public function test_drafts_have_server_identities_history_and_optimistic_concurrency(): void
    {
        $draft = $this->create();
        $this->assertNotSame($this->graph['uuid'], $draft['uuid']);
        $this->assertNotSame($this->graph['version_uuid'], $draft['workflow']['version_uuid']);
        $url = $this->url.'/'.$draft['uuid'];
        $this->getJson($url)->assertOk()->assertJsonPath('data.workflow.uuid', $draft['uuid']);
        $next = $this->putJson($url, ['name' => 'Renamed', 'workflow' => $draft['workflow'], 'draft_revision' => 1])->assertOk()->assertJsonPath('data.draft_revision', 2)->json('data');
        $this->assertNotSame($draft['workflow']['version_uuid'], $next['workflow']['version_uuid']);
        $this->putJson($url, ['name' => 'Stale', 'workflow' => $this->graph, 'draft_revision' => 1])->assertConflict();
        $this->assertDatabaseCount('automation_workflow_revisions', 2);
        $this->assertSame('Paddock boundary', json_decode(DB::table('automation_workflow_revisions')->orderBy('id')->first()->snapshot, true)['name']);
        $this->assertDatabaseCount('device_outbox', 0);
        $this->assertSame(2, DB::table('device_audit_events')->where('action', 'workflow.draft_saved')->count());
        $this->getJson($this->url.'?per_page=1')->assertOk()->assertJsonPath('meta.total', 1);
    }

    public function test_tenant_scope_and_permissions_cover_reads_writes_and_simulation(): void
    {
        $draft = $this->create();
        $other = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $foreign = '/api/v1/organizations/'.$other->uuid.'/workflows/'.$draft['uuid'];
        $this->getJson($foreign)->assertNotFound();
        $this->putJson($foreign, [])->assertNotFound();
        $this->postJson($foreign.'/simulate', [])->assertNotFound();
        $this->getJson('/api/v1/organizations/'.$other->uuid.'/workflows')->assertJsonCount(0, 'data');
        $this->actingAs(User::where('email', 'acme.member@example.test')->firstOrFail(), 'sanctum');
        $this->postJson($this->url, ['name' => 'No permission', 'workflow' => $this->graph])->assertForbidden();
        $this->putJson($this->url.'/'.$draft['uuid'], [])->assertForbidden();
        $this->postJson($this->url.'/'.$draft['uuid'].'/simulate', [])->assertForbidden();
    }

    public function test_foreign_bindings_and_runtime_failure_never_save_a_draft(): void
    {
        foreach ([null, '', 'invalid'] as $invalid) {
            $graph = $this->graph;
            $graph['nodes'][0]['config']['binding']['device_uuid'] = $invalid;
            $this->postJson($this->url, ['name' => 'Malformed', 'workflow' => $graph])->assertUnprocessable();
        }
        $graph = $this->graph;
        $graph['nodes'][0]['config']['binding']['organization_uuid'] = (string) Str::uuid();
        $this->postJson($this->url, ['name' => 'Foreign', 'workflow' => $graph])->assertUnprocessable();
        $graph = $this->graph;
        $graph['nodes'][0]['config']['binding']['device_uuid'] = (string) Str::uuid();
        $this->postJson($this->url, ['name' => 'Foreign', 'workflow' => $graph])->assertNotFound();
        $graph = $this->graph;
        $graph['nodes'][0]['config']['binding']['configuration_uuid'] = (string) Str::uuid();
        $this->postJson($this->url, ['name' => 'Foreign', 'workflow' => $graph])->assertUnprocessable();
        Http::assertNothingSent();
        $this->rejectCompilation = true;
        $this->postJson($this->url, ['name' => 'Rejected', 'workflow' => $this->graph])->assertUnprocessable();
        $this->assertDatabaseCount('automation_workflows', 0);
        $this->assertDatabaseCount('automation_workflow_revisions', 0);
    }

    public function test_simulation_is_revision_pinned_scoped_and_does_not_mutate_drafts(): void
    {
        $draft = $this->create();
        $url = $this->url.'/'.$draft['uuid'].'/simulate';
        $input = ['draft_revision' => 1, 'steps' => [['at' => '2026-09-25T00:00:00Z', 'event' => null]]];
        $this->postJson($url, $input)->assertOk()->assertJsonPath('draft_revision', 1)->assertJsonPath('mode', 'side-effect-free');
        Http::assertSent(fn ($r) => str_ends_with($r->url(), '/simulate') && $r['definition']['uuid'] === $draft['uuid'] && ! isset($r['state']));
        $this->postJson($url, [...$input, 'draft_revision' => 2])->assertConflict();
        $input['steps'][0]['event'] = ['organization_uuid' => (string) Str::uuid(), 'device_uuid' => (string) Str::uuid()];
        $this->postJson($url, $input)->assertUnprocessable();
        $this->assertSame(1, Workflow::firstOrFail()->draft_revision);
        $this->assertDatabaseCount('automation_workflow_revisions', 1);
        $this->assertDatabaseCount('device_outbox', 0);
    }

    private function applyDevice(): void
    {
        $binding = $this->graph['nodes'][0]['config']['binding'];
        Device::where('uuid', $binding['device_uuid'])->update(['lifecycle' => 'active', 'deployment_status' => 'applied', 'deployment_generation' => $binding['generation'], 'applied_generation' => $binding['generation'], 'applied_configuration_uuid' => $binding['configuration_uuid']]);
    }

    private function runtimeEvent(string $type, array $payload, ?string $id = null)
    {
        return $this->withToken(str_repeat('t', 40))->postJson('/api/internal/devices/events', ['uuid' => $id ?? (string) Str::uuid(), 'type' => $type, 'payload' => $payload]);
    }

    public function test_activation_is_idempotent_immutable_acknowledged_and_independent_of_draft_edits(): void
    {
        $this->applyDevice();
        $draft = $this->create();
        $url = $this->url.'/'.$draft['uuid'];
        $input = ['operation_uuid' => (string) Str::uuid(), 'expected_generation' => 0, 'draft_revision' => 1, 'target_state' => 'active'];
        $this->postJson($url.'/deployments', $input)->assertAccepted()->assertJsonPath('data.deployment_status', 'pending')->assertJsonPath('data.applied_deployment_uuid', null);
        $this->postJson($url.'/deployments', $input)->assertAccepted();
        $this->assertDatabaseCount('automation_deployments', 1);
        $this->assertDatabaseCount('device_outbox', 1);
        $this->postJson($url.'/deployments', [...$input, 'target_state' => 'inactive'])->assertConflict();
        $this->postJson($url.'/deployments', [...$input, 'operation_uuid' => (string) Str::uuid(), 'expected_generation' => 1])->assertConflict();
        $definition = Deployment::firstOrFail()->definition;
        $this->assertSame($input['operation_uuid'], $definition['version_uuid']);
        $this->putJson($url, ['name' => 'Changed draft', 'workflow' => $draft['workflow'], 'draft_revision' => 1])->assertOk();
        $this->assertSame($definition, Deployment::firstOrFail()->definition);
        $ack = ['operation_uuid' => $input['operation_uuid'], 'rule_uuid' => $draft['uuid'], 'organization_uuid' => $this->organization->uuid, 'generation' => 1, 'target' => 'active', 'status' => 'succeeded'];
        $this->runtimeEvent('workflow.deployment.v1', $ack)->assertOk();
        $this->runtimeEvent('workflow.deployment.v1', $ack)->assertOk();
        $this->getJson($url.'/deployments/'.$input['operation_uuid'])->assertOk()->assertJsonPath('deployment.status', 'succeeded')->assertJsonPath('data.applied_deployment_uuid', $input['operation_uuid'])->assertJsonPath('data.draft_revision', 2);
        $disable = ['operation_uuid' => (string) Str::uuid(), 'expected_generation' => 1, 'draft_revision' => 2, 'target_state' => 'inactive'];
        $this->postJson($url.'/deployments', $disable)->assertAccepted()->assertJsonPath('data.applied_deployment_uuid', $input['operation_uuid']);
        $this->runtimeEvent('workflow.deployment.v1', [...$ack, 'operation_uuid' => $disable['operation_uuid'], 'generation' => 2, 'target' => 'inactive'])->assertOk();
        $this->getJson($url)->assertJsonPath('data.deployment_status', 'inactive')->assertJsonPath('data.applied_deployment_uuid', null);
        $this->assertSame('disabled', Deployment::where('uuid', $input['operation_uuid'])->firstOrFail()->stopped_reason);
        $this->runtimeEvent('workflow.deployment.v1', $ack)->assertOk();
        $this->getJson($url)->assertJsonPath('data.applied_deployment_uuid', null);
        $this->expectException(\LogicException::class);
        Deployment::firstOrFail()->update(['definition' => []]);
    }

    /** A refused device activation leaves the applied configuration, and the bindings to it, in place (ADR-027). */
    public function test_a_refused_device_activation_keeps_the_binding_activatable(): void
    {
        $draft = $this->create();
        $this->applyDevice();
        Device::query()->update(['deployment_generation' => 2, 'deployment_status' => 'failed']);
        $this->postJson($this->url.'/'.$draft['uuid'].'/deployments', ['operation_uuid' => (string) Str::uuid(), 'expected_generation' => 0, 'draft_revision' => 1, 'target_state' => 'active'])->assertAccepted();
    }

    public function test_activation_requires_applied_binding_permissions_and_tenant_scope(): void
    {
        $draft = $this->create();
        $url = $this->url.'/'.$draft['uuid'].'/deployments';
        $input = ['operation_uuid' => (string) Str::uuid(), 'expected_generation' => 0, 'draft_revision' => 1, 'target_state' => 'active'];
        $this->postJson($url, $input)->assertUnprocessable();
        $this->applyDevice();
        Device::query()->update(['deployment_generation' => 2, 'applied_generation' => 2]);
        $this->postJson($url, $input)->assertUnprocessable();
        $other = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $this->postJson('/api/v1/organizations/'.$other->uuid.'/workflows/'.$draft['uuid'].'/deployments', $input)->assertNotFound();
        $this->actingAs(User::where('email', 'acme.member@example.test')->firstOrFail(), 'sanctum');
        $this->postJson($url, $input)->assertForbidden();
        $this->assertDatabaseCount('automation_deployments', 0);
        $this->assertDatabaseCount('device_outbox', 0);
    }

    public function test_transitions_are_deduplicated_and_suspension_is_not_a_clear(): void
    {
        $this->applyDevice();
        $draft = $this->create();
        $url = $this->url.'/'.$draft['uuid'];
        $op = (string) Str::uuid();
        $this->postJson($url.'/deployments', ['operation_uuid' => $op, 'expected_generation' => 0, 'draft_revision' => 1, 'target_state' => 'active'])->assertAccepted();
        $deployment = Deployment::firstOrFail();
        $base = ['operation_uuid' => $op, 'rule_uuid' => $draft['uuid'], 'organization_uuid' => $this->organization->uuid];
        // Suspension may be projected before its activation acknowledgement.
        $this->runtimeEvent('workflow.suspended.v1', $base)->assertOk();
        $this->runtimeEvent('workflow.deployment.v1', [...$base, 'generation' => 1, 'target' => 'active', 'status' => 'succeeded'])->assertOk();
        $transition = ['id' => str_repeat('a', 64), 'type' => 'activated', 'episode' => 1, 'occurred_at' => now()->toIso8601String(), 'rule_uuid' => $draft['uuid'], 'version_uuid' => $op, 'definition_hash' => $deployment->definition_hash, 'organization_uuid' => $this->organization->uuid, 'device_uuid' => $deployment->definition['binding']['device_uuid']];
        $this->runtimeEvent('workflow.transition.v1', [...$base, 'transition' => $transition])->assertOk();
        $this->runtimeEvent('workflow.transition.v1', [...$base, 'transition' => $transition])->assertOk();
        $this->getJson($url.'/transitions')->assertOk()->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.type', 'activated');
        $this->getJson($url)->assertJsonPath('data.deployment_status', 'suspended');
        $this->runtimeEvent('workflow.transition.v1', [...$base, 'transition' => [...$transition, 'version_uuid' => (string) Str::uuid()]])->assertUnprocessable();
        $other = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $this->getJson('/api/v1/organizations/'.$other->uuid.'/workflows/'.$draft['uuid'].'/transitions')->assertNotFound();
        $this->getJson('/api/v1/organizations/'.$other->uuid.'/workflows/'.$draft['uuid'].'/deployments/'.$op)->assertNotFound();
    }
}
