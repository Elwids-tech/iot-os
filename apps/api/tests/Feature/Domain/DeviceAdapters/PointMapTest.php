<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\DeviceAdapters;

use App\Domain\DeviceAdapters\Models\AdapterConnection;
use App\Domain\DeviceAdapters\Models\AdapterRevision;
use App\Domain\DeviceAdapters\Models\DeviceAdapter;
use App\Domain\DeviceAdapters\Services\PointMaps;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as ClientRequest;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

/** Point maps on OPC UA data sources (spec 038 PR 4, US3). */
final class PointMapTest extends TestCase
{
    use RefreshDatabase;

    private const NS = 'urn:example:bms:example-tower';

    private Organization $organization;

    private string $prefix;

    /** @var list<array{path: string, body: array}> */
    private array $manager = [];

    /** @var array<string, array> */
    private array $answers = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->organization = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->actingAs(User::where('is_super_admin', true)->firstOrFail(), 'sanctum');
        $this->prefix = '/api/v1/organizations/'.$this->organization->uuid;
        config(['adapters.enabled' => true, 'adapters.manager_url' => 'http://adapter-manager.test', 'adapters.manager_token' => str_repeat('m', 64)]);
        $row = fn ($key, $value) => ['key' => $key, 'value' => $value, 'unit' => '°C', 'data_type' => 'number', 'quality' => 'good', 'status' => 'Good', 'reason' => null, 'source_time' => '2026-11-27T13:05:42.000Z', 'problem' => null];
        $this->answers = [
            '/opcua/check' => ['valid' => true, 'problems' => [], 'totals' => ['devices' => 2, 'readings' => 2, 'points' => 4, 'rows_per_day' => 1152],
                'equipment' => [['source_id' => 'Example Tower/L03-VAV-2', 'display_name' => 'L03-VAV-2', 'readings' => [$row('zone_temperature', 22.5), $row('temperature_setpoint', 21.0)]]]],
            '/opcua/similar' => ['matches' => [['source_id' => 'Example Tower/L03-VAV-7', 'display_name' => 'L03-VAV-7', 'address' => ['node_id' => 's=L03-VAV-7', 'namespace_uri' => self::NS, 'path' => [['namespace_uri' => self::NS, 'name' => 'L03-VAV-7']]], 'missing' => ['temperature_setpoint']]], 'truncated' => false],
            '/opcua/read' => ['points' => [
                ['node_id' => 's=L03-VAV-2.zone_temperature', 'namespace_uri' => self::NS, 'value' => 22.5, 'data_type' => 'number', 'unit' => '°C', 'range' => [10, 35], 'states' => null, 'status' => 'Good', 'quality' => 'good', 'reason' => null, 'source_time' => null, 'storable' => true, 'not_storable' => null],
                ['node_id' => 's=L03-VAV-2.occupied', 'namespace_uri' => self::NS, 'value' => true, 'data_type' => 'boolean', 'unit' => null, 'range' => null, 'states' => ['Vacant', 'Occupied'], 'status' => 'Good', 'quality' => 'good', 'reason' => null, 'source_time' => null, 'storable' => true, 'not_storable' => null],
                ['node_id' => 's=L03-VAV-2.schedule', 'namespace_uri' => self::NS, 'value' => null, 'data_type' => null, 'unit' => null, 'range' => null, 'states' => null, 'status' => 'Good', 'quality' => 'good', 'reason' => null, 'source_time' => null, 'storable' => false, 'not_storable' => 'A structure cannot be stored as a reading'],
            ]],
        ];
        Http::fake(function (ClientRequest $request) {
            $path = parse_url($request->url(), PHP_URL_PATH);
            $this->manager[] = ['path' => $path, 'body' => $request->data()];

            return Http::response($this->answers[$path] ?? ['error' => 'unknown'], isset($this->answers[$path]) ? 200 : 422);
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

    private function deviceType(): string
    {
        return $this->postJson("{$this->prefix}/device-adapters/point-map/device-type", ['name' => 'Zone controller', 'readings' => [
            ['key' => 'zone_temperature', 'name' => 'Zone temperature', 'data_type' => 'number', 'unit' => '°C'],
            ['key' => 'temperature_setpoint', 'name' => 'Temperature setpoint', 'data_type' => 'number', 'unit' => '°C'],
            ['key' => 'occupied', 'name' => 'Occupied', 'data_type' => 'boolean'],
        ]])->assertOk()->json('data.artifact_uuid');
    }

    private function reading(string $key): array
    {
        return ['key' => $key, 'name' => Str::headline($key), 'data_type' => 'number', 'unit' => '°C', 'report' => ['sample_ms' => 10000, 'deadband' => ['kind' => 'none', 'value' => 0]],
            'address' => ['relative_path' => [['namespace_uri' => self::NS, 'name' => $key]]]];
    }

    private function equipment(string $name): array
    {
        return ['source_id' => "Example Tower/{$name}", 'display_name' => $name, 'address' => ['node_id' => "s={$name}", 'namespace_uri' => self::NS, 'path' => [['namespace_uri' => self::NS, 'name' => 'Example Tower'], ['namespace_uri' => self::NS, 'name' => $name]]]];
    }

    private function map(array $change = []): array
    {
        return array_replace(['version' => 1, 'protocol' => 'opcua', 'rhythm_seconds' => 300, 'readings' => [$this->reading('zone_temperature'), $this->reading('temperature_setpoint')],
            'equipment' => [$this->equipment('L03-VAV-2'), $this->equipment('L03-VAV-7')]], $change);
    }

    private function body(string $connection, string $artifact, array $map, array $change = []): array
    {
        return array_replace(['request_uuid' => (string) Str::uuid(), 'name' => 'Zone controllers', 'artifact_uuid' => $artifact, 'source' => ['type' => 'opcua', 'connection_uuid' => $connection, 'point_map' => $map]], $change);
    }

    public function test_a_device_type_is_made_from_readings_and_published(): void
    {
        $artifact = $this->deviceType();
        $definition = DB::table('device_profile_artifacts')->where('uuid', $artifact)->value('definition');
        $parameters = collect(json_decode($definition, true)['parameters'])->keyBy('key');
        $this->assertSame(['measurement', 'number', '°C'], [$parameters['zone_temperature']['kind'], $parameters['zone_temperature']['data_type'], $parameters['zone_temperature']['unit']]);
        $this->assertSame(['state', 'boolean'], [$parameters['occupied']['kind'], $parameters['occupied']['data_type']]);
        $this->postJson("{$this->prefix}/device-adapters/point-map/device-type", ['name' => 'Zone controller', 'readings' => [['key' => 'a', 'name' => 'A', 'data_type' => 'number'], ['key' => 'a', 'name' => 'B', 'data_type' => 'number']]])
            ->assertUnprocessable()->assertJsonValidationErrors('readings.1.key');
        $second = $this->postJson("{$this->prefix}/device-adapters/point-map/device-type", ['name' => 'Zone controller', 'readings' => [['key' => 'zone_temperature', 'name' => 'Zone temperature', 'data_type' => 'number', 'unit' => '°C']]])->assertOk();
        $this->assertNotSame($artifact, $second->json('data.artifact_uuid'));
    }

    public function test_a_point_map_is_checked_against_the_contract_its_rules_and_the_profile(): void
    {
        $connection = $this->connection()->uuid;
        $artifact = $this->deviceType();
        $adapters = "{$this->prefix}/device-adapters";
        $this->postJson($adapters, $this->body($connection, $artifact, $this->map(['rhythm_seconds' => 10])))->assertUnprocessable()->assertJsonValidationErrors('source.point_map.rhythm_seconds');
        $this->postJson($adapters, $this->body($connection, $artifact, $this->map(['readings' => [$this->reading('zone_temperature'), $this->reading('zone_temperature')]])))
            ->assertUnprocessable()->assertJsonValidationErrors('source.point_map.readings.1.key');
        $this->postJson($adapters, $this->body($connection, $artifact, $this->map(['readings' => [$this->reading('supply_flow')]])))
            ->assertUnprocessable()->assertJsonPath('errors', ['source.point_map.readings.0.key' => ['The device type has no reading called supply_flow.']]);
        $this->postJson($adapters, $this->body((string) Str::uuid(), $artifact, $this->map()))->assertUnprocessable()->assertJsonValidationErrors('source.connection_uuid');
        $this->postJson($adapters, $this->body($connection, $artifact, $this->map(), ['code' => 'function decode() {}']))->assertUnprocessable()->assertJsonValidationErrors('code');
        $this->assertSame(0, DeviceAdapter::count());
    }

    public function test_the_rules_match_the_contract_cases(): void
    {
        $cases = json_decode(file_get_contents(base_path('../../contracts/pointmaps/v1/point-map.v1.rules.json')), true);
        foreach ($cases as $case) {
            $this->assertSame($case['problems'], PointMaps::problems($case['data']), $case['description']);
        }
    }

    public function test_a_saved_map_carries_its_connection_and_secrets_in_the_revision_only(): void
    {
        $connection = $this->connection();
        $saved = $this->postJson("{$this->prefix}/device-adapters", $this->body($connection->uuid, $this->deviceType(), $this->map()))->assertCreated()->json('data');
        $this->assertSame('opcua', $saved['source']['type']);
        $this->assertSame($connection->uuid, $saved['source']['connection_uuid']);
        $this->assertSame('', $saved['code']);
        $this->assertStringNotContainsString('placeholder-site-password', json_encode($saved));
        $adapter = DeviceAdapter::where('uuid', $saved['uuid'])->firstOrFail();
        $this->assertSame($connection->id, $adapter->adapter_connection_id);
        $this->assertSame([], $adapter->secrets);
        $revision = AdapterRevision::where('device_adapter_id', $adapter->id)->firstOrFail();
        $this->assertSame($this->map()['equipment'], $revision->definition['source']['point_map']['equipment']);
        $this->assertSame(str_repeat('ab', 32), $revision->definition['connection']['server_fingerprint']);
        $this->assertSame('placeholder-site-password', $revision->secret_snapshot['password']);
        $this->assertArrayNotHasKey('password', $revision->definition['connection']);
        $this->deleteJson("{$this->prefix}/adapter-connections/{$connection->uuid}")->assertConflict();
    }

    public function test_the_point_limit_counts_every_opc_ua_data_source(): void
    {
        config(['adapters.opcua.max_points' => 5]);
        $connection = $this->connection()->uuid;
        $artifact = $this->deviceType();
        $this->postJson("{$this->prefix}/device-adapters", $this->body($connection, $artifact, $this->map()))->assertCreated();
        $missing = $this->equipment('L03-VAV-9') + ['missing' => ['temperature_setpoint']];
        $this->postJson("{$this->prefix}/device-adapters", $this->body($connection, $artifact, $this->map(['equipment' => [$missing]]), ['name' => 'More']))->assertCreated();
        $this->postJson("{$this->prefix}/device-adapters", $this->body($connection, $artifact, $this->map(['equipment' => [$this->equipment('L04-VAV-1')]]), ['name' => 'Too many']))
            ->assertUnprocessable()->assertJsonPath('message', "This map reads 2 points; with the 5 other data sources read, that is 2 over this organization's limit of 5.");
    }

    public function test_the_review_check_gates_deployment_of_that_exact_revision(): void
    {
        $connection = $this->connection()->uuid;
        $artifact = $this->deviceType();
        $saved = $this->postJson("{$this->prefix}/device-adapters", $this->body($connection, $artifact, $this->map()))->assertCreated()->json('data');
        $base = "{$this->prefix}/device-adapters/{$saved['uuid']}";
        $this->postJson("{$base}/deploy", ['request_uuid' => (string) Str::uuid(), 'draft_revision' => $saved['draft_revision']])->assertUnprocessable()->assertJsonPath('message', 'Test this exact revision before deployment.');

        $this->answers['/opcua/check'] = ['valid' => false, 'equipment' => [], 'totals' => ['devices' => 2, 'readings' => 2, 'points' => 4, 'rows_per_day' => 1152],
            'problems' => [['source_id' => 'Example Tower/L03-VAV-7', 'key' => 'temperature_setpoint', 'problem' => 'Not found on this equipment']]];
        $failed = $this->postJson("{$base}/test", ['draft_revision' => $saved['draft_revision']])->assertOk()->json('data');
        $this->assertFalse($failed['valid']);
        $this->assertSame(['max' => 10000, 'used' => 0, 'adding' => 4, 'over' => 0], $failed['limit']);
        $this->assertSame($this->map(), $this->last('/opcua/check')['point_map']);
        $this->assertSame('placeholder-site-password', $this->last('/opcua/check')['secrets']['password']);
        $this->postJson("{$base}/deploy", ['request_uuid' => (string) Str::uuid(), 'draft_revision' => $saved['draft_revision']])->assertUnprocessable();

        $this->answers['/opcua/check']['valid'] = true;
        $this->answers['/opcua/check']['problems'] = [];
        $passed = $this->postJson("{$base}/test", ['draft_revision' => $saved['draft_revision']])->assertOk()->json('data');
        $this->assertTrue($passed['valid']);
        $checklist = collect($this->getJson($base)->assertOk()->assertJsonPath('data.revision.test_result.valid', true)->json('data.checklist'))->keyBy('step');
        $this->assertSame(['done', '2 readings from 2 devices'], [$checklist['samples']['state'], $checklist['samples']['detail']]);
        $this->assertSame(['done', 'Review passed'], [$checklist['decoder']['state'], $checklist['decoder']['detail']]);
        $this->assertSame('todo', $checklist['connect']['state']);
        // Collecting is the next pull request; until then the reviewed map stays saved.
        $this->postJson("{$base}/deploy", ['request_uuid' => (string) Str::uuid(), 'draft_revision' => $saved['draft_revision']])->assertUnprocessable()
            ->assertJsonPath('message', 'Collecting from an OPC UA server arrives in the next release; the reviewed point map is saved.');

        // Any change needs the check again.
        $changed = $this->putJson($base, $this->body($connection, $artifact, $this->map(['rhythm_seconds' => 600]), ['draft_revision' => $saved['draft_revision']]))->assertOk()->json('data');
        $this->assertNull($changed['revision']['test_result']);
    }

    public function test_a_deployed_revision_never_changes(): void
    {
        $connection = $this->connection()->uuid;
        $artifact = $this->deviceType();
        $saved = $this->postJson("{$this->prefix}/device-adapters", $this->body($connection, $artifact, $this->map()))->assertCreated()->json('data');
        $adapter = DeviceAdapter::where('uuid', $saved['uuid'])->firstOrFail();
        $first = AdapterRevision::where('device_adapter_id', $adapter->id)->firstOrFail();
        $adapter->update(['applied_revision_uuid' => $first->uuid]);
        $this->putJson("{$this->prefix}/device-adapters/{$saved['uuid']}", $this->body($connection, $artifact, $this->map(['equipment' => [$this->equipment('L03-VAV-2')]]), ['draft_revision' => $saved['draft_revision']]))->assertOk();
        $this->assertSame($first->content_hash, $first->fresh()->content_hash);
        $this->assertCount(2, $first->fresh()->definition['source']['point_map']['equipment']);
        $this->assertSame(2, AdapterRevision::where('device_adapter_id', $adapter->id)->count());
    }

    public function test_readings_are_suggested_from_the_server_and_unstorable_points_refused(): void
    {
        $connection = $this->connection()->uuid;
        $node = fn ($id) => 'nsu='.self::NS.";s={$id}";
        $result = $this->postJson("{$this->prefix}/adapter-connections/{$connection}/point-map/suggest", ['points' => [
            ['node' => $node('L03-VAV-2.zone_temperature'), 'name' => 'zone_temperature', 'display_name' => 'Zone temperature'],
            ['node' => $node('L03-VAV-2.occupied'), 'name' => 'Occupied'],
            ['node' => $node('L03-VAV-2.schedule'), 'name' => 'schedule'],
        ]])->assertOk()->json('data');
        $this->assertSame([
            ['key' => 'zone_temperature', 'name' => 'Zone temperature', 'data_type' => 'number', 'unit' => '°C', 'range' => [10, 35], 'report' => ['sample_ms' => 10000, 'deadband' => ['kind' => 'percent', 'value' => 0.5]]],
            ['key' => 'occupied', 'name' => 'Occupied', 'data_type' => 'boolean', 'unit' => null, 'report' => ['sample_ms' => 10000, 'deadband' => ['kind' => 'none', 'value' => 0]]],
        ], $result['readings']);
        $this->assertSame([['node' => $node('L03-VAV-2.schedule'), 'name' => 'schedule', 'reason' => 'A structure cannot be stored as a reading']], $result['refused']);
        // A vendor tag in capitals becomes a readable key.
        $flat = app(PointMaps::class)->suggest([['name' => 'ZN-T', 'data_type' => 'number', 'unit' => '°C'], ['name' => 'DMP-POS', 'data_type' => 'number', 'unit' => '%'], ['name' => 'ZoneTemperature', 'data_type' => 'number', 'unit' => '°C']]);
        $this->assertSame(['zn_t', 'dmp_pos', 'zone_temperature'], array_column($flat, 'key'));
    }

    public function test_similar_equipment_passes_through_with_what_it_lacks(): void
    {
        $connection = $this->connection()->uuid;
        $found = $this->postJson("{$this->prefix}/adapter-connections/{$connection}/nodes/similar", [
            'equipment' => ['node' => 'nsu='.self::NS.';s=L03-VAV-2', 'path' => [['namespace_uri' => self::NS, 'name' => 'L03-VAV-2']]],
            'points' => [['key' => 'zone_temperature', 'name' => 'zone_temperature'], ['key' => 'temperature_setpoint', 'name' => 'temperature_setpoint']], 'by' => 'type',
        ])->assertOk()->json('data');
        $this->assertSame(['temperature_setpoint'], $found['matches'][0]['missing']);
        $this->assertSame(['node_id' => 's=L03-VAV-2', 'namespace_uri' => self::NS, 'path' => [['namespace_uri' => self::NS, 'name' => 'L03-VAV-2']]], $this->last('/opcua/similar')['equipment']);
        $this->postJson("{$this->prefix}/adapter-connections/{$connection}/nodes/similar", ['equipment' => ['path' => [['namespace_uri' => self::NS, 'name' => 'ET_L03_VAV_2']]], 'points' => [['key' => 'zone_temperature']], 'by' => 'pattern'])
            ->assertUnprocessable()->assertJsonValidationErrors('points.0.pattern');
    }

    public function test_another_organization_cannot_use_the_connection_or_see_the_map(): void
    {
        $connection = $this->connection()->uuid;
        $saved = $this->postJson("{$this->prefix}/device-adapters", $this->body($connection, $this->deviceType(), $this->map()))->assertCreated()->json('data');
        $other = Organization::where('id', '!=', $this->organization->id)->firstOrFail();
        $base = "/api/v1/organizations/{$other->uuid}";
        $this->getJson("{$base}/device-adapters/{$saved['uuid']}")->assertNotFound();
        $this->postJson("{$base}/device-adapters/{$saved['uuid']}/test", ['draft_revision' => 1])->assertNotFound();
        $this->postJson("{$base}/adapter-connections/{$connection}/nodes/similar", ['equipment' => ['path' => [['namespace_uri' => self::NS, 'name' => 'x']]], 'points' => [['key' => 'a', 'name' => 'a']], 'by' => 'type'])->assertNotFound();
        $this->postJson("{$base}/adapter-connections/{$connection}/point-map/suggest", ['points' => [['node' => 'nsu=urn:x;i=1', 'name' => 'a']]])->assertNotFound();
        $otherArtifact = DB::table('device_profile_artifacts')->join('device_profiles', 'device_profiles.id', '=', 'device_profile_artifacts.device_profile_id')
            ->where('device_profiles.organization_id', $other->id)->value('device_profile_artifacts.uuid');
        if ($otherArtifact) {
            $this->postJson("{$base}/device-adapters", $this->body($connection, $otherArtifact, $this->map()))->assertUnprocessable()->assertJsonValidationErrors('source.connection_uuid');
        }
        $this->assertSame([], array_filter($this->manager, fn ($c) => str_contains(json_encode($c['body']), (string) $other->uuid)));
    }

    private function last(string $path): array
    {
        $calls = array_values(array_filter($this->manager, fn ($call) => $call['path'] === $path));

        return end($calls)['body'];
    }
}
