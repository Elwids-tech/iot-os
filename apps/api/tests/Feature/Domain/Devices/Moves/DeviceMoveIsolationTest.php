<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Devices\Moves;

use App\Domain\DeviceAdapters\Models\AdapterCandidate;
use App\Domain\DeviceAdapters\Models\AdapterCredential;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DiscoveryCandidate;
use App\Domain\Devices\Models\SparkplugConnection;
use App\Domain\Devices\Models\SparkplugGateway;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Str;

/**
 * The hosted-device crossing (spec 031 FR-060, SC-005, constitution III as amended by
 * ADR-039): within one billing account, members of only one side see nothing more than
 * ADR-039 lists, and organizations outside the account see nothing at all. A's routes
 * answer 403 to anyone who isn't a member, as they always have; reaching A's records
 * through one's own organization is 404.
 */
final class DeviceMoveIsolationTest extends MoveTestCase
{
    private Device $x;

    private Device $inB;

    private array $move;

    protected function setUp(): void
    {
        parent::setUp();
        $this->x = $this->adapterFed('WM-1001', 'Tracker X');
        $this->move = $this->moved($this->a, $this->b, [$this->x]);
        $this->inB = $this->successor($this->x);
        $this->applied($this->inB);
    }

    public function test_a_member_of_b_only_reaches_nothing_of_the_pipe(): void
    {
        $adapter = $this->adapter();
        $gateway = $adapter->gateway;
        $candidate = $this->inB->candidate;
        $physical = AdapterCandidate::where('source_device_id', 'WM-1001')->firstOrFail();
        $credential = AdapterCredential::create(['organization_id' => $this->a->id, 'device_adapter_id' => $adapter->id, 'name' => 'Field kit', 'username' => 'device-'.Str::uuid(), 'password' => Str::random(48), 'created_by' => $this->mover->id]);

        $this->actingAs($this->bOnly, 'sanctum');
        $b = $this->in($this->b);
        $theirs = $b.'/device-adapters/'.$adapter->uuid;
        foreach ([
            ['GET', $theirs], ['GET', $theirs.'/candidates'], ['GET', $theirs.'/credentials'], ['GET', $theirs.'/deliveries'], ['GET', $theirs.'/poll-runs'],
            ['GET', $theirs.'/webhook'], ['GET', $theirs.'/proposals'], ['POST', $theirs.'/credentials/'.$credential->uuid.'/kit'], ['POST', $theirs.'/deploy'],
            ['POST', $theirs.'/candidates/'.$physical->uuid.'/activate'],
            ['GET', $b.'/discovery-candidates/'.$candidate->uuid], ['PATCH', $b.'/discovery-candidates/'.$candidate->uuid],
            ['POST', $b.'/gateways/'.$gateway->uuid.'/provision'], ['POST', $b.'/gateways/'.$gateway->uuid.'/connection-settings'], ['POST', $b.'/gateways/'.$gateway->uuid.'/firmware-kit'],
        ] as [$method, $uri]) {
            $this->json($method, $uri, ['draft_revision' => 1, 'name' => 'Probe', 'target' => 'linux', 'status' => 'rejected', 'birth_revision' => 1])->assertNotFound();
        }
        // B's lists show nothing of A's pipe.
        $this->assertSame([], $this->getJson($b.'/device-adapters')->assertOk()->json('data'));
        $this->assertSame([], $this->getJson($b.'/gateways')->assertOk()->json('data'));
        $this->assertSame([], $this->getJson($b.'/discovery-candidates')->assertOk()->json('data'));
        // A capture of A's gateway is refused before the runtime is asked.
        $this->postJson($b.'/telemetry-captures', ['gateway_uuid' => $gateway->uuid, 'device_uuid' => $this->inB->uuid, 'duration_seconds' => 60])->assertNotFound();
        // A's own routes answer as they do for any non-member.
        $this->getJson($this->in($this->a).'/device-adapters/'.$adapter->uuid)->assertForbidden();
        $this->getJson($this->in($this->a).'/discovery-candidates')->assertForbidden();

        // What B sees of its device's pipe is the summary, and of its move only A's name.
        $device = $this->getJson($b.'/devices/'.$this->inB->uuid)->assertOk()->json('data');
        $this->assertSame(['kind', 'name', 'owner_organization_name', 'online', 'hosted'], array_keys($device['pipe']));
        $this->assertNull($device['candidate']['gateway']);
        $this->assertNull($device['candidate']['adapter']);
        $this->assertNull($device['candidate']['session_id']);
        $this->assertStringNotContainsString($adapter->uuid, json_encode($device));
        $this->assertStringNotContainsString($gateway->uuid, json_encode($device));
        $this->assertStringNotContainsString($this->a->uuid, json_encode($device));
        $listed = collect($this->getJson($b.'/devices')->assertOk()->json('data'))->firstWhere('uuid', $this->inB->uuid);
        $this->assertNull($listed['candidate']['gateway']);
        $move = $this->getJson($b.'/device-moves/'.$this->move['uuid'])->assertOk()->json('data');
        $this->assertSame(['uuid' => null, 'name' => 'Integrator'], $move['source']);
        $this->assertNull($move['devices'][0]['predecessor_uuid']);
        $this->assertSame($this->inB->uuid, $move['devices'][0]['successor_uuid']);
    }

