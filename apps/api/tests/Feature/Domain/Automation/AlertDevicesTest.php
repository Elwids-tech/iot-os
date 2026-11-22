<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Automation;

use App\Domain\Automation\Models\Alert;
use App\Domain\Automation\Models\Deployment;
use App\Domain\Automation\Models\Workflow;
use App\Domain\Automation\Services\AlertProjector;
use App\Domain\Automation\Services\AlertQuery;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\Site;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/** A workflow alert belongs to every device its automation reads (spec 037, FR-025 to FR-029). */
final class AlertDevicesTest extends TestCase
{
    use RefreshDatabase;

    private Organization $org;

    private User $actor;

    private Device $pump;

    private Device $tank;

    private Device $valve;

    private string $base;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->org = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->actor = User::where('email', 'super-admin@example.test')->firstOrFail();
        $this->actingAs($this->actor, 'sanctum');
        $this->pump = Device::create(['organization_id' => $this->org->id, 'code' => 'pump-1', 'name' => 'Pump 1']);
        $this->tank = Device::create(['organization_id' => $this->org->id, 'code' => 'tank-1', 'name' => 'Tank 1']);
        $this->valve = Device::create(['organization_id' => $this->org->id, 'code' => 'valve-1', 'name' => 'Valve 1']);
        $this->base = '/api/v1/organizations/'.$this->org->uuid;
    }

    /**
     * An automation that reads the pump and the tank and commands the valve, which it
     * binds first.
     *
     * @param  list<string>|null  $foreign  extra device uuids to read
     */
    private function graph(?array $foreign = null): array
    {
        $bindings = [['role' => 'valve', 'device_uuid' => $this->valve->uuid], ['role' => 'temperature', 'device_uuid' => $this->pump->uuid], ['role' => 'pressure', 'device_uuid' => $this->tank->uuid]];
        $nodes = [['id' => 'temperature', 'type' => 'source.parameter.v1', 'config' => ['binding' => 'temperature']], ['id' => 'pressure', 'type' => 'source.parameter.v1', 'config' => ['binding' => 'pressure']],
            ['id' => 'alert', 'type' => 'action.alert.v1', 'config' => ['title' => 'Pump safety']], ['id' => 'close', 'type' => 'action.command.v1', 'config' => ['binding' => 'valve', 'value' => false]]];
        foreach ($foreign ?? [] as $i => $uuid) {
            $bindings[] = ['role' => 'other_'.$i, 'device_uuid' => $uuid];
            $nodes[] = ['id' => 'other_'.$i, 'type' => 'source.parameter.v1', 'config' => ['binding' => 'other_'.$i]];
        }

        return ['schema_version' => 'automation-workflow.v2', 'bindings' => $bindings, 'nodes' => $nodes, 'edges' => []];
    }

    private function deployment(array $definition, ?Organization $organization = null): Deployment
    {
        $workflow = Workflow::create(['organization_id' => ($organization ?? $this->org)->id, 'name' => 'Pump safety', 'workflow' => $definition, 'definition' => $definition, 'definition_hash' => str_repeat('a', 64), 'updated_by' => $this->actor->id]);

        return Deployment::create(['automation_workflow_id' => $workflow->id, 'generation' => 1, 'draft_revision' => 1, 'target' => 'active', 'status' => 'succeeded', 'definition' => $definition, 'definition_hash' => str_repeat('a', 64), 'created_by' => $this->actor->id, 'created_at' => now()]);
    }

    private function project(Deployment $deployment, string $type = 'activated', int $episode = 1): Alert
    {
        $workflow = Workflow::findOrFail($deployment->automation_workflow_id);
        DB::transaction(fn () => app(AlertProjector::class)->project($workflow, $deployment, ['id' => hash('sha256', $deployment->uuid.':'.$episode.':'.$type), 'type' => $type, 'episode' => $episode, 'occurred_at' => now()->toIso8601String()]));

        return Alert::where('automation_deployment_id', $deployment->id)->where('episode', $episode)->firstOrFail();
    }

    /** @return list<string> */
    private function found(string $query): array
    {
        return $this->getJson($this->base.'/alerts?'.$query)->assertOk()->json('data.*.uuid');
    }

    public function test_an_alert_is_found_from_every_device_its_automation_reads_and_not_from_one_it_commands(): void
    {
        $alert = $this->project($this->deployment($this->graph()));

        $this->assertEqualsCanonicalizing([$this->pump->id, $this->tank->id], $alert->devices()->pluck('devices.id')->all());
        $this->assertSame([$alert->uuid], $this->found('device='.$this->pump->uuid));
        $this->assertSame([$alert->uuid], $this->found('device='.$this->tank->uuid));
        $this->assertSame([], $this->found('device='.$this->valve->uuid));
        $this->getJson($this->base.'/alerts/'.$alert->uuid)->assertOk()->assertJsonPath('data.devices_total', 2)
            ->assertJsonPath('data.devices', [['uuid' => $this->pump->uuid, 'name' => 'Pump 1'], ['uuid' => $this->tank->uuid, 'name' => 'Tank 1']])
            // The alert's main device is still its first binding.
            ->assertJsonPath('data.device_uuid', $this->valve->uuid);
    }

    public function test_projecting_the_same_episode_again_lists_no_device_twice(): void
    {
        $deployment = $this->deployment($this->graph());
        $this->project($deployment);
        $this->project($deployment);
        $alert = $this->project($deployment, 'cleared');

        $this->assertSame(2, DB::table('automation_alert_devices')->where('automation_alert_id', $alert->id)->count());
    }

    public function test_a_device_of_another_organization_named_by_the_snapshot_is_never_listed(): void
    {
        $northstar = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $theirs = Device::create(['organization_id' => $northstar->id, 'code' => 'meter-1', 'name' => 'Meter 1']);
        $alert = $this->project($this->deployment($this->graph([$theirs->uuid, (string) Str::uuid()])));

        $this->assertEqualsCanonicalizing([$this->pump->id, $this->tank->id], $alert->devices()->pluck('devices.id')->all());
        $this->getJson('/api/v1/organizations/'.$northstar->uuid.'/alerts?device='.$theirs->uuid)->assertOk()->assertJsonPath('meta.total', 0);
    }

    public function test_alerts_by_site_follow_the_same_devices(): void
    {
        $yard = Site::create(['organization_id' => $this->org->id, 'name' => 'Yard', 'timezone' => 'UTC']);
        $shed = Site::create(['organization_id' => $this->org->id, 'name' => 'Shed', 'timezone' => 'UTC']);
        $this->tank->update(['site_id' => $yard->id]);
        $this->valve->update(['site_id' => $shed->id]);
        $alert = $this->project($this->deployment($this->graph()));
        $query = app(AlertQuery::class);

        $this->assertSame([$alert->id], $query->filtered($this->org, ['site' => $yard->uuid])->pluck('automation_alerts.id')->all());
        $this->assertSame([], $query->filtered($this->org, ['site' => $shed->uuid])->pluck('automation_alerts.id')->all());
    }

    public function test_an_alert_whose_bound_device_names_no_device_is_still_found_by_it(): void
    {
        $unknown = (string) Str::uuid();
        $alert = $this->project($this->deployment(['bindings' => [['role' => 'pump', 'device_uuid' => $unknown]]]));

        $this->assertSame(0, $alert->devices()->count());
        $this->assertSame([$alert->uuid], $this->found('device='.$unknown));
    }

    public function test_connectivity_alerts_are_found_as_before(): void
    {
        $offline = Alert::create(['organization_id' => $this->org->id, 'kind' => Alert::DEVICE_OFFLINE, 'severity' => 'critical', 'episode' => 1, 'episode_key' => 'device_offline:'.Str::uuid().'#1', 'subject_device_id' => $this->pump->id, 'cause' => 'death_certificate', 'activated_at' => now()]);
        $offline->devices()->attach($this->pump->id);
        $workflow = $this->project($this->deployment($this->graph()));

        $this->assertEqualsCanonicalizing([$offline->uuid, $workflow->uuid], $this->found('device='.$this->pump->uuid));
        $this->assertSame([$workflow->uuid], $this->found('device='.$this->tank->uuid));
        $this->assertSame([$offline->uuid], $this->found('device='.$this->pump->uuid.'&kind[]=device_offline'));
    }

    public function test_the_rollout_lists_every_read_device_on_earlier_alerts_and_drops_a_commanded_one(): void
    {
        $deployment = $this->deployment($this->graph());
        $workflow = Workflow::findOrFail($deployment->automation_workflow_id);
        // As stored before the rollout: the first binding only, here the commanded valve.
        $earlier = Alert::create(['organization_id' => $this->org->id, 'automation_workflow_id' => $workflow->id, 'automation_deployment_id' => $deployment->id, 'episode' => 1, 'activated_at' => now()]);
        $earlier->devices()->attach($this->valve->id);
        // A snapshot that names no source keeps the device it lists.
        $bare = $this->deployment(['bindings' => [['role' => 'pump', 'device_uuid' => $this->pump->uuid]]]);
        $kept = Alert::create(['organization_id' => $this->org->id, 'automation_workflow_id' => $bare->automation_workflow_id, 'automation_deployment_id' => $bare->id, 'episode' => 1, 'activated_at' => now()]);
        $kept->devices()->attach($this->pump->id);
        $offline = Alert::create(['organization_id' => $this->org->id, 'kind' => Alert::DEVICE_OFFLINE, 'severity' => 'critical', 'episode' => 1, 'episode_key' => 'device_offline:'.Str::uuid().'#1', 'subject_device_id' => $this->valve->id, 'cause' => 'death_certificate', 'activated_at' => now()]);
        $offline->devices()->attach($this->valve->id);

        $migration = require database_path('migrations/2026_12_06_000100_list_read_devices_on_workflow_alerts.php');
        $migration->up();
        $migration->up();

        $this->assertEqualsCanonicalizing([$this->pump->id, $this->tank->id], $earlier->devices()->pluck('devices.id')->all());
        $this->assertSame([$this->pump->id], $kept->devices()->pluck('devices.id')->all());
        $this->assertSame([$this->valve->id], $offline->devices()->pluck('devices.id')->all());
        $this->assertSame([$earlier->uuid], $this->found('device='.$this->tank->uuid));
    }
}
