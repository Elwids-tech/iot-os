<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Devices\Moves;

use App\Domain\Automation\Models\Alert;
use App\Domain\DeviceProfiles\Actions\PublishDeviceProfile;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceConfiguration;
use App\Domain\Devices\Models\DeviceOnboarding;
use App\Domain\Devices\Models\DiscoveryCandidate;
use App\Domain\Devices\Models\SparkplugConnection;
use App\Domain\Devices\Models\SparkplugGateway;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/**
 * Devices behind a gateway move like adapter-fed ones (spec 031 US1, research R14): the
 * gateway stays with its owner in A and keeps serving each successor in B as a hosted
 * device, the successor activates against the source's live birth, and the setup row is
 * released so the owner can onboard the source again once no device holds it.
 */
final class GatewayMoveTest extends MoveTestCase
{
    private SparkplugGateway $gateway;

    protected function setUp(): void
    {
        parent::setUp();
        $connection = SparkplugConnection::create(['organization_id' => $this->a->id, 'name' => 'Plant broker', 'group_id' => 'plant', 'host_id' => 'plant-host', 'username' => 'plant-'.Str::random(6), 'password' => 'test-secret', 'status' => 'ready']);
        $this->gateway = SparkplugGateway::create(['organization_id' => $this->a->id, 'sparkplug_connection_id' => $connection->id, 'name' => 'Line gateway', 'edge_node_id' => 'line-1',
            'username' => 'edge-'.Str::uuid(), 'password' => Str::random(48), 'presence' => 'online', 'runtime_seen_at' => now()]);
    }

    public function test_one_of_two_devices_behind_a_gateway_moves_and_the_gateway_stays_with_a(): void
    {
        $x = $this->behind('meter-1', 'Meter X');
        $y = $this->behind('meter-2', 'Meter Y');

        $review = $this->review($this->a, $this->b, [$x])->assertOk()->json();
        $this->assertTrue($review['can_confirm']);
        $this->assertSame(['kind' => 'gateway', 'name' => 'Line gateway', 'owner_organization_name' => 'Integrator', 'outcome' => 'stays'], $review['devices'][0]['reports_through']);
        $this->assertContains('1 device keeps reporting through the gateway Line gateway, which stays with Integrator.', $review['summary']);
        $this->assertTrue($review['pipe_owner_sees_raw_messages']);
        $move = $this->moved($this->a, $this->b, [$x]);

        $this->assertSame('completed', $move['status']);
        $inB = $this->successor($x);
        $this->assertSame([$this->b->id, $x->device_discovery_candidate_id, $x->reserved_source_uuid], [$inB->organization_id, $inB->device_discovery_candidate_id, $inB->reserved_source_uuid]);
        // The successor activates against the source's live birth, through the same gateway.
        $this->assertSame('pending', $inB->deployment_status);
        $definition = DeviceConfiguration::where('uuid', $inB->desired_configuration_uuid)->firstOrFail()->definition;
        $this->assertSame(['plant', 'line-1', 'meter-1'], [$definition['source']['group_id'], $definition['source']['edge_node_id'], $definition['source']['device_id']]);
        $this->assertSame($this->b->uuid, $definition['organization_uuid']);
        $this->applied($inB);
        $this->assertSame(['archived', 'active'], [$x->fresh()->lifecycle, $inB->fresh()->lifecycle]);
        $this->assertSame('active', $y->fresh()->lifecycle);
        // The gateway stays A's, and B's device names it with its owner only.
        $this->assertSame($this->a->id, $this->gateway->fresh()->organization_id);
        $device = $this->as($this->bOnly, fn () => $this->getJson($this->in($this->b).'/devices/'.$inB->uuid)->assertOk()->json('data'));
        $this->assertSame(['kind' => 'gateway', 'name' => 'Line gateway', 'owner_organization_name' => 'Integrator', 'online' => true, 'hosted' => true], $device['pipe']);
        $this->assertNull($device['candidate']['gateway']);
        $this->assertStringNotContainsString($this->gateway->uuid, json_encode($device));
        // A's setup of the predecessor is released; the successor holds the source.
        $this->assertNotNull(DeviceOnboarding::where('device_id', $x->id)->value('released_at'));
        $this->assertNull(DeviceOnboarding::where('device_id', $y->id)->value('released_at'));
    }