    public function test_a_member_of_b_only_reaches_nothing_of_a_gateway_pipe(): void
    {
        $connection = SparkplugConnection::create(['organization_id' => $this->a->id, 'name' => 'Plant broker', 'group_id' => 'plant', 'host_id' => 'plant-host', 'username' => 'plant-'.Str::random(6), 'password' => 'test-secret', 'status' => 'ready']);
        $gateway = SparkplugGateway::create(['organization_id' => $this->a->id, 'sparkplug_connection_id' => $connection->id, 'name' => 'Line gateway', 'edge_node_id' => 'line-1',
            'username' => 'edge-'.Str::uuid(), 'password' => Str::random(48), 'presence' => 'online', 'runtime_seen_at' => now()]);
        $candidate = DiscoveryCandidate::create(['organization_id' => $this->a->id, 'sparkplug_gateway_id' => $gateway->id, 'source_device_id' => 'meter-1', 'birth_revision' => 1, 'metrics' => []]);
        $behind = $this->unsourced('Line meter');
        $behind->forceFill(['device_discovery_candidate_id' => $candidate->id, 'reserved_source_uuid' => $candidate->uuid])->save();
        $this->moved($this->a, $this->b, [$behind]);
        $hosted = $this->successor($behind);
        // B's own profile, so onboarding onto A's gateway fails on the gateway alone.
        Artisan::call('devices:prepare-water-meter-profile', ['--organization' => $this->b->slug]);
        $artifact = DeviceProfile::where('organization_id', $this->b->id)->firstOrFail()->artifacts()->firstOrFail()->uuid;

        $this->actingAs($this->bOnly, 'sanctum');
        $b = $this->in($this->b);
        foreach ([
            ['POST', $b.'/gateways/'.$gateway->uuid.'/provision'], ['POST', $b.'/gateways/'.$gateway->uuid.'/connection-settings'], ['POST', $b.'/gateways/'.$gateway->uuid.'/firmware-kit'],
            ['POST', $b.'/gateways/'.$gateway->uuid.'/bulk-onboardings'], ['POST', $b.'/sparkplug-connections/'.$connection->uuid.'/provision'],
            ['GET', $b.'/discovery-candidates/'.$candidate->uuid], ['PATCH', $b.'/discovery-candidates/'.$candidate->uuid],
            ['POST', $b.'/device-onboardings'], ['POST', $b.'/telemetry-captures'],
        ] as [$method, $uri]) {
            $this->json($method, $uri, ['request_uuid' => (string) Str::uuid(), 'name' => 'Probe', 'artifact_uuid' => $artifact, 'mode' => 'gateway', 'gateway_uuid' => $gateway->uuid,
                'source_device_id' => 'meter-9', 'device_uuid' => $hosted->uuid, 'duration_seconds' => 60, 'target' => 'linux', 'status' => 'rejected', 'birth_revision' => 1,
                'source_device_ids' => ['meter-9'], 'name_pattern' => '{device}'])->assertNotFound();
        }
        $this->assertSame([], $this->getJson($b.'/gateways')->assertOk()->json('data'));
        $this->assertSame([], $this->getJson($b.'/sparkplug-connections')->assertOk()->json('data'));
        $this->assertSame([], $this->getJson($b.'/discovery-candidates')->assertOk()->json('data'));
        // The hosted device has no connection settings or kit of its own: they are the gateway's.
        foreach (['/connection-settings', '/firmware-kit', '/connection-kit'] as $route) {
            $response = $this->postJson($b.'/devices/'.$hosted->uuid.$route, ['target' => 'linux']);
            $this->assertContains($response->status(), [404, 422], $route);
            $this->assertStringNotContainsString($gateway->password, $response->getContent());
            $this->assertStringNotContainsString($gateway->username, $response->getContent());
        }
        // A's own routes answer as they do for any non-member.
        $this->getJson($this->in($this->a).'/gateways')->assertForbidden();
        $this->getJson($this->in($this->a).'/sparkplug-connections')->assertForbidden();
        $this->postJson($this->in($this->a).'/gateways/'.$gateway->uuid.'/firmware-kit', ['target' => 'linux'])->assertForbidden();

        $device = $this->getJson($b.'/devices/'.$hosted->uuid)->assertOk()->json('data');
        $this->assertSame(['kind' => 'gateway', 'name' => 'Line gateway', 'owner_organization_name' => 'Integrator', 'online' => true, 'hosted' => true], $device['pipe']);
        foreach ([$gateway->uuid, $connection->uuid, 'plant-host', $this->a->uuid] as $secret) {
            $this->assertStringNotContainsString($secret, json_encode($device));
        }
    }

