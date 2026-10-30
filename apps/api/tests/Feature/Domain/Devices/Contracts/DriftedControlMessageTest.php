<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Devices\Contracts;

use App\Domain\DeviceAdapters\Models\AdapterCandidate;
use App\Domain\DeviceAdapters\Models\DeviceAdapter;
use App\Domain\DeviceAdapters\Models\DeviceInstallation;
use App\Domain\DeviceAdapters\Services\AdapterService;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\DeviceProfiles\Support\CanonicalJson;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DiscoveryCandidate;
use App\Domain\Devices\Models\SparkplugConnection;
use App\Domain\Devices\Models\SparkplugGateway;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Database\Seeders\GpsUseCaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Support\AssertsContracts;
use Tests\TestCase;

/**
 * Producer conformance for the control messages whose contracts spec 002 PR 3
 * corrected (FR-022, SC-007): device.activate.v1 written by configure, rollback and
 * resume, the device.command.v1 payload with and without a source session, and the
 * adapter binding in a device-configuration.v2 definition. Each outbox row is read
 * the way the runtime receives it, from POST /api/internal/devices/outbox/claim.
 */
final class DriftedControlMessageTest extends TestCase
{
    use AssertsContracts;
    use RefreshDatabase;

    private const ACTIVATION = 'devices/v1/activation.schema.json';

    private const COMMAND = 'devices/v1/command.schema.json';

    private const CONFIGURATION_V2 = 'devices/v2/configuration.schema.json';

    private const RUNTIME_TOKEN = 'drifted-control-message-runtime-token-0000';

    private Organization $organization;

    private string $prefix;