    public function test_the_gateway_stays_with_a_when_every_device_behind_it_moves(): void
    {
        $x = $this->behind('meter-1', 'Meter X');
        $y = $this->behind('meter-2', 'Meter Y');

        $move = $this->moved($this->a, $this->b, [$x, $y]);

        $this->assertSame('completed', $move['status']);
        $this->assertSame($this->a->id, $this->gateway->fresh()->organization_id);
        $gateways = $this->as($this->aOnly, fn () => $this->getJson($this->in($this->a).'/gateways')->assertOk()->json('data'));
        $this->assertContains($this->gateway->uuid, array_column($gateways, 'uuid'));
        $this->assertSame([], $this->as($this->bOnly, fn () => $this->getJson($this->in($this->b).'/gateways')->assertOk()->json('data')));
        $this->assertSame([$this->b->id, $this->b->id], [$this->successor($x)->organization_id, $this->successor($y)->organization_id]);
    }

    public function test_the_gateways_own_metrics_device_moves(): void
    {
        $node = $this->behind('', 'Line gateway health');

        $review = $this->review($this->a, $this->b, [$node])->assertOk()->json();
        $this->assertSame([], $review['devices'][0]['blockers']);
        $this->assertSame('gateway', $review['devices'][0]['reports_through']['kind']);
        $this->moved($this->a, $this->b, [$node]);

        $inB = $this->successor($node);
        $this->assertSame('', $inB->candidate->source_device_id);
        $this->assertSame('', DeviceConfiguration::where('uuid', $inB->desired_configuration_uuid)->firstOrFail()->definition['source']['device_id']);
        $this->applied($inB);
        $this->assertSame(['kind' => 'gateway', 'name' => 'Line gateway', 'owner_organization_name' => 'Integrator', 'online' => true, 'hosted' => true],
            $this->getJson($this->in($this->b).'/devices/'.$inB->uuid)->assertOk()->json('data.pipe'));
    }

    public function test_as_discovery_shows_the_moved_source_in_use_in_b(): void
    {
        $x = $this->behind('meter-1', 'Meter X');
        $this->moved($this->a, $this->b, [$x]);
        $candidate = DiscoveryCandidate::findOrFail($x->device_discovery_candidate_id);

        $this->actingAs($this->aOnly, 'sanctum');
        $discovered = $this->getJson($this->in($this->a).'/discovery-candidates/'.$candidate->uuid)->assertOk()->json('data');
        $this->assertSame(['organization_name' => 'Harbour Shop'], $discovered['in_use_in']);
        $this->assertNull($discovered['assigned_device_uuid']);
        $listed = collect($this->getJson($this->in($this->a).'/discovery-candidates')->assertOk()->json('data'))->firstWhere('uuid', $candidate->uuid);
        $this->assertSame(['organization_name' => 'Harbour Shop'], $listed['in_use_in']);
        $this->assertStringNotContainsString($this->successor($x)->uuid, json_encode([$discovered, $listed]));
        // Onboarding the source again names nothing of B's device: it is still held.
        $this->postJson($this->in($this->a).'/device-onboardings', ['request_uuid' => (string) Str::uuid(), 'name' => 'Again', 'artifact_uuid' => $this->artifact()->uuid, 'mode' => 'gateway',
            'gateway_uuid' => $this->gateway->uuid, 'source_device_id' => 'meter-1'])->assertConflict()->assertJsonPath('message', 'This source is already assigned to another device.');
    }

    public function test_a_mixed_move_of_adapter_fed_and_gateway_devices(): void
    {
        $fed = $this->adapterFed('WM-1001', 'Tracker X');
        $behind = $this->behind('meter-1', 'Meter X');
        $this->deploys = [];

        $review = $this->review($this->a, $this->b, [$fed, $behind])->assertOk()->json();
        $this->assertTrue($review['can_confirm']);
        $this->assertSame(['adapter', 'gateway'], array_column(array_column($review['devices'], 'reports_through'), 'kind'));
        $this->assertContains('1 device keeps reporting through the adapter Vendor meters, which stays with Integrator.', $review['summary']);
        $this->assertContains('1 device keeps reporting through the gateway Line gateway, which stays with Integrator.', $review['summary']);
        $this->moved($this->a, $this->b, [$fed, $behind]);

        [$fedInB, $behindInB] = [$this->successor($fed), $this->successor($behind)];
        $this->assertNotNull($fedInB->openInstallation);
        $this->assertNull($behindInB->openInstallation);
        // Only the adapter restarts, once.
        $this->assertCount(1, $this->deploys);
        foreach ([$fedInB, $behindInB] as $successor) {
            $this->applied($successor);
            $this->assertSame(['active', true], [$successor->fresh()->lifecycle, $this->getJson($this->in($this->b).'/devices/'.$successor->uuid)->json('data.pipe.hosted')]);
        }
    }

