<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Automation;

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
}