    public function test_a_hosted_devices_readings_keep_their_serial_but_not_the_pipe_owners_adapter_revision(): void
    {
        $y = $this->adapterFed('WM-1002', 'Tracker Y');

        $hosted = $this->as($this->bOnly, fn () => $this->getJson($this->in($this->b).'/devices/'.$this->inB->uuid.'/measurements/latest')->assertOk()->json('data.0'));
        $own = $this->getJson($this->in($this->a).'/devices/'.$y->uuid.'/measurements/latest')->assertOk()->json('data.0');

        $this->assertNull($hosted['adapter_revision_uuid']);
        $this->assertSame('WM-1001', $hosted['manufacturer_serial']);
        $this->assertSame('pipe-owner-revision', $own['adapter_revision_uuid']);
    }

    public function test_a_hosted_device_cannot_be_pointed_at_another_of_the_pipe_owners_sources(): void
    {
        $other = $this->adapterFed('WM-1002', 'Tracker Y');
        $this->actingAs($this->bOnly, 'sanctum');
        $device = $this->inB->fresh();

        $this->putJson($this->in($this->b).'/devices/'.$device->uuid.'/configuration', [...$device->draft, 'candidate_uuid' => $other->candidate->uuid, 'draft_revision' => $device->draft_revision])->assertNotFound();
        $fresh = $this->postJson($this->in($this->b).'/devices', ['name' => 'Probe', 'code' => 'probe'])->assertCreated()->json('data');
        $this->putJson($this->in($this->b).'/devices/'.$fresh['uuid'].'/configuration', [...$device->draft, 'candidate_uuid' => $device->candidate->uuid, 'draft_revision' => $fresh['draft_revision']])->assertNotFound();
        $this->assertSame($device->device_discovery_candidate_id, $device->fresh()->device_discovery_candidate_id);
    }