    public function test_b_commands_its_hosted_gateway_device_and_the_runtime_is_asked_under_b(): void
    {
        $valve = $this->behind('valve-1', 'Valve V', $this->valveProfile(), [['name' => 'open', 'datatype' => 'Boolean', 'value' => false]]);
        $this->moved($this->a, $this->b, [$valve]);
        $inB = $this->successor($valve);
        $this->applied($inB);
        $inB->refresh();
        // The successor commands its copy of the profile's parameter.
        $parameter = $inB->appliedConfiguration->definition['mappings'][0]['parameter_uuid'];
        $this->assertNotSame($valve->appliedConfiguration->definition['mappings'][0]['parameter_uuid'], $parameter);

        $this->actingAs($this->bOnly, 'sanctum');
        $command = $this->postJson($this->in($this->b).'/devices/'.$inB->uuid.'/commands/send', ['configuration_uuid' => $inB->applied_configuration_uuid, 'parameter_uuid' => $parameter,
            'value' => true, 'idempotency_key' => (string) Str::uuid()])->assertCreated()->json('data');

        $this->assertSame('pending', $command['status']);
        Http::assertSent(fn (Request $request) => str_ends_with($request->url(), '/internal/command-check') && $request['organization_uuid'] === $this->b->uuid && $request['device_uuid'] === $inB->uuid);
        Http::assertNotSent(fn (Request $request) => str_ends_with($request->url(), '/internal/command-check') && $request['organization_uuid'] === $this->a->uuid);
        // A sees nothing of the command.
        $this->as($this->aOnly, fn () => $this->getJson($this->in($this->a).'/devices/'.$inB->uuid.'/commands')->assertNotFound());
    }

    public function test_a_gateway_alert_ends_with_its_last_listed_device_and_stays_open_for_the_others(): void
    {
        $x = $this->behind('meter-1', 'Meter X');
        $y = $this->behind('meter-2', 'Meter Y');
        $z = $this->behind('meter-3', 'Meter Z');
        $both = $this->gatewayAlert([$x, $y], 1);
        $alone = $this->gatewayAlert([$z], 2);

        $review = $this->review($this->a, $this->b, [$x, $z])->assertOk()->json();
        $this->assertSame(1, $review['ends']['alerts']);
        $this->moved($this->a, $this->b, [$x, $z]);

        // Y stays behind the offline gateway, so its alert stays A's and open.
        $this->assertNull($both->fresh()->cleared_at);
        $this->assertSame(Alert::STOPPED_DEVICE_MOVED, $alone->fresh()->stopped_reason);
        $this->assertNotNull($alone->fresh()->cleared_at);
    }

    public function test_archiving_or_moving_releases_the_setup_so_the_source_can_be_onboarded_again(): void
    {
        $x = $this->behind('meter-1', 'Meter X');
        $this->deactivated($x);
        $this->postJson($this->in($this->a).'/devices/'.$x->uuid.'/archive', ['draft_revision' => $x->fresh()->draft_revision])->assertOk();
        $this->assertNotNull(DeviceOnboarding::where('device_id', $x->id)->value('released_at'));
        $again = $this->behind('meter-1', 'Meter X again');

        // Moved, then archived in B: the owner onboards the source a third time.
        $this->moved($this->a, $this->b, [$again]);
        $inB = $this->successor($again);
        $this->applied($inB);
        $this->deactivated($inB);
        $this->postJson($this->in($this->b).'/devices/'.$inB->uuid.'/archive', ['draft_revision' => $inB->fresh()->draft_revision])->assertOk();
        $third = $this->behind('meter-1', 'Meter X third');

        $this->assertSame(3, DeviceOnboarding::where('sparkplug_gateway_id', $this->gateway->id)->where('source_device_id', 'meter-1')->count());
        $this->assertSame(1, DeviceOnboarding::where('sparkplug_gateway_id', $this->gateway->id)->where('source_device_id', 'meter-1')->whereNull('released_at')->count());
        $this->assertSame('active', $third->lifecycle);
        // An unreleased setup still holds the source.
        $this->postJson($this->in($this->a).'/device-onboardings', ['request_uuid' => (string) Str::uuid(), 'name' => 'Fourth', 'artifact_uuid' => $this->artifact()->uuid, 'mode' => 'gateway',
            'gateway_uuid' => $this->gateway->uuid, 'source_device_id' => 'meter-1'])->assertConflict();
    }