    /** The source session the runtime's command check reports; null when it reports none. */
    private ?string $session = 'session-test';

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->organization = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->actingAs(User::where('email', 'super-admin@example.test')->firstOrFail(), 'sanctum');
        $this->prefix = '/api/v1/organizations/'.$this->organization->uuid;
        config(['devices.runtime_token' => self::RUNTIME_TOKEN, 'devices.runtime_url' => 'http://runtime:8081',
            'devices.broker_admin_token' => 'test-token', 'adapters.enabled' => true,
            'adapters.manager_url' => 'http://adapter-manager.test', 'adapters.manager_token' => str_repeat('m', 64)]);
        Http::fake(function (Request $request) {
            if (str_starts_with($request->url(), 'http://runtime:8081/')) {
                return Http::response(['valid' => true, 'already_at_target' => false, ...($this->session === null ? [] : ['session_id' => $this->session])]);
            }
            if (str_ends_with($request->url(), '/test')) {
                return Http::response(['valid' => true, 'results' => [['passed' => true, 'output' => ['sourceDeviceId' => 'WM-1042', 'metrics' => [['name' => 'flow_rate', 'value' => 12], ['name' => 'total_volume', 'value' => 8400]]]]]]);
            }

            return Http::response(['applied' => true, 'connected' => true, 'broker_url' => 'mqtts://localhost:19000', 'ca_certificate' => 'public-test-ca']);
        });
        Queue::fake();
    }

    public function test_activation_rows_from_configure_rollback_and_resume_conform(): void
    {
        $device = $this->configured('three-phase-energy-meter', 'meter-drift');
        $path = $this->prefix.'/devices/'.$device->uuid;

        $this->postJson($path.'/activate', ['draft_revision' => $device->draft_revision])->assertAccepted();
        $configure = $this->claimed('device.activate.v1', $device);
        $this->assertActivationConforms($configure, 'configure');
        $first = $this->applied($device);

        $this->postJson($path.'/activate', ['draft_revision' => $device->fresh()->draft_revision, 'rollback_configuration_uuid' => $first])->assertAccepted();
        $this->assertActivationConforms($this->claimed('device.activate.v1', $device), 'rollback');
        $this->applied($device);

        $device->refresh();
        $operation = (string) Str::uuid();
        $this->postJson($path.'/lifecycle', ['operation_uuid' => $operation, 'target_state' => 'inactive', 'expected_generation' => $device->deployment_generation])->assertAccepted();
        $this->claimed('device.deactivate.v1', $device);
        $this->runtimeEvent('device.deactivated.v1', ['organization_uuid' => $this->organization->uuid, 'device_uuid' => $device->uuid,
            'generation' => $device->fresh()->deployment_generation, 'operation_uuid' => $operation, 'uncertain_command_uuids' => []])->assertOk();
        $this->assertNull($device->fresh()->applied_generation);
        $this->postJson($path.'/lifecycle', ['operation_uuid' => (string) Str::uuid(), 'target_state' => 'active', 'expected_generation' => $device->fresh()->deployment_generation])->assertAccepted();
        $this->assertActivationConforms($this->claimed('device.activate.v1', $device), 'resume');
    }

    /**
     * The GPS demo trackers' stored configurations predate conversion modes; resuming
     * one (as devices:activate-staging does) sends that definition unchanged.
     */
    public function test_resuming_a_gps_demo_tracker_conforms(): void
    {
        $this->seed(GpsUseCaseSeeder::class);
        $device = Device::where('code', GpsUseCaseSeeder::DEVICE_CODE)->firstOrFail();
        $this->postJson($this->prefix.'/devices/'.$device->uuid.'/lifecycle', ['operation_uuid' => (string) Str::uuid(), 'target_state' => 'active', 'expected_generation' => 0])->assertAccepted();

        $activation = $this->claimed('device.activate.v1', $device);
        $this->assertObjectNotHasProperty('conversion_mode', $activation->payload->definition->mappings[0]);
        $this->assertProduced(self::CONFIGURATION_V2, $activation->payload->definition, 'GPS demo tracker definition');
        $this->assertActivationConforms($activation, 'GPS demo tracker resume');
    }

    public function test_command_payloads_with_and_without_a_source_session_conform(): void
    {
        $device = $this->configured('rgb-light', 'light-drift');
        $this->postJson($this->prefix.'/devices/'.$device->uuid.'/activate', ['draft_revision' => $device->draft_revision])->assertAccepted();
        $this->claimed('device.activate.v1', $device);
        $this->applied($device);
        $device->refresh();
        $commands = $this->prefix.'/devices/'.$device->uuid.'/commands';
        $request = ['configuration_uuid' => $device->applied_configuration_uuid, 'parameter_uuid' => '10000000-0000-4000-8000-000000000004', 'value' => 8];

        $prepared = $this->postJson($commands, [...$request, 'idempotency_key' => (string) Str::uuid()])->assertCreated()->json('data.uuid');
        $this->postJson($commands.'/'.$prepared.'/confirm', ['confirmed' => true])->assertOk()->assertJsonPath('data.status', 'pending');
        $withSession = $this->claimed('device.command.v1', $device);
        $this->assertSame('session-test', $withSession->payload->session_id);
        $this->assertSame($device->deployment_generation, $withSession->payload->generation);
        $this->assertProduced(self::COMMAND, $withSession->payload, 'command confirmed with a source session');
        $this->runtimeEvent('command.status.v1', ['organization_uuid' => $this->organization->uuid, 'device_uuid' => $device->uuid, 'command_uuid' => $prepared, 'status' => 'observed'])->assertOk();

        $this->session = null;
        $this->postJson($commands.'/send', [...$request, 'value' => 9, 'idempotency_key' => (string) Str::uuid()])->assertCreated()->assertJsonPath('data.status', 'pending');
        $withoutSession = $this->claimed('device.command.v1', $device);
        $this->assertNull($withoutSession->payload->session_id);
        $this->assertProduced(self::COMMAND, $withoutSession->payload, 'command confirmed without a source session');
    }

    public function test_an_adapter_backed_definition_conforms_to_configuration_v2(): void
    {
        [$adapter, $candidate] = $this->liveAdapterCandidate();
        $installation = $this->postJson($this->prefix.'/device-adapters/'.$adapter->uuid.'/candidates/'.$candidate->uuid.'/activate', ['name' => 'Workshop water meter'])
            ->assertAccepted()->json('data.installation_uuid');
        $device = DeviceInstallation::where('uuid', $installation)->firstOrFail()->device;

        $activation = $this->claimed('device.activate.v1', $device);
        $this->assertSame($installation, $activation->payload->definition->adapter->installation_uuid);
        $this->assertProduced(self::CONFIGURATION_V2, $activation->payload->definition, 'adapter-backed definition in the activation');
        $this->assertProduced(self::CONFIGURATION_V2, $device->configurations()->firstOrFail()->definition, 'adapter-backed stored configuration');
        $this->assertActivationConforms($activation, 'adapter activation');
    }

    /**
     * The platform's adapter announces an adapter-fed source, so its activation carries
     * the names and datatypes of the source's stored birth, in the outbox message and in
     * the state snapshot while it is pending. A native device's does not (ADR-027).
     */
    public function test_an_adapter_fed_activation_carries_its_stored_birth(): void
    {
        [$adapter, $candidate] = $this->liveAdapterCandidate();
        $installation = $this->postJson($this->prefix.'/device-adapters/'.$adapter->uuid.'/candidates/'.$candidate->uuid.'/activate', ['name' => 'Workshop water meter'])
            ->assertAccepted()->json('data.installation_uuid');
        $device = DeviceInstallation::where('uuid', $installation)->firstOrFail()->device;
        $birth = [['name' => 'flow_rate', 'datatype' => 'Double'], ['name' => 'total_volume', 'datatype' => 'Double']];
        $state = fn (): array => collect($this->withToken(self::RUNTIME_TOKEN)->getJson('/api/internal/devices/state')->assertOk()->json('devices'))->firstWhere('uuid', $device->uuid);

        $activation = $this->claimed('device.activate.v1', $device);
        $this->assertSame($birth, json_decode((string) json_encode($activation->payload->birth_metrics), true));
        $this->assertActivationConforms($activation, 'adapter activation with a stored birth');
        $this->assertSame($birth, $state()['birth_metrics']);
        $this->applied($device);
        $this->assertArrayNotHasKey('birth_metrics', $state());

        $native = $this->configured('three-phase-energy-meter', 'meter-native');
        $this->postJson($this->prefix.'/devices/'.$native->uuid.'/activate', ['draft_revision' => $native->draft_revision])->assertAccepted();
        $this->assertObjectNotHasProperty('birth_metrics', $this->claimed('device.activate.v1', $native)->payload);
    }

    private function assertActivationConforms(object $message, string $producer): void
    {
        $this->assertNotEmpty($message->lease_token, $producer);
        foreach (['organization_uuid', 'device_uuid', 'operation_uuid', 'generation', 'definition'] as $field) {
            $this->assertObjectHasProperty($field, $message->payload, "{$producer}: {$field}");
        }
        $this->assertProduced(self::ACTIVATION, $message, "device.activate.v1 written by {$producer}");
    }

    /**
     * The one control message of a type for a device written since the last claim,
     * as the runtime receives it.
     */
    private function claimed(string $type, Device $device): object
    {
        $rows = json_decode((string) $this->withToken(self::RUNTIME_TOKEN)->postJson('/api/internal/devices/outbox/claim', [])->assertOk()->getContent(), false, 512, JSON_THROW_ON_ERROR)->data;
        $matching = array_values(array_filter($rows, fn (object $row): bool => $row->type === $type && ($row->payload->device_uuid ?? null) === $device->uuid));
        $this->assertCount(1, $matching, "one {$type} row for the device");

        return $matching[0];
    }

    /** Confirms the pending activation as the runtime would and returns the applied configuration. */
    private function applied(Device $device): string
    {
        $device->refresh();
        $this->runtimeEvent('device.applied.v1', ['organization_uuid' => $this->organization->uuid, 'device_uuid' => $device->uuid, 'generation' => $device->deployment_generation,
            'configuration_uuid' => $device->desired_configuration_uuid, 'presence' => 'online'])->assertOk();
        $this->assertSame('applied', $device->fresh()->deployment_status);
        $this->assertSame($device->deployment_generation, $device->fresh()->applied_generation);

        return (string) $device->fresh()->applied_configuration_uuid;
    }

    private function runtimeEvent(string $type, array $payload): TestResponse
    {
        return $this->withToken(self::RUNTIME_TOKEN)->postJson('/api/internal/devices/events', ['uuid' => (string) Str::uuid(), 'type' => $type, 'payload' => $payload]);
    }

    /** A native Sparkplug device with a saved configuration draft, as DeviceDomainTest builds it. */
    private function configured(string $fixture, string $code): Device
    {
        $uuid = $this->postJson($this->prefix.'/devices', ['name' => 'Drift '.$code, 'code' => $code])->assertCreated()->json('data.uuid');
        $device = Device::where('uuid', $uuid)->firstOrFail();
        $definition = json_decode((string) file_get_contents(base_path('../../contracts/definitions/device-profiles/'.$fixture.'.v1.json')), true);
        $profile = DeviceProfile::create(['organization_id' => $this->organization->id, 'code' => $code.'-profile', 'name' => 'Drift profile']);
        $definition['profile']['uuid'] = $profile->uuid;
        $artifact = DeviceProfileArtifact::create(['device_profile_id' => $profile->id, 'revision' => 1, 'definition' => $definition,
            'definition_hash' => hash('sha256', app(CanonicalJson::class)->encode($definition)), 'status' => 'active', 'compiled_at' => now(), 'compiled_by' => auth()->id()]);
        $connection = SparkplugConnection::create(['organization_id' => $this->organization->id, 'name' => 'Connection', 'group_id' => $code, 'host_id' => $code, 'username' => $code, 'password' => 'test-secret', 'status' => 'ready']);
        $gateway = SparkplugGateway::create(['organization_id' => $this->organization->id, 'sparkplug_connection_id' => $connection->id, 'name' => 'Gateway', 'edge_node_id' => 'edge']);
        $metrics = [];
        $mappings = [];
        foreach ($definition['parameters'] as $parameter) {
            if (! $parameter['reports_state']) {
                continue;
            }
            $type = match ($parameter['data_type']) {
                'boolean' => 'Boolean', 'integer' => 'Int32', 'string', 'enum' => 'String', default => 'Double'
            };
            $value = match ($parameter['key']) {
                'power' => false, 'color' => '#ff0000', 'mode' => 'blink', 'brightness' => 5, default => 230.0
            };
            $metrics[] = ['name' => $parameter['label'], 'datatype' => $type, 'value' => $value];
            $mappings[] = ['parameter_uuid' => $parameter['uuid'], 'metric' => $parameter['label'], 'command_metric' => $parameter['accepts_command'] ? $parameter['label'] : null];
        }
        $candidate = DiscoveryCandidate::create(['organization_id' => $this->organization->id, 'sparkplug_gateway_id' => $gateway->id, 'source_device_id' => 'device', 'metrics' => $metrics,
            'presence' => 'online', 'session_id' => 'session-test', 'birth_revision' => 1, 'last_seen_at' => now()]);
        $this->putJson($this->prefix.'/devices/'.$device->uuid.'/configuration', ['draft_revision' => 1, 'artifact_uuid' => $artifact->uuid, 'candidate_uuid' => $candidate->uuid, 'birth_revision' => 1, 'mappings' => $mappings])->assertOk();

        return $device->fresh();
    }

    /**
     * A deployed adapter with a live Sparkplug birth for one physical source, as
     * DeviceAdapterTest builds it.
     *
     * @return array{DeviceAdapter, AdapterCandidate}
     */
    private function liveAdapterCandidate(): array
    {
        Artisan::call('devices:prepare-water-meter-profile');
        $artifact = DeviceProfile::where('code', 'water-meter-onboarding-example')->firstOrFail()->artifacts()->firstOrFail()->uuid;
        $created = $this->postJson($this->prefix.'/device-adapters', ['request_uuid' => (string) Str::uuid(), 'name' => 'Manufacturer water meter', 'artifact_uuid' => $artifact,
            'source' => ['type' => 'platform', 'topics' => ['manufacturer/meters/+']],
            'code' => 'function decode(input){return {sourceDeviceId:input.payload.serial,metrics:[{name:"flow_rate",value:input.payload.flow_ml_min/1000},{name:"total_volume",value:input.payload.total_ml/1000}]}}',
            'fixtures' => [['topic' => 'manufacturer/meters/live', 'payload' => ['serial' => 'WM-1042', 'flow_ml_min' => 12000, 'total_ml' => 8400000]]]])->assertCreated()->json('data.uuid');
        $this->postJson($this->prefix.'/device-adapters/'.$created.'/test', ['draft_revision' => 1])->assertOk()->assertJsonPath('data.valid', true);
        $adapter = DeviceAdapter::where('uuid', $created)->firstOrFail();
        $gateway = app(AdapterService::class)->gateway($adapter);
        $adapter->update(['status' => 'running', 'applied_revision_uuid' => $adapter->revisions()->first()->uuid]);
        $source = 'src-'.substr(hash('sha256', 'WM-1042'), 0, 32);
        DiscoveryCandidate::create(['organization_id' => $this->organization->id, 'sparkplug_gateway_id' => $gateway->id, 'source_device_id' => $source, 'birth_revision' => 1,
            'metrics' => [['name' => 'flow_rate', 'datatype' => 'Double', 'value' => 12], ['name' => 'total_volume', 'datatype' => 'Double', 'value' => 8400]]]);
        $candidate = AdapterCandidate::create(['organization_id' => $this->organization->id, 'device_adapter_id' => $adapter->id, 'source_device_id' => 'WM-1042', 'sparkplug_device_id' => $source, 'preview' => [], 'last_seen_at' => now()]);

        return [$adapter->fresh(), $candidate];
    }
}
