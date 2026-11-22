<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Automation;

use App\Domain\Authorization\Models\Role;
use App\Domain\Automation\Models\Deployment;
use App\Domain\Automation\Models\Workflow;
use App\Domain\Devices\Models\Device;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Spatie\Permission\PermissionRegistrar;
use Tests\TestCase;

/** GET workflows/alert-limits: the alert limits of applied automations on a set of devices (spec 037). */
final class AlertLimitsTest extends TestCase
{
    use RefreshDatabase;

    private Organization $org;

    private User $actor;

    private Device $pump;

    private Device $tank;

    private string $temperature;

    private string $pressure;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->org = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->actor = User::where('email', 'super-admin@example.test')->firstOrFail();
        $this->actingAs($this->actor, 'sanctum');
        $this->pump = Device::create(['organization_id' => $this->org->id, 'code' => 'pump-1', 'name' => 'Pump 1']);
        $this->tank = Device::create(['organization_id' => $this->org->id, 'code' => 'tank-1', 'name' => 'Tank 1']);
        [$this->temperature, $this->pressure] = [(string) Str::uuid(), (string) Str::uuid()];
    }

    /** One reading compared directly: `device` parameter `parameter` above `value`. */
    private function graph(float|int $value = 25, ?Device $device = null, ?string $parameter = null, string $unit = 'C'): array
    {
        return ['schema_version' => 'automation-workflow.v2',
            'bindings' => [['role' => 'sensor', 'device_uuid' => ($device ?? $this->pump)->uuid, 'parameter_uuid' => $parameter ?? $this->temperature, 'data_type' => 'number', 'unit' => $unit]],
            'nodes' => [['id' => 'source', 'type' => 'source.parameter.v1', 'config' => ['binding' => 'sensor']], ['id' => 'threshold', 'type' => 'compare.v1', 'config' => ['operator' => 'gt', 'value' => $value]], ['id' => 'alert', 'type' => 'action.alert.v1', 'config' => ['title' => 'Hot']]],
            'edges' => [['source' => 'source', 'source_port' => 'out', 'target' => 'threshold', 'target_port' => 'in'], ['source' => 'threshold', 'source_port' => 'out', 'target' => 'alert', 'target_port' => 'in']]];
    }

    private function workflow(string $name, array $graph, ?Organization $organization = null): Workflow
    {
        return Workflow::create(['organization_id' => ($organization ?? $this->org)->id, 'name' => $name, 'workflow' => $graph, 'definition' => [], 'definition_hash' => str_repeat('a', 64), 'updated_by' => $this->actor->id]);
    }

    private function deployment(Workflow $workflow, array $definition, int $generation = 1): Deployment
    {
        return Deployment::create(['automation_workflow_id' => $workflow->id, 'generation' => $generation, 'draft_revision' => $generation, 'target' => 'active', 'status' => 'succeeded', 'definition' => $definition, 'definition_hash' => str_repeat('a', 64), 'created_by' => $this->actor->id, 'created_at' => now()]);
    }

    /** An automation whose deployment the runtime has confirmed. */
    private function applied(string $name, array $graph, ?Organization $organization = null): Workflow
    {
        $workflow = $this->workflow($name, $graph, $organization);
        $deployment = $this->deployment($workflow, $graph);
        $workflow->update(['applied_deployment_uuid' => $deployment->uuid, 'desired_deployment_uuid' => $deployment->uuid, 'deployment_status' => 'applied', 'deployment_generation' => 1]);

        return $workflow;
    }

    private function url(array $devices, ?Organization $organization = null): string
    {
        return '/api/v1/organizations/'.($organization ?? $this->org)->uuid.'/workflows/alert-limits?'.http_build_query(['device' => $devices]);
    }

    /** @return list<array{string, string, int|float}> automation name, state and value of each row */
    private function rows(?array $devices = null): array
    {
        return array_map(fn (array $row): array => [$row['workflow_name'], $row['state'], $row['value']], $this->getJson($this->url($devices ?? [$this->pump->uuid, $this->tank->uuid]))->assertOk()->json('data'));
    }

    public function test_an_applied_automation_gives_its_limit_with_every_field(): void
    {
        $workflow = $this->applied('Pump safety', $this->graph());

        $this->getJson($this->url([$this->pump->uuid]))->assertOk()->assertJsonCount(1, 'data')->assertJsonStructure(['meta' => ['checked_at']])
            ->assertExactJson(['meta' => ['checked_at' => $this->getJson($this->url([$this->pump->uuid]))->json('meta.checked_at')], 'data' => [[
                'workflow_uuid' => $workflow->uuid, 'workflow_name' => 'Pump safety', 'state' => 'running', 'device_uuid' => $this->pump->uuid, 'parameter_uuid' => $this->temperature,
                'role' => 'raise', 'operator' => 'gt', 'value' => 25, 'unit' => 'C', 'aggregate' => null, 'window_seconds' => null, 'held_seconds' => null, 'combined' => false,
            ]]]);
    }

    public function test_limits_follow_the_applied_deployment_through_every_state(): void
    {
        // A draft that was never activated, and an activation the runtime has not answered.
        $this->workflow('Draft', $this->graph(10));
        $waiting = $this->workflow('Waiting', $this->graph(11));
        $waiting->update(['pending_operation_uuid' => $this->deployment($waiting, $this->graph(11))->uuid, 'deployment_status' => 'pending']);
        $this->assertSame([], $this->rows());

        // Applied, then a change waiting over it: the applied one still answers.
        $running = $this->applied('Running', $this->graph(25));
        $running->update(['workflow' => $this->graph(30), 'pending_operation_uuid' => $this->deployment($running, $this->graph(30), 2)->uuid, 'deployment_status' => 'pending']);
        $this->assertSame([['Running', 'running', 25]], $this->rows());

        // Suspended: still listed, as suspended.
        $suspended = $this->applied('Suspended', $this->graph(40));
        Deployment::where('uuid', $suspended->applied_deployment_uuid)->update(['stopped_reason' => 'binding_changed: sensor']);
        $suspended->update(['deployment_status' => 'suspended']);
        $this->assertSame([['Running', 'running', 25], ['Suspended', 'suspended', 40]], $this->rows());

        // Deactivated and archived automations give nothing.
        $this->applied('Deactivated', $this->graph(50))->update(['applied_deployment_uuid' => null, 'desired_deployment_uuid' => null, 'deployment_status' => 'inactive']);
        $this->applied('Archived', $this->graph(60))->update(['archived_at' => now(), 'archived_by' => $this->actor->id]);
        $this->assertSame([['Running', 'running', 25], ['Suspended', 'suspended', 40]], $this->rows());
    }

    public function test_a_geofence_rule_and_an_unplaceable_condition_give_nothing(): void
    {
        $this->applied('Yard', ['binding' => ['device_uuid' => $this->pump->uuid]]);
        $counted = $this->graph();
        array_splice($counted['nodes'], 1, 0, [['id' => 'window', 'type' => 'window.v1', 'config' => ['duration_seconds' => 60, 'aggregate' => 'count']]]);
        $counted['edges'] = [['source' => 'source', 'source_port' => 'out', 'target' => 'window', 'target_port' => 'in'], ['source' => 'window', 'source_port' => 'out', 'target' => 'threshold', 'target_port' => 'in'], ['source' => 'threshold', 'source_port' => 'out', 'target' => 'alert', 'target_port' => 'in']];
        $this->applied('Counted', $counted);

        $this->assertSame([], $this->rows());
    }

    public function test_rows_are_for_the_asked_devices_only_and_in_a_stable_order(): void
    {
        $this->applied('B rule', $this->graph(30));
        $this->applied('A rule', $this->graph(40));
        $this->applied('Tank rule', $this->graph(100, $this->tank, $this->pressure, 'kPa'));

        $this->assertSame([['Tank rule', 'running', 100]], $this->rows([$this->tank->uuid]));
        $expected = [['A rule', 'running', 40], ['B rule', 'running', 30], ['Tank rule', 'running', 100]];
        $pumpFirst = strcmp($this->pump->uuid, $this->tank->uuid) < 0;
        $this->assertSame($pumpFirst ? $expected : [$expected[2], $expected[0], $expected[1]], $this->rows());
        $this->assertSame([], $this->rows([(string) Str::uuid()]));
    }

    public function test_the_request_is_validated(): void
    {
        $base = '/api/v1/organizations/'.$this->org->uuid.'/workflows/alert-limits';
        $this->getJson($base)->assertUnprocessable()->assertJsonValidationErrors('device');
        $this->getJson($base.'?device='.$this->pump->uuid)->assertUnprocessable()->assertJsonValidationErrors('device');
        $this->getJson($base.'?device[]=pump-1')->assertUnprocessable()->assertJsonValidationErrors('device.0');
        $this->getJson($this->url(array_map(fn () => (string) Str::uuid(), range(1, 101))))->assertUnprocessable()->assertJsonValidationErrors('device');
        $this->getJson($this->url(array_map(fn () => (string) Str::uuid(), range(1, 100))))->assertOk();
    }

    public function test_another_organization_gets_and_gives_nothing(): void
    {
        $northstar = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $meter = Device::create(['organization_id' => $northstar->id, 'code' => 'meter-1', 'name' => 'Meter 1']);
        $this->applied('Pump safety', $this->graph());
        // Their automation on their device, and one of theirs that names our pump.
        $this->applied('Their rule', $this->graph(70, $meter), $northstar);
        $this->applied('Their rule on our pump', $this->graph(80), $northstar);

        // Asked in our organization for their device: nothing, and none of their names.
        $this->assertSame([['Pump safety', 'running', 25]], $this->rows([$this->pump->uuid, $meter->uuid]));
        // Asked in theirs for our pump: nothing, since it is not their device.
        $this->getJson($this->url([$this->pump->uuid], $northstar))->assertOk()->assertJsonCount(0, 'data');

        $member = User::where('email', 'acme.member@example.test')->firstOrFail();
        $this->actingAs($member, 'sanctum');
        $this->getJson($this->url([$meter->uuid], $northstar))->assertForbidden();
    }

    public function test_device_view_is_what_it_takes(): void
    {
        $workflow = $this->applied('Pump safety', $this->graph());

        $this->actingAs($this->member(['Organization.view', 'Dashboard.view']), 'sanctum');
        $this->getJson($this->url([$this->pump->uuid]))->assertForbidden();

        // Seeing a limit needs no automation permission, and grants none.
        $this->actingAs($this->member(['Organization.view', 'Device.view']), 'sanctum');
        $this->getJson($this->url([$this->pump->uuid]))->assertOk()->assertJsonPath('data.0.workflow_name', 'Pump safety');
        $this->getJson('/api/v1/organizations/'.$this->org->uuid.'/workflows/dag')->assertForbidden();
        $this->assertSame('applied', $workflow->fresh()->deployment_status);
    }

    public function test_the_number_of_queries_does_not_grow_with_the_automations(): void
    {
        $count = function (): int {
            DB::flushQueryLog();
            DB::enableQueryLog();
            $this->getJson($this->url([$this->pump->uuid, $this->tank->uuid]))->assertOk();
            DB::disableQueryLog();

            return count(DB::getQueryLog());
        };
        $this->applied('First', $this->graph(1));
        $few = $count();
        foreach (range(2, 200) as $i) {
            $this->applied('Rule '.$i, $this->graph($i, $i % 2 ? $this->pump : $this->tank));
        }

        $this->assertSame($few, $count());
        $this->assertCount(200, $this->getJson($this->url([$this->pump->uuid, $this->tank->uuid]))->json('data'));
    }

    private function member(array $permissions): User
    {
        $registrar = app(PermissionRegistrar::class);
        $registrar->setPermissionsTeamId($this->org->id);
        $role = Role::create(['name' => 'limits-'.Str::random(6), 'display_name' => 'Limits', 'guard_name' => 'web', 'organization_id' => $this->org->id, 'is_default' => false]);
        $role->givePermissionTo($permissions);
        $user = User::factory()->create();
        $this->org->users()->attach($user);
        $user->assignRole($role);
        $registrar->setPermissionsTeamId(null);
        $registrar->forgetCachedPermissions();

        return $user;
    }
}
