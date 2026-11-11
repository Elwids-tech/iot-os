<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Automation;

use App\Domain\Authorization\Models\Role;
use App\Domain\Automation\Models\Deployment;
use App\Domain\Automation\Models\Workflow;
use App\Domain\Automation\Services\WorkflowDeploymentService;
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
use Spatie\Permission\PermissionRegistrar;
use Tests\TestCase;

/** Spec 031 FR-037: archiving an automation turns it off; a restored one stays off. */
final class WorkflowArchiveTest extends TestCase
{
    use RefreshDatabase;

    private Organization $org;

    private User $admin;

    private string $url;

    private array $graph;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->org = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->admin = User::where('email', 'shared.operator@example.test')->firstOrFail();
        $this->actingAs($this->admin, 'sanctum');
        $this->url = '/api/v1/organizations/'.$this->org->uuid.'/workflows';
        $profile = DeviceProfile::create(['organization_id' => $this->org->id, 'code' => 'archive', 'name' => 'Archive']);
        $parameter = (string) Str::uuid();
        $canonical = json_encode(['parameters' => [['uuid' => $parameter, 'key' => 'temperature', 'data_type' => 'number', 'unit' => 'C', 'reports_state' => true, 'accepts_command' => false]]]);
        $artifact = DeviceProfileArtifact::create(['device_profile_id' => $profile->id, 'revision' => 1, 'definition' => [], 'definition_hash' => str_repeat('a', 64), 'status' => 'active', 'compiled_at' => now(), 'compiled_by' => $this->admin->id]);
        $device = Device::create(['organization_id' => $this->org->id, 'name' => 'Freezer', 'code' => 'freezer', 'lifecycle' => 'active', 'deployment_status' => 'applied', 'deployment_generation' => 1, 'applied_generation' => 1]);
        $configuration = DeviceConfiguration::create(['device_id' => $device->id, 'device_profile_artifact_id' => $artifact->id, 'revision' => 1, 'definition_hash' => str_repeat('b', 64), 'definition' => ['profile_canonical_json' => $canonical, 'mappings' => [['parameter_uuid' => $parameter, 'metric' => 'temperature']]], 'created_at' => now()]);
        $device->update(['applied_configuration_uuid' => $configuration->uuid]);
        $this->graph = ['schema_version' => 'automation-workflow.v2', 'bindings' => [['role' => 'sensor', 'device_uuid' => $device->uuid, 'configuration_uuid' => $configuration->uuid, 'generation' => 1, 'parameter_uuid' => $parameter, 'data_type' => 'number', 'unit' => 'C', 'fresh_seconds' => 120]], 'nodes' => [['id' => 'source', 'type' => 'source.parameter.v1', 'config' => ['binding' => 'sensor']], ['id' => 'compare', 'type' => 'compare.v1', 'config' => ['operator' => 'gt', 'value' => 25]]], 'edges' => [['source' => 'source', 'source_port' => 'out', 'target' => 'compare', 'target_port' => 'in']]];
        config(['devices.runtime_token' => str_repeat('t', 40), 'devices.runtime_url' => 'http://runtime:8081']);
        Http::preventStrayRequests();
        Http::fake(fn ($request) => Http::response(['valid' => true, 'definition' => $request['workflow'], 'definition_hash' => hash('sha256', json_encode($request['workflow']))]));
        $this->putJson($this->url.'/dag/settings', ['enabled' => true, 'stopped' => false, 'revision' => 0])->assertOk();
    }

    public function test_archiving_a_running_automation_turns_it_off_and_restoring_keeps_it_off(): void
    {
        $kept = $this->draft('Kept');
        $w = $this->draft('Freezer too warm');
        $base = $this->url.'/'.$w['uuid'];
        $running = $this->activate($w);

        $this->postJson($base.'/archive')->assertOk()
            ->assertJsonPath('data.uuid', $w['uuid'])
            ->assertJsonPath('data.archived_by', ['user_id' => $this->admin->id, 'name' => 'Shared Operations Admin']);
        // A disable deployment follows the running one, and the runtime is asked to stop it.
        $disable = Deployment::where('automation_workflow_id', $running->automation_workflow_id)->orderByDesc('generation')->firstOrFail();
        $this->assertSame(['inactive', 'pending', 2], [$disable->target, $disable->status, $disable->generation]);
        $this->assertDatabaseHas('device_outbox', ['type' => 'workflow.deploy.v2']);
        $workflow = Workflow::where('uuid', $w['uuid'])->firstOrFail();
        $this->assertSame([$disable->uuid, null, 'pending'], [$workflow->pending_operation_uuid, $workflow->desired_deployment_uuid, $workflow->deployment_status]);
        $this->postJson($base.'/archive')->assertOk();
        $this->assertSame(2, Deployment::where('automation_workflow_id', $workflow->id)->count());
        $this->acknowledge($disable);

        // Lists hide it unless asked, and say how many they hide.
        $this->getJson($this->url.'/dag')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.uuid', $kept['uuid'])->assertJsonPath('meta.archived_count', 1);
        $this->getJson($this->url.'/dag?archived=only')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.archived_by.name', 'Shared Operations Admin')->assertJsonPath('data.0.deployment_status', 'inactive');
        $this->getJson($this->url.'/dag?archived=include&search=Freezer')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('meta.archived_count', 1);
        $this->getJson($this->url.'/dag?search=Kept')->assertOk()->assertJsonPath('meta.archived_count', 0);
        $this->getJson($this->url.'?kind=all')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('meta.archived_count', 1);
        $this->getJson($this->url.'/dag?archived=yes')->assertUnprocessable();

        // It still opens, read-only: the draft, the layout and activation get 409.
        $this->getJson($base)->assertOk()->assertJsonPath('data.archived_by.user_id', $this->admin->id);
        $this->putJson($base, ['name' => 'Edited', 'workflow' => $w['workflow'], 'draft_revision' => 1])->assertConflict()
            ->assertJsonPath('message', 'This automation is archived. Restore it before making changes.');
        $this->putJson($base.'/layout', ['layout_revision' => 0, 'layout' => ['positions' => []]])->assertConflict();
        $this->postJson($base.'/deployments', ['operation_uuid' => (string) Str::uuid(), 'target_state' => 'active', 'draft_revision' => 1, 'expected_generation' => 2])->assertConflict();

        $this->postJson($base.'/restore')->assertOk()->assertJsonPath('data.archived_at', null)->assertJsonPath('data.archived_by', null);
        $this->getJson($base)->assertOk()->assertJsonPath('data.deployment_status', 'inactive')->assertJsonPath('data.desired_deployment_uuid', null)->assertJsonPath('data.applied_deployment_uuid', null);
        $this->assertSame(2, Deployment::where('automation_workflow_id', $workflow->id)->count());
        $this->getJson($this->url.'/dag')->assertOk()->assertJsonCount(2, 'data')->assertJsonPath('meta.archived_count', 0);
        $this->putJson($base, ['name' => 'Edited', 'workflow' => $w['workflow'], 'draft_revision' => 1])->assertOk();
        $this->assertSame(['workflow.archived', 'workflow.unarchived'], DB::table('activity_log')->where('subject_uuid', $w['uuid'])->whereIn('event', ['workflow.archived', 'workflow.unarchived'])->orderBy('id')->pluck('event')->all());
        $this->assertSame('Freezer too warm', DB::table('activity_log')->where('event', 'workflow.archived')->value('subject_name'));
    }

    public function test_a_draft_that_never_ran_is_archived_without_a_deployment(): void
    {
        $w = $this->draft();
        $updated = Workflow::where('uuid', $w['uuid'])->value('updated_at');
        $this->travel(5)->minutes();

        $this->postJson($this->url.'/'.$w['uuid'].'/archive')->assertOk();
        $this->assertDatabaseCount('automation_deployments', 0);
        $this->assertDatabaseCount('device_outbox', 0);

        // Archiving and restoring aren't draft edits, so the directory's "Draft edited" stays put.
        $this->postJson($this->url.'/'.$w['uuid'].'/restore')->assertOk();
        $this->assertEquals($updated, Workflow::where('uuid', $w['uuid'])->value('updated_at'));
    }

    public function test_an_automation_being_activated_is_archived_once_that_finishes(): void
    {
        $w = $this->draft();
        $this->postJson($this->url.'/'.$w['uuid'].'/deployments', ['operation_uuid' => (string) Str::uuid(), 'target_state' => 'active', 'draft_revision' => 1, 'expected_generation' => 0])->assertStatus(202);

        $this->postJson($this->url.'/'.$w['uuid'].'/archive')->assertConflict()
            ->assertJsonPath('message', 'This automation is being activated. Archive it once that finishes.');

        $this->assertNull(Workflow::where('uuid', $w['uuid'])->value('archived_at'));
        $this->assertDatabaseCount('automation_deployments', 1);
    }

    public function test_archiving_needs_manage_and_activate_and_restoring_needs_manage(): void
    {
        $w = $this->draft();
        $base = $this->url.'/'.$w['uuid'];

        $this->actingAs(User::where('email', 'acme.member@example.test')->firstOrFail(), 'sanctum');
        $this->postJson($base.'/archive')->assertForbidden();

        $this->actingAs($this->member(['Workflow.view', 'Workflow.manage']), 'sanctum');
        $this->postJson($base.'/archive')->assertForbidden();
        $this->actingAs($this->member(['Workflow.view', 'Workflow.manage', 'Workflow.activate']), 'sanctum');
        $this->postJson($base.'/archive')->assertOk();
        $this->actingAs($this->member(['Workflow.view', 'Workflow.activate']), 'sanctum');
        $this->postJson($base.'/restore')->assertForbidden();
        $this->actingAs($this->member(['Workflow.view', 'Workflow.manage']), 'sanctum');
        $this->postJson($base.'/restore')->assertOk();
    }

    public function test_organizations_say_what_each_person_may_do_with_automations(): void
    {
        $expected = [
            'shared.operator@example.test' => ['view' => true, 'manage' => true, 'activate' => true],
            'acme.moderator@example.test' => ['view' => true, 'manage' => false, 'activate' => false],
            'acme.member@example.test' => ['view' => true, 'manage' => false, 'activate' => false],
        ];
        foreach ($expected as $email => $capabilities) {
            $this->actingAs(User::where('email', $email)->firstOrFail(), 'sanctum');
            $organization = collect($this->getJson('/api/v1/me')->assertOk()->json('data.organizations'))->firstWhere('uuid', $this->org->uuid);
            $this->assertSame($capabilities, $organization['capabilities']['automation'], $email);
        }
    }

    public function test_another_organization_cannot_archive_or_restore(): void
    {
        $w = $this->draft();
        $northstar = Organization::where('slug', 'northstar-utilities')->firstOrFail();

        $this->actingAs(User::where('email', 'northstar.admin@example.test')->firstOrFail(), 'sanctum');
        $this->postJson('/api/v1/organizations/'.$northstar->uuid.'/workflows/'.$w['uuid'].'/archive')->assertNotFound();
        $this->postJson('/api/v1/organizations/'.$northstar->uuid.'/workflows/'.$w['uuid'].'/restore')->assertNotFound();
        $this->postJson($this->url.'/'.$w['uuid'].'/archive')->assertForbidden();

        $this->assertNull(Workflow::where('uuid', $w['uuid'])->value('archived_at'));
    }

    public function test_lists_of_organizations_that_never_archive_are_unchanged(): void
    {
        $first = $this->draft('First');
        $second = $this->draft('Second');

        $this->getJson($this->url.'/dag')->assertOk()->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.uuid', $second['uuid'])->assertJsonPath('data.1.uuid', $first['uuid'])
            ->assertJsonPath('data.0.archived_at', null)->assertJsonPath('meta.total', 2)->assertJsonPath('meta.archived_count', 0);
        $this->getJson($this->url.'?kind=all')->assertOk()->assertJsonCount(2, 'data')->assertJsonPath('meta.archived_count', 0);
    }

    private function draft(string $name = 'DAG'): array
    {
        return $this->postJson($this->url, ['name' => $name, 'workflow' => $this->graph])->assertCreated()->json('data');
    }

    /** Activates the draft and has the runtime acknowledge it. */
    private function activate(array $w): Deployment
    {
        $operation = (string) Str::uuid();
        $this->postJson($this->url.'/'.$w['uuid'].'/deployments', ['operation_uuid' => $operation, 'target_state' => 'active', 'draft_revision' => 1, 'expected_generation' => 0])->assertStatus(202);
        $deployment = Deployment::where('uuid', $operation)->firstOrFail();
        $this->acknowledge($deployment);
        $this->assertSame('applied', Workflow::where('uuid', $w['uuid'])->value('deployment_status'));

        return $deployment;
    }

    private function acknowledge(Deployment $deployment): void
    {
        DB::transaction(fn () => app(WorkflowDeploymentService::class)->event('workflow.deployment.v1', ['rule_uuid' => Workflow::findOrFail($deployment->automation_workflow_id)->uuid, 'organization_uuid' => $this->org->uuid, 'operation_uuid' => $deployment->uuid, 'generation' => $deployment->generation, 'target' => $deployment->target, 'status' => 'succeeded']));
    }

    /** @param  list<string>  $permissions */
    private function member(array $permissions): User
    {
        $registrar = app(PermissionRegistrar::class);
        $registrar->setPermissionsTeamId($this->org->id);
        $role = Role::create(['name' => 'automation-'.Str::random(6), 'display_name' => 'Automation', 'guard_name' => 'web', 'organization_id' => $this->org->id, 'is_default' => false]);
        $role->givePermissionTo($permissions);
        $user = User::factory()->create();
        $this->org->users()->attach($user);
        $user->assignRole($role);
        $registrar->setPermissionsTeamId(null);
        $registrar->forgetCachedPermissions();

        return $user;
    }
}