    /**
     * A device of A behind the gateway: set up through gateway onboarding, configured on
     * its discovered source, activated and applied.
     *
     * @param  ?list<array{name: string, datatype: string, value: mixed}>  $metrics
     */
    private function behind(string $source, string $name, ?DeviceProfileArtifact $artifact = null, ?array $metrics = null): Device
    {
        $artifact ??= $this->artifact();
        $metrics ??= [['name' => 'flow_rate', 'datatype' => 'Double', 'value' => 12], ['name' => 'total_volume', 'datatype' => 'Double', 'value' => 8400]];
        $candidate = DiscoveryCandidate::firstOrCreate(['sparkplug_gateway_id' => $this->gateway->id, 'source_device_id' => $source], ['organization_id' => $this->a->id, 'birth_revision' => 1,
            'presence' => 'online', 'session_id' => 'session-test', 'last_seen_at' => now(), 'metrics' => $metrics]);
        $setup = $this->as($this->mover, fn () => $this->postJson($this->in($this->a).'/device-onboardings', ['request_uuid' => (string) Str::uuid(), 'name' => $name, 'artifact_uuid' => $artifact->uuid, 'mode' => 'gateway',
            'gateway_uuid' => $this->gateway->uuid, ...($source === '' ? ['source' => 'node'] : ['source_device_id' => $source])])->assertCreated()->json('data'));
        $device = Device::where('uuid', $setup['device']['uuid'])->firstOrFail();
        $device->update(['code' => Str::slug($name)]);
        $parameters = collect($artifact->definition['parameters'])->keyBy('key');
        $mappings = collect($metrics)->map(fn (array $metric): array => ['parameter_uuid' => $parameters[$metric['name']]['uuid'], 'metric' => $metric['name'],
            'command_metric' => $parameters[$metric['name']]['accepts_command'] ? $metric['name'] : null])->all();
        $this->as($this->mover, function () use ($device, $artifact, $candidate, $mappings): void {
            $this->putJson($this->in($this->a).'/devices/'.$device->uuid.'/configuration', ['draft_revision' => $device->fresh()->draft_revision, 'artifact_uuid' => $artifact->uuid,
                'candidate_uuid' => $candidate->uuid, 'birth_revision' => 1, 'mappings' => $mappings])->assertOk();
            $this->postJson($this->in($this->a).'/devices/'.$device->uuid.'/activate', ['draft_revision' => $device->fresh()->draft_revision])->assertAccepted();
        });
        $this->applied($device);

        return $device->fresh();
    }

    private function artifact(): DeviceProfileArtifact
    {
        return DeviceProfile::where('organization_id', $this->a->id)->where('code', 'water-meter-onboarding-example')->firstOrFail()->artifacts()->firstOrFail();
    }

    /** A published valve profile of A with a writable `open` state. */
    private function valveProfile(): DeviceProfileArtifact
    {
        $profile = DeviceProfile::create(['organization_id' => $this->a->id, 'code' => 'line-valve', 'name' => 'Line valve', 'category' => 'valves', 'created_by' => $this->mover->id, 'updated_by' => $this->mover->id]);
        $profile->parameters()->create(['key' => 'open', 'label' => 'Open', 'kind' => 'state', 'data_type' => 'boolean', 'reports_state' => true, 'accepts_command' => true, 'sort_order' => 0]);

        return app(PublishDeviceProfile::class)->handle($profile->fresh(), $this->mover, 1);
    }

    /** An open gateway alert of A listing the devices, as the projector records it. */
    private function gatewayAlert(array $devices, int $episode): Alert
    {
        $alert = Alert::create(['organization_id' => $this->a->id, 'kind' => Alert::GATEWAY_OFFLINE, 'severity' => 'warning', 'episode' => $episode,
            'episode_key' => 'gateway:'.$this->gateway->connection->uuid.'/line-1#'.$episode, 'subject_gateway_id' => $this->gateway->id, 'activated_at' => now(), 'cause' => 'death_certificate']);
        $alert->devices()->attach(array_map(fn (Device $device): int => $device->id, $devices));

        return $alert;
    }
}
