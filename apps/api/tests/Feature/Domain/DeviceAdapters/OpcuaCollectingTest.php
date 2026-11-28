<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\DeviceAdapters;

use App\Domain\DeviceAdapters\Models\AdapterConnection;
use App\Domain\DeviceAdapters\Models\DeviceAdapter;
use App\Domain\DeviceAdapters\Services\AdapterService;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as ClientRequest;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

/** Collecting from an OPC UA server (spec 038 PR 5, US4): deploying a reviewed map and what the runtime reports. */
final class OpcuaCollectingTest extends TestCase
{
    use RefreshDatabase;

    private const NS = 'urn:example:bms:example-tower';

    private Organization $organization;

    private string $prefix;

    /** @var list<array{path: string, body: array}> */
    private array $manager = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->organization = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->actingAs(User::where('is_super_admin', true)->firstOrFail(), 'sanctum');
        $this->prefix = '/api/v1/organizations/'.$this->organization->uuid;
        config(['adapters.enabled' => true, 'adapters.manager_url' => 'http://adapter-manager.test', 'adapters.manager_token' => str_repeat('m', 64), 'adapters.queue_connection' => 'sync',
            'devices.broker_admin_url' => 'http://broker-admin.test', 'devices.broker_admin_token' => 'test-token']);
        Http::fake(function (ClientRequest $request) {
            $path = parse_url($request->url(), PHP_URL_PATH);
            if (str_starts_with($request->url(), 'http://broker-admin.test')) {
                return Http::response(['ok' => true]);
            }
            $this->manager[] = ['path' => $path, 'body' => $request->data()];

            return Http::response(match ($path) {
                '/opcua/check' => ['valid' => true, 'problems' => [], 'totals' => ['devices' => 2, 'readings' => 1, 'points' => 2, 'rows_per_day' => 576], 'equipment' => []],
                '/deploy' => ['applied' => true, 'broker_url' => 'mqtts://localhost:19000', 'ca_certificate' => 'public-test-ca'],
                default => ['error' => 'unknown'],
            });
        });
    }

    private function connection(): AdapterConnection
    {
        $uuid = $this->postJson("{$this->prefix}/adapter-connections", ['name' => 'Example Tower BMS', 'endpoint_url' => 'opc.tcp://bms.example.com:4840', 'security_policy' => 'Basic256Sha256',
            'security_mode' => 'SignAndEncrypt', 'identity' => 'username', 'username' => 'operator', 'password' => 'placeholder-site-password'])->assertCreated()->json('data.uuid');
        $connection = AdapterConnection::where('uuid', $uuid)->firstOrFail();
        $connection->update(['server_certificate' => ['subject' => 'CN=BMS', 'fingerprint' => str_repeat('ab', 32), 'valid_from' => null, 'valid_to' => null, 'application_uri' => self::NS]]);

        return $connection->fresh();
    }

    private function equipment(string ...$path): array
    {
        return ['source_id' => implode('/', $path), 'display_name' => end($path), 'address' => ['namespace_uri' => self::NS, 'path' => array_map(fn ($name) => ['namespace_uri' => self::NS, 'name' => $name], $path)]];
    }

    /** A reviewed OPC UA data source, deployed through the API. */
    private function deployed(array $equipment = []): DeviceAdapter
    {
        $connection = $this->connection();
        $artifact = $this->postJson("{$this->prefix}/device-adapters/point-map/device-type", ['name' => 'Zone controller', 'readings' => [['key' => 'zone_temperature', 'name' => 'Zone temperature', 'data_type' => 'number', 'unit' => '°C']]])->assertOk()->json('data.artifact_uuid');
        $map = ['version' => 1, 'protocol' => 'opcua', 'rhythm_seconds' => 600,
            'readings' => [['key' => 'zone_temperature', 'name' => 'Zone temperature', 'data_type' => 'number', 'unit' => '°C', 'report' => ['sample_ms' => 10000, 'deadband' => ['kind' => 'none', 'value' => 0]], 'address' => ['relative_path' => [['namespace_uri' => self::NS, 'name' => 'zone_temperature']]]]],
            'equipment' => $equipment ?: [$this->equipment('Example Tower', 'L03', 'L03-VAV-2'), $this->equipment('Example Tower', 'L04', 'L04-VAV-2')]];
        $saved = $this->postJson("{$this->prefix}/device-adapters", ['request_uuid' => (string) Str::uuid(), 'name' => 'Zone controllers', 'artifact_uuid' => $artifact, 'source' => ['type' => 'opcua', 'connection_uuid' => $connection->uuid, 'point_map' => $map]])->assertCreated()->json('data');
        $base = "{$this->prefix}/device-adapters/{$saved['uuid']}";
        $this->postJson("{$base}/test", ['draft_revision' => $saved['draft_revision']])->assertOk()->assertJsonPath('data.valid', true);
        $this->postJson("{$base}/deploy", ['request_uuid' => (string) Str::uuid(), 'draft_revision' => $saved['draft_revision']])->assertAccepted();

        return DeviceAdapter::where('uuid', $saved['uuid'])->firstOrFail();
    }

    private function runtime(array $event)
    {
        $tenant = app(AdapterService::class)->tenant($this->organization);

        return $this->withHeaders(['X-Adapter-Tenant' => $tenant->uuid, 'Authorization' => 'Bearer '.$tenant->runtime_token])->postJson('/api/internal/adapters/events', $event);
    }

    public function test_a_reviewed_map_is_deployed_with_its_connection_and_secrets(): void
    {
        $adapter = $this->deployed();
        $this->assertSame('running', $adapter->status);
        $deploy = collect($this->manager)->where('path', '/deploy')->last()['body'];
        $source = $deploy['source'];
        $this->assertSame(['type', 'point_map', 'connection', 'secrets', 'private_ranges', 'platform_ranges'], array_keys($source));
        $this->assertSame('opc.tcp://bms.example.com:4840', $source['connection']['endpoint_url']);
        $this->assertSame(str_repeat('ab', 32), $source['connection']['server_fingerprint']);
        $this->assertSame('placeholder-site-password', $source['secrets']['password']);
        $this->assertSame(600, $source['point_map']['rhythm_seconds']);
        $this->assertSame('', $deploy['code']);
        // The rhythm is the poll interval of the automatic Offline after (T069).
        $this->assertSame(600, $adapter->pollIntervalSeconds());
        $checklist = collect($this->getJson("{$this->prefix}/device-adapters/{$adapter->uuid}")->assertOk()->json('data.checklist'))->keyBy('step');
        $this->assertSame(['done', 'Collecting'], [$checklist['deploy']['state'], $checklist['deploy']['detail']]);
    }

    public function test_a_paused_connection_is_not_collected_from(): void
    {
        $adapter = $this->deployed();
        AdapterConnection::whereKey($adapter->adapter_connection_id)->update(['state' => 'paused']);
        $revision = $adapter->revisions()->firstOrFail();
        $this->postJson("{$this->prefix}/device-adapters/{$adapter->uuid}/deploy", ['request_uuid' => (string) Str::uuid(), 'draft_revision' => $adapter->draft_revision, 'revision_uuid' => $revision->uuid])
            ->assertConflict()->assertJsonPath('message', 'The connection is paused. Resume it before collecting.');
    }

    public function test_the_runtime_reports_the_connection_its_refused_points_and_a_changed_certificate(): void
    {
        $adapter = $this->deployed();
        $connection = AdapterConnection::findOrFail($adapter->adapter_connection_id);
        $event = ['adapter_uuid' => $adapter->uuid, 'revision_uuid' => $adapter->applied_revision_uuid, 'connection_uuid' => $connection->uuid];
        $status = $event + ['kind' => 'connection_status', 'state' => 'connected', 'reason' => null, 'message' => null, 'fix' => null, 'since' => '2026-11-27T09:00:00Z',
            'security' => ['policy' => 'Basic256Sha256', 'mode' => 'SignAndEncrypt'], 'points_read' => 2, 'points_bad' => 1, 'values_last_minute' => 12, 'clock_difference_ms' => -40, 'limits' => ['MaxNodesPerRead' => 1000]];
        $this->runtime($status)->assertNoContent();
        $connection->refresh();
        $this->assertSame('connected', $connection->state);
        $this->assertSame([2, 1, 12], [$connection->status['points_read'], $connection->status['points_bad'], $connection->status['values_last_minute']]);
        $this->assertTrue($adapter->fresh()->health['source_connected']);

        $this->runtime([...$status, 'state' => 'unreachable', 'reason' => 'unreachable', 'message' => "The server's address could not be reached", 'fix' => 'Check the address and port'])->assertNoContent();
        $connection->refresh();
        $this->assertSame(['unreachable', 'unreachable', 'Check the address and port'], [$connection->state, $connection->status['reason'], $connection->status['fix']]);
        $this->assertSame('unreachable', $connection->status['problems'][0]['reason']);

        $refused = $event + ['kind' => 'refused_points', 'points' => [['source_id' => 'Example Tower/L04/L04-VAV-2', 'key' => 'zone_temperature', 'reason' => 'The point was not found on this equipment']], 'polled' => []];
        $this->runtime($refused)->assertNoContent();
        $first = $connection->fresh()->refused_points[0]['first_seen'];
        $this->travel(5)->minutes();
        $this->runtime($refused)->assertNoContent();
        $rows = $connection->fresh()->refused_points;
        $this->assertCount(1, $rows);
        $this->assertSame([$adapter->uuid, 'zone_temperature', $first, false], [$rows[0]['adapter_uuid'], $rows[0]['key'], $rows[0]['first_seen'], $rows[0]['polled']]);
        $this->assertNotSame($first, $rows[0]['last_seen']);

        $presented = ['subject' => 'CN=BMS renewed', 'fingerprint' => str_repeat('cd', 32), 'valid_from' => '2026-11-01T00:00:00Z', 'valid_to' => '2027-11-01T00:00:00Z', 'application_uri' => self::NS, 'der' => 'MIIB'];
        $this->runtime($event + ['kind' => 'server_certificate', 'presented' => $presented])->assertNoContent();
        $connection->refresh();
        $this->assertSame(['stopped', 'server_certificate_changed', str_repeat('cd', 32)], [$connection->state, $connection->status['reason'], $connection->pending_server_certificate['fingerprint']]);
        // Only accepting the new certificate resumes it, whatever the runtime says next.
        $this->runtime($status)->assertNoContent();
        $this->assertSame('stopped', $connection->fresh()->state);
        $this->getJson("{$this->prefix}/adapter-connections/{$connection->uuid}")->assertOk()->assertJsonPath('data.pending_server_certificate.subject', 'CN=BMS renewed')->assertJsonMissingPath('data.pending_server_certificate.der');

        // A diagnostic is the runtime's own words: there is no decoder to blame.
        $this->runtime(['adapter_uuid' => $adapter->uuid, 'kind' => 'diagnostic', 'message' => 'The point map could not be collected: BadTooManySessions'])->assertNoContent();
        $this->assertSame('The point map could not be collected: BadTooManySessions', $adapter->fresh()->diagnostic);

        // Another connection's events change nothing.
        $this->runtime(['connection_uuid' => (string) Str::uuid()] + $status)->assertNoContent();
        $this->runtime([...$status, 'state' => 'awaiting_trust'])->assertUnprocessable();
    }

    public function test_each_source_is_named_by_its_equipment_with_parents_until_unique(): void
    {
        $adapter = $this->deployed([
            $this->equipment('Example Tower', 'L03', 'Z2', 'VAV-2'),
            $this->equipment('Example Tower', 'L04', 'Z2', 'VAV-2'),
            $this->equipment('Example Tower', 'L04', 'Z3', 'VAV-2'),
            $this->equipment('Example Tower', 'L04', 'Z3', 'VAV-9'),
        ]);
        $this->assertSame([
            'Example Tower/L03/Z2/VAV-2' => 'L03 / Z2 / VAV-2',
            'Example Tower/L04/Z2/VAV-2' => 'L04 / Z2 / VAV-2',
            'Example Tower/L04/Z3/VAV-2' => 'Z3 / VAV-2',
            'Example Tower/L04/Z3/VAV-9' => 'VAV-9',
        ], AdapterService::sourceNames($adapter));
        $adapter->candidates()->create(['organization_id' => $this->organization->id, 'source_device_id' => 'Example Tower/L04/Z3/VAV-9', 'sparkplug_device_id' => 'src-'.substr(hash('sha256', 'Example Tower/L04/Z3/VAV-9'), 0, 32), 'preview' => [], 'last_seen_at' => now()]);
        $this->getJson("{$this->prefix}/device-adapters/{$adapter->uuid}/candidates")->assertOk()->assertJsonPath('data.0.name', 'VAV-9')->assertJsonPath('data.0.source_device_id', 'Example Tower/L04/Z3/VAV-9');
    }
}
