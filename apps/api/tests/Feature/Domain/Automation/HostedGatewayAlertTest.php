<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Automation;

use App\Domain\Automation\Models\Alert;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DiscoveryCandidate;
use App\Domain\Devices\Models\SparkplugConnection;
use App\Domain\Devices\Models\SparkplugGateway;
use App\Domain\Shared\Models\Organization;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Feature\Domain\Devices\Moves\MoveTestCase;
use Tests\Support\AssertsContracts;

/**
 * Offline alerts follow ownership (spec 031 FR-026, research R14): A's gateway serves its
 * own meter Y and meter X, which moved to B. The runtime's owner episode is A's alert for
 * Y; the hosted episode, naming A as the pipe's organization, is B's alert for X, which
 * shows B the gateway's name only. An episode naming a pipe outside the billing account,
 * or devices the gateway doesn't serve, changes nothing.
 */
final class HostedGatewayAlertTest extends MoveTestCase
{
    use AssertsContracts;

    private const EVENT = 'device.connectivity.v1';

    private SparkplugGateway $gateway;

    private Device $x;

    private Device $y;

    protected function setUp(): void
    {
        parent::setUp();
        $connection = SparkplugConnection::create(['organization_id' => $this->a->id, 'name' => 'Plant broker', 'group_id' => 'plant', 'host_id' => 'plant-host', 'username' => 'plant-'.Str::random(6), 'password' => 'test-secret', 'status' => 'ready']);
        $this->gateway = SparkplugGateway::create(['organization_id' => $this->a->id, 'sparkplug_connection_id' => $connection->id, 'name' => 'Line gateway', 'edge_node_id' => 'line-1']);
        $this->y = $this->behind('meter-2', 'Meter Y');
        $moving = $this->behind('meter-1', 'Meter X');
        $this->moved($this->a, $this->b, [$moving]);
        $this->x = $this->successor($moving);
    }

    public function test_the_owner_episode_is_as_alert_and_the_hosted_episode_is_bs_naming_the_gateway_only(): void
    {
        $this->send($this->owner([$this->y]))->assertOk()->assertExactJson(['ok' => true]);
        $this->send($this->hosted($this->b, $this->a, [$this->x]))->assertOk()->assertExactJson(['ok' => true]);

        $theirs = Alert::where('organization_id', $this->a->id)->sole();
        $this->assertSame(['gateway:'.$this->gateway->connection->uuid.'/line-1#1', $this->gateway->id, [$this->y->id]], [$theirs->episode_key, $theirs->subject_gateway_id, $theirs->devices()->pluck('devices.id')->all()]);
        $hosted = Alert::where('organization_id', $this->b->id)->sole();
        $this->assertSame(['gateway:'.$this->gateway->connection->uuid.'/line-1@'.$this->b->uuid.'#1', Alert::GATEWAY_OFFLINE, [$this->x->id]], [$hosted->episode_key, $hosted->kind, $hosted->devices()->pluck('devices.id')->all()]);

        // A sees its own alert with its gateway; B's alert never reaches A's gateway or lists.
        $this->actingAs($this->aOnly, 'sanctum');
        $listed = $this->getJson($this->in($this->a).'/alerts')->assertOk()->json('data');
        $this->assertSame([$theirs->uuid], array_column($listed, 'uuid'));
        $this->assertSame(['type' => 'gateway', 'uuid' => $this->gateway->uuid, 'name' => 'Line gateway'], $listed[0]['subject']);
        $gateway = collect($this->getJson($this->in($this->a).'/gateways')->assertOk()->json('data'))->firstWhere('uuid', $this->gateway->uuid);
        $this->assertSame($theirs->uuid, $gateway['offline_alert']['uuid']);
        $this->getJson($this->in($this->a).'/alerts/'.$hosted->uuid)->assertNotFound();

        // B sees its alert for X with the pipe's name and nothing else of A's gateway.
        $this->actingAs($this->bOnly, 'sanctum');
        $listed = $this->getJson($this->in($this->b).'/alerts')->assertOk()->json('data');
        $this->assertSame([$hosted->uuid], array_column($listed, 'uuid'));
        $this->assertSame(['type' => 'gateway', 'uuid' => null, 'name' => 'Line gateway'], $listed[0]['subject']);
        $this->assertSame([$this->x->uuid], array_column($listed[0]['devices'], 'uuid'));
        $shown = $this->getJson($this->in($this->b).'/alerts/'.$hosted->uuid)->assertOk()->json('data');
        $device = $this->getJson($this->in($this->b).'/devices/'.$this->x->uuid)->assertOk()->json('data');
        $this->assertSame(['uuid' => $hosted->uuid, 'kind' => Alert::GATEWAY_OFFLINE, 'subject' => ['type' => 'gateway', 'uuid' => null, 'name' => 'Line gateway']], array_intersect_key($device['offline_alert'], array_flip(['uuid', 'kind', 'subject'])));
        $this->assertSame('offline', $device['presence']);
        $this->assertSame('Offline because gateway Line gateway is offline.', $device['diagnostic']);
        foreach ([$listed, $shown, $device, $this->getJson($this->in($this->b).'/devices')->json('data')] as $read) {
            $this->assertStringNotContainsString($this->gateway->uuid, json_encode($read));
            $this->assertStringNotContainsString($this->gateway->connection->uuid, json_encode($read));
            $this->assertStringNotContainsString($this->y->uuid, json_encode($read));
        }

        // Each episode clears in its own organization.
        $this->send($this->hosted($this->b, $this->a, [$this->x], 'cleared'))->assertOk();
        $this->assertNotNull($hosted->fresh()->cleared_at);
        $this->assertNull($theirs->fresh()->cleared_at);
    }