    public function test_a_member_of_a_only_sees_where_its_source_is_in_use_and_nothing_of_the_device(): void
    {
        $adapter = $this->adapter();
        $candidate = $this->inB->candidate;
        $this->actingAs($this->aOnly, 'sanctum');
        $a = $this->in($this->a);

        $this->getJson($a.'/devices/'.$this->inB->uuid)->assertNotFound();
        $this->getJson($a.'/devices/'.$this->inB->uuid.'/measurements/latest')->assertNotFound();
        $this->getJson($a.'/devices/'.$this->inB->uuid.'/measurements/history?'.http_build_query(['from' => now()->subDay()->toIso8601String(), 'to' => now()->toIso8601String(), 'parameter_uuid' => (string) Str::uuid()]))->assertNotFound();
        $this->getJson($this->in($this->b).'/devices/'.$this->inB->uuid)->assertForbidden();
        $this->assertNotContains($this->inB->uuid, array_column($this->getJson($a.'/devices?per_page=100')->json('data'), 'uuid'));

        $source = collect($this->getJson($a.'/device-adapters/'.$adapter->uuid.'/candidates')->assertOk()->json('data'))->firstWhere('source_device_id', 'WM-1001');
        $this->assertSame(['organization_name' => 'Harbour Shop'], $source['in_use_in']);
        $this->assertNull($source['device']);
        $this->assertNull($source['installation_uuid']);
        $discovered = $this->getJson($a.'/discovery-candidates/'.$candidate->uuid)->assertOk()->json('data');
        $this->assertSame(['organization_name' => 'Harbour Shop'], $discovered['in_use_in']);
        $this->assertNull($discovered['assigned_device_uuid']);
        $listed = collect($this->getJson($a.'/discovery-candidates')->assertOk()->json('data'))->firstWhere('uuid', $candidate->uuid);
        $this->assertSame(['organization_name' => 'Harbour Shop'], $listed['in_use_in']);
        $this->assertStringNotContainsString($this->inB->uuid, json_encode([$source, $discovered, $listed]));
        // Activating the source again names B and nothing of its device.
        $this->as($this->mover, fn () => $this->postJson($a.'/device-adapters/'.$adapter->uuid.'/candidates/'.AdapterCandidate::where('source_device_id', 'WM-1001')->value('uuid').'/activate', ['name' => 'Again'])
            ->assertConflict()->assertJsonPath('message', 'This source is in use in Harbour Shop.'));
        // The archived device and the move show A only B's name.
        $this->assertSame(['moved_to', 'Harbour Shop'], array_values(array_intersect_key($this->getJson($a.'/devices/'.$this->x->uuid)->json('data.link'), array_flip(['direction', 'organization_name']))));
        $move = $this->getJson($a.'/device-moves/'.$this->move['uuid'])->assertOk()->json('data');
        $this->assertSame(['uuid' => null, 'name' => 'Harbour Shop'], $move['target']);
        $this->assertSame([null, null, $this->x->uuid], [$move['devices'][0]['successor_uuid'], $move['devices'][0]['successor_state'], $move['devices'][0]['predecessor_uuid']]);
    }

    public function test_an_organization_outside_the_account_reaches_no_move(): void
    {
        $this->actingAs($this->cAdmin, 'sanctum');
        $c = $this->in($this->c);

        $this->getJson($c.'/device-moves/'.$this->move['uuid'])->assertNotFound();
        $this->getJson($c.'/device-moves/'.Str::uuid())->assertNotFound();
        $this->postJson($c.'/device-moves/preview', ['target_organization_uuid' => $this->a->uuid, 'device_uuids' => [$this->inB->uuid]])->assertNotFound();
        $this->postJson($c.'/device-moves', ['target_organization_uuid' => $this->b->uuid, 'device_uuids' => [$this->inB->uuid], 'operation_uuid' => (string) Str::uuid(), 'preview_hash' => str_repeat('a', 64)])->assertNotFound();
        $this->getJson($this->in($this->a).'/device-moves/'.$this->move['uuid'])->assertForbidden();
        $this->getJson($this->in($this->b).'/device-moves/'.$this->move['uuid'])->assertForbidden();
        $this->assertSame([], $this->getJson($c.'/device-move-targets')->json('data'));
        // A hosted source is never C's to hold, even by naming it.
        $probe = $this->postJson($c.'/devices', ['name' => 'Probe', 'code' => 'probe'])->assertCreated()->json('data');
        $this->putJson($c.'/devices/'.$probe['uuid'].'/configuration', [...$this->inB->draft, 'candidate_uuid' => $this->inB->candidate->uuid, 'draft_revision' => $probe['draft_revision']])->assertNotFound();
    }

    public function test_after_cutover_the_runtime_stores_the_source_only_for_b(): void
    {
        $state = $this->withToken(self::RUNTIME_TOKEN)->getJson('/api/internal/devices/state')->assertOk()->json();
        $this->flushHeaders();
        $candidate = DiscoveryCandidate::findOrFail($this->x->device_discovery_candidate_id);

        $holders = collect($state['devices'])->filter(fn (array $device) => ($device['desired']['source']['candidate_uuid'] ?? $device['applied']['source']['candidate_uuid'] ?? null) === $candidate->uuid);
        $this->assertSame([[$this->inB->uuid, $this->b->uuid]], $holders->map(fn (array $device) => [$device['uuid'], $device['organization_uuid']])->values()->all());
        $this->assertNotContains($this->x->uuid, array_column($state['devices'], 'uuid'));
    }
}
