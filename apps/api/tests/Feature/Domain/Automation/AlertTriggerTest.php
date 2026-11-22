<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Automation;

use App\Domain\Automation\Models\Alert;
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
use Illuminate\Support\Str;
use Tests\TestCase;

/** What an automation alert's detail says it watches, read from the execution that raised it. */
final class AlertTriggerTest extends TestCase
{
    use RefreshDatabase;

    private Organization $org;

    private User $actor;

    private string $base;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->org = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->actor = User::where('is_super_admin', true)->firstOrFail();
        $this->actingAs($this->actor, 'sanctum');
        $this->base = '/api/v1/organizations/'.$this->org->uuid;
    }

    public function test_one_comparison_of_one_reading_names_the_reading_and_its_limit(): void
    {
        $flow = $this->reading($this->org, 'Workshop meter', 'flow_rate', 'Flow rate', 'L/min');
        $alert = $this->alert([$flow], [
            ['id' => 'read', 'type' => 'source.parameter.v1', 'config' => ['binding' => 'r0']],
            ['id' => 'high', 'type' => 'compare.v1', 'config' => ['operator' => 'gt', 'value' => 10]],
            ['id' => 'held', 'type' => 'sustained.v1', 'config' => ['seconds' => 300]],
            ['id' => 'alert', 'type' => 'action.alert.v1', 'config' => ['title' => 'High flow']],
        ], [['read', 'high'], ['high', 'held'], ['held', 'alert']]);

        $this->getJson($this->base.'/alerts/'.$alert->uuid)->assertOk()
            ->assertJsonPath('data.trigger.readings', [['device_uuid' => $flow['device_uuid'], 'parameter_uuid' => $flow['parameter_uuid'], 'name' => 'Flow rate', 'unit' => 'L/min']])
            ->assertJsonPath('data.trigger.condition', ['kind' => 'compare', 'operator' => 'gt', 'value' => 10])
            ->assertJsonPath('data.trigger.sustained_seconds', 300)
            ->assertJsonPath('data.trigger.window', null);
        // Lists stay as they were: the trigger is worked out for one alert at a time.
        $this->getJson($this->base.'/alerts')->assertOk()->assertJsonMissingPath('data.0.trigger');
        $this->postJson($this->base.'/alerts/'.$alert->uuid.'/acknowledge')->assertOk()->assertJsonPath('data.trigger.condition.value', 10);
    }

    public function test_a_condition_on_several_readings_or_a_rescaled_one_names_readings_without_a_limit(): void
    {
        $flow = $this->reading($this->org, 'Pump', 'flow_rate', 'Flow rate', 'L/min');
        $pressure = $this->reading($this->org, 'Pump header', 'pressure', 'Pressure', 'bar');
        $both = $this->alert([$flow, $pressure], [
            ['id' => 'flow', 'type' => 'source.parameter.v1', 'config' => ['binding' => 'r0']],
            ['id' => 'pressure', 'type' => 'source.parameter.v1', 'config' => ['binding' => 'r1']],
            ['id' => 'hot', 'type' => 'compare.v1', 'config' => ['operator' => 'gt', 'value' => 25]],
            ['id' => 'tight', 'type' => 'compare.v1', 'config' => ['operator' => 'gt', 'value' => 100]],
            ['id' => 'and', 'type' => 'boolean.v1', 'config' => ['operator' => 'and']],
            ['id' => 'alert', 'type' => 'action.alert.v1', 'config' => ['title' => 'Pump safety']],
        ], [['flow', 'hot'], ['pressure', 'tight'], ['hot', 'and'], ['tight', 'and'], ['and', 'alert']]);
        $this->getJson($this->base.'/alerts/'.$both->uuid)->assertOk()
            ->assertJsonCount(2, 'data.trigger.readings')->assertJsonPath('data.trigger.condition', null)->assertJsonPath('data.trigger.sustained_seconds', null);

        // A converted reading is no longer on the scale the limit is written in.
        $converted = $this->alert([$flow], [
            ['id' => 'read', 'type' => 'source.parameter.v1', 'config' => ['binding' => 'r0']],
            ['id' => 'scale', 'type' => 'math.v1', 'config' => ['operator' => 'multiply', 'value' => 60]],
            ['id' => 'high', 'type' => 'compare.v1', 'config' => ['operator' => 'gt', 'value' => 600]],
            ['id' => 'alert', 'type' => 'action.alert.v1', 'config' => ['title' => 'High flow']],
        ], [['read', 'scale'], ['scale', 'high'], ['high', 'alert']]);
        $this->getJson($this->base.'/alerts/'.$converted->uuid)->assertOk()
            ->assertJsonPath('data.trigger.readings.0.name', 'Flow rate')->assertJsonPath('data.trigger.condition', null);
    }

    public function test_the_step_that_raised_the_alert_is_the_one_read_when_an_automation_has_several(): void
    {
        $flow = $this->reading($this->org, 'Meter', 'flow_rate', 'Flow rate', 'L/min');
        $alert = $this->alert([$flow], [
            ['id' => 'read', 'type' => 'source.parameter.v1', 'config' => ['binding' => 'r0']],
            ['id' => 'low', 'type' => 'compare.v1', 'config' => ['operator' => 'lt', 'value' => 1]],
            ['id' => 'high', 'type' => 'compare.v1', 'config' => ['operator' => 'gt', 'value' => 10]],
            ['id' => 'low_alert', 'type' => 'action.alert.v1', 'config' => ['title' => 'Low flow']],
            ['id' => 'high_alert', 'type' => 'action.alert.v1', 'config' => ['title' => 'High flow']],
        ], [['read', 'low'], ['read', 'high'], ['low', 'low_alert'], ['high', 'high_alert']]);
        // Two alert steps and nothing naming one: no guess.
        $this->getJson($this->base.'/alerts/'.$alert->uuid)->assertOk()->assertJsonPath('data.trigger', null);

        $intent = (string) Str::uuid();
        DB::table('automation_actions')->insert(['id' => $intent, 'organization_id' => $this->org->id, 'automation_deployment_id' => $alert->automation_deployment_id, 'node_id' => 'low_alert', 'kind' => 'alert', 'status' => 'done', 'intent' => '{}', 'expires_at' => now()->addDay(), 'created_at' => now(), 'updated_at' => now()]);
        $alert->update(['activation_transition_id' => $intent]);
        $this->getJson($this->base.'/alerts/'.$alert->uuid)->assertOk()->assertJsonPath('data.trigger.condition', ['kind' => 'compare', 'operator' => 'lt', 'value' => 1]);
    }

    public function test_another_organizations_device_is_never_named_and_older_definitions_have_no_trigger(): void
    {
        $northstar = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $foreign = $this->reading($northstar, 'Their meter', 'flow_rate', 'Their flow', 'L/min');
        $alert = $this->alert([$foreign], [
            ['id' => 'read', 'type' => 'source.parameter.v1', 'config' => ['binding' => 'r0']],
            ['id' => 'high', 'type' => 'compare.v1', 'config' => ['operator' => 'gt', 'value' => 10]],
            ['id' => 'alert', 'type' => 'action.alert.v1', 'config' => ['title' => 'High flow']],
        ], [['read', 'high'], ['high', 'alert']]);
        $this->getJson($this->base.'/alerts/'.$alert->uuid)->assertOk()->assertJsonPath('data.trigger.readings.0.name', null);

        // A geofence execution binds a device and has no steps to read.
        $workflow = Workflow::create(['organization_id' => $this->org->id, 'name' => 'North paddock', 'workflow' => ['nodes' => []], 'definition' => [], 'definition_hash' => str_repeat('a', 64), 'updated_by' => $this->actor->id]);
        $deployment = Deployment::create(['automation_workflow_id' => $workflow->id, 'generation' => 1, 'draft_revision' => 1, 'target' => 'active', 'status' => 'succeeded', 'definition' => ['binding' => ['device_uuid' => (string) Str::uuid()]], 'definition_hash' => str_repeat('a', 64), 'created_by' => $this->actor->id, 'created_at' => now()]);
        $geofence = Alert::create(['organization_id' => $this->org->id, 'automation_workflow_id' => $workflow->id, 'automation_deployment_id' => $deployment->id, 'episode' => 1, 'activated_at' => now()]);
        $this->getJson($this->base.'/alerts/'.$geofence->uuid)->assertOk()->assertJsonPath('data.trigger', null);
    }

    /** A device with one reading, as a binding would name it. */
    private function reading(Organization $organization, string $device, string $key, string $label, string $unit): array
    {
        $parameter = (string) Str::uuid();
        $profile = DeviceProfile::create(['organization_id' => $organization->id, 'code' => Str::slug($device.'-'.$key), 'name' => $device]);
        $artifact = DeviceProfileArtifact::create(['device_profile_id' => $profile->id, 'revision' => 1, 'definition' => [], 'definition_hash' => str_repeat('a', 64), 'status' => 'active', 'compiled_at' => now(), 'compiled_by' => $this->actor->id]);
        $record = Device::create(['organization_id' => $organization->id, 'name' => $device, 'code' => Str::slug($device), 'lifecycle' => 'active', 'deployment_status' => 'applied', 'deployment_generation' => 1, 'applied_generation' => 1]);
        $canonical = json_encode(['parameters' => [['uuid' => $parameter, 'key' => $key, 'label' => $label, 'data_type' => 'number', 'unit' => $unit, 'reports_state' => true]]]);
        $configuration = DeviceConfiguration::create(['device_id' => $record->id, 'device_profile_artifact_id' => $artifact->id, 'revision' => 1, 'definition_hash' => str_repeat('b', 64), 'definition' => ['profile_canonical_json' => $canonical, 'mappings' => [['parameter_uuid' => $parameter, 'metric' => $key]]], 'created_at' => now()]);
        $record->update(['applied_configuration_uuid' => $configuration->uuid]);

        return ['device_uuid' => $record->uuid, 'configuration_uuid' => $configuration->uuid, 'generation' => 1, 'parameter_uuid' => $parameter, 'data_type' => 'number', 'unit' => $unit, 'fresh_seconds' => 120];
    }

    /**
     * An active alert of an automation whose execution has these steps.
     *
     * @param  list<array<string, mixed>>  $readings  bindings, given the roles r0, r1, ...
     * @param  list<array{0: string, 1: string}>  $edges  source step, target step
     */
    private function alert(array $readings, array $nodes, array $edges): Alert
    {
        $definition = [
            'schema_version' => 'automation-workflow.v2',
            'bindings' => array_map(fn (array $reading, int $index) => ['role' => 'r'.$index, ...$reading], $readings, array_keys($readings)),
            'nodes' => $nodes,
            'edges' => array_map(fn (array $edge) => ['source' => $edge[0], 'source_port' => 'out', 'target' => $edge[1], 'target_port' => 'in'], $edges),
        ];
        $workflow = Workflow::create(['organization_id' => $this->org->id, 'name' => 'Flow watch '.Str::random(4), 'workflow' => $definition, 'definition' => $definition, 'definition_hash' => str_repeat('e', 64), 'updated_by' => $this->actor->id]);
        $deployment = Deployment::create(['automation_workflow_id' => $workflow->id, 'generation' => 1, 'draft_revision' => 1, 'target' => 'active', 'status' => 'succeeded', 'definition' => $definition, 'definition_hash' => str_repeat('e', 64), 'created_by' => $this->actor->id, 'created_at' => now()]);

        return Alert::create(['organization_id' => $this->org->id, 'automation_workflow_id' => $workflow->id, 'automation_deployment_id' => $deployment->id, 'episode' => 1, 'activated_at' => now()->subHour()->startOfSecond()]);
    }
}