    public function test_a_pipe_outside_the_account_or_devices_the_gateway_does_not_serve_change_nothing(): void
    {
        $connection = SparkplugConnection::create(['organization_id' => $this->c->id, 'name' => 'Works broker', 'group_id' => 'works', 'host_id' => 'works-host', 'username' => 'works-'.Str::random(6), 'password' => 'test-secret', 'status' => 'ready']);
        $elsewhere = SparkplugGateway::create(['organization_id' => $this->c->id, 'sparkplug_connection_id' => $connection->id, 'name' => 'Works gateway', 'edge_node_id' => 'line-1']);
        $bOwn = $this->unsourced('Shelf sensor', $this->b);

        foreach ([
            // A forged pipe in another account, even naming its real gateway.
            $this->hosted($this->b, $this->c, [$this->x], gateway: $elsewhere),
            $this->hosted($this->b, $this->c, [$this->x]),
            // B's own device, which A's gateway doesn't serve.
            $this->hosted($this->b, $this->a, [$bOwn]),
            $this->hosted($this->b, $this->a, [$this->x, $bOwn]),
            // An organization can't be its own pipe, and A's device isn't B's.
            $this->hosted($this->b, $this->b, [$this->x]),
            $this->hosted($this->b, $this->a, [$this->y]),
            // C, outside the account, reaches neither A's gateway nor B's device.
            $this->hosted($this->c, $this->a, [$this->x]),
        ] as $payload) {
            $this->send($payload)->assertOk()->assertJsonPath('ignored', 'unknown_reference');
        }
        $this->assertSame(0, Alert::where('kind', Alert::GATEWAY_OFFLINE)->count());
    }

    /** A device of A behind the gateway, configured on its source and applied. */
    private function behind(string $source, string $name): Device
    {
        $artifact = DeviceProfile::where('organization_id', $this->a->id)->where('code', 'water-meter-onboarding-example')->firstOrFail()->artifacts()->firstOrFail();
        $candidate = DiscoveryCandidate::create(['organization_id' => $this->a->id, 'sparkplug_gateway_id' => $this->gateway->id, 'source_device_id' => $source, 'birth_revision' => 1,
            'presence' => 'online', 'session_id' => 'session-test', 'last_seen_at' => now(),
            'metrics' => [['name' => 'flow_rate', 'datatype' => 'Double', 'value' => 12], ['name' => 'total_volume', 'datatype' => 'Double', 'value' => 8400]]]);
        $device = $this->unsourced($name);
        $parameters = collect($artifact->definition['parameters'])->keyBy('key');
        $this->putJson($this->in($this->a).'/devices/'.$device->uuid.'/configuration', ['draft_revision' => $device->draft_revision, 'artifact_uuid' => $artifact->uuid, 'candidate_uuid' => $candidate->uuid, 'birth_revision' => 1,
            'mappings' => [['parameter_uuid' => $parameters['flow_rate']['uuid'], 'metric' => 'flow_rate'], ['parameter_uuid' => $parameters['total_volume']['uuid'], 'metric' => 'total_volume']]])->assertOk();
        $this->postJson($this->in($this->a).'/devices/'.$device->uuid.'/activate', ['draft_revision' => $device->fresh()->draft_revision])->assertAccepted();
        $this->applied($device);

        return $device->fresh();
    }

    /**
     * The gateway owner's episode for its own devices, as the runtime writes it.
     *
     * @param  list<Device>  $devices
     */
    private function owner(array $devices, string $transition = 'opened'): array
    {
        return $this->payload($this->a, $this->subject($this->gateway), $devices, $transition);
    }

    /**
     * A hosted organization's episode of a pipe's gateway.
     *
     * @param  list<Device>  $devices
     */
    private function hosted(Organization $organization, Organization $pipe, array $devices, string $transition = 'opened', ?SparkplugGateway $gateway = null): array
    {
        return $this->payload($organization, [...$this->subject($gateway ?? $this->gateway), 'pipe_organization_uuid' => $pipe->uuid], $devices, $transition);
    }

    private function subject(SparkplugGateway $gateway): array
    {
        return ['kind' => 'gateway', 'device_uuid' => null, 'connection_uuid' => $gateway->connection->uuid, 'edge_node_id' => $gateway->edge_node_id, 'adapter_uuid' => null];
    }

    /** @param list<Device> $devices */
    private function payload(Organization $organization, array $subject, array $devices, string $transition): array
    {
        return [
            'organization_uuid' => $organization->uuid, 'subject' => $subject, 'episode' => 1, 'transition' => $transition,
            'cause' => 'death_certificate', 'offline_since' => '2026-11-06T10:00:00Z', 'at' => $transition === 'opened' ? '2026-11-06T10:02:00Z' : '2026-11-06T10:30:00Z',
            'last_heard_at' => '2026-11-06T09:59:58Z', 'last_observed_at' => null,
            'offline_after_seconds' => 900, 'offline_after_automatic' => false, 'reporting_interval_seconds' => null, 'poll_interval_seconds' => null,
            'grace_seconds' => 120, 'settings_generation' => 0,
            'affected_device_uuids' => array_map(fn (Device $device): string => $device->uuid, $devices), 'stop_reason' => null,
        ];
    }

    private function send(array $payload): TestResponse
    {
        $envelope = ['uuid' => (string) Str::uuid(), 'type' => self::EVENT, 'payload' => $payload];
        // What these tests send is what the runtime may send.
        $this->assertProduced(self::EVENT, $envelope);

        return $this->runtimeEvent(self::EVENT, $payload);
    }
}
