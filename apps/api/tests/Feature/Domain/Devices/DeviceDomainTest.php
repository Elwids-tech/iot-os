<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Devices;

use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\DeviceProfiles\Models\ProfileParameter;
use App\Domain\DeviceProfiles\Models\TransportBinding;
use App\Domain\DeviceProfiles\Support\CanonicalJson;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceConfiguration;
use App\Domain\Devices\Models\DiscoveryCandidate;
use App\Domain\Devices\Models\SparkplugConnection;
use App\Domain\Devices\Models\SparkplugGateway;
use App\Domain\Devices\Services\DeviceConfigurationService;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Database\Seeders\DevicePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

final class DeviceDomainTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private User $actor;

    private string $prefix;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->organization = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->actor = User::where('email', 'super-admin@example.test')->firstOrFail();
        $this->actingAs($this->actor, 'sanctum');
        $this->prefix = '/api/v1/organizations/'.$this->organization->uuid;
        config(['devices.runtime_token' => str_repeat('t', 40), 'devices.runtime_url' => 'http://runtime:8081']);
        Http::fake(['http://runtime:8081/*' => Http::response(['valid' => true, 'session_id' => 'session-test', 'already_at_target' => false])]);
    }

    private function registered(string $code = 'meter-1'): Device
    {
        $uuid = $this->postJson($this->prefix.'/devices', ['name' => 'Test meter', 'code' => $code])->assertCreated()->assertJsonMissingPath('data.id')->assertJsonPath('data.presence', 'unseen')->json('data.uuid');

        return Device::where('uuid', $uuid)->firstOrFail();
    }

    private function configured(string $fixture = 'three-phase-energy-meter', string $code = 'meter-1'): Device
    {
        $device = $this->registered($code);
        $definition = json_decode(file_get_contents(base_path('../../contracts/definitions/device-profiles/'.$fixture.'.v1.json')), true);
        $profile = DeviceProfile::create(['organization_id' => $this->organization->id, 'code' => $code.'-profile', 'name' => 'Test profile']);
        $definition['profile']['uuid'] = $profile->uuid;
        $json = app(CanonicalJson::class)->encode($definition);
        $artifact = DeviceProfileArtifact::create(['device_profile_id' => $profile->id, 'revision' => 1, 'definition' => $definition, 'definition_hash' => hash('sha256', $json), 'status' => 'active', 'compiled_at' => now(), 'compiled_by' => $this->actor->id]);
        $connection = SparkplugConnection::create(['organization_id' => $this->organization->id, 'name' => 'Connection', 'group_id' => $code, 'host_id' => $code, 'username' => $code, 'password' => 'test-secret', 'status' => 'ready']);
        $gateway = SparkplugGateway::create(['organization_id' => $this->organization->id, 'sparkplug_connection_id' => $connection->id, 'name' => 'Gateway', 'edge_node_id' => 'edge']);
        $metrics = [];
        $mappings = [];
        foreach ($definition['parameters'] as $parameter) {
            if (! $parameter['reports_state']) {
                continue;
            }
            $type = match ($parameter['data_type']) {
                'boolean' => 'Boolean', 'integer' => 'Int32', 'string' => 'String', default => 'Double'
            };
            $value = match ($parameter['key']) {
                'power' => false, 'color' => '#ff0000', 'mode' => 'blink', 'brightness' => 5, default => 230.0
            };
            $metrics[] = ['name' => $parameter['label'], 'datatype' => $type, 'value' => $value];
            $mappings[] = ['parameter_uuid' => $parameter['uuid'], 'metric' => $parameter['label'], 'command_metric' => $parameter['accepts_command'] ? $parameter['label'] : null];
        }
        $candidate = DiscoveryCandidate::create(['organization_id' => $this->organization->id, 'sparkplug_gateway_id' => $gateway->id, 'source_device_id' => 'device', 'metrics' => $metrics, 'presence' => 'online', 'session_id' => 'session-test', 'birth_revision' => 1, 'last_seen_at' => now()]);
        $this->putJson($this->prefix.'/devices/'.$device->uuid.'/configuration', ['draft_revision' => 1, 'artifact_uuid' => $artifact->uuid, 'candidate_uuid' => $candidate->uuid, 'birth_revision' => 1, 'mappings' => $mappings])->assertOk();

        return $device->fresh();
    }

    private function runtimeEvent(string $type, array $payload, ?string $uuid = null)
    {
        return $this->withToken(str_repeat('t', 40))->postJson('/api/internal/devices/events', ['uuid' => $uuid ?? (string) Str::uuid(), 'type' => $type, 'payload' => $payload]);
    }

    private function active(Device $device): Device
    {
        $this->postJson($this->prefix.'/devices/'.$device->uuid.'/activate', ['draft_revision' => $device->draft_revision])->assertAccepted()->assertJsonPath('data.lifecycle', 'registered');
        $device->refresh();
        $this->runtimeEvent('device.applied.v1', ['organization_uuid' => $this->organization->uuid, 'device_uuid' => $device->uuid, 'generation' => $device->deployment_generation, 'configuration_uuid' => $device->desired_configuration_uuid, 'presence' => 'online'])->assertOk();

        return $device->fresh();
    }

    public function test_registration_scope_conflicts_and_archive_preserve_records(): void
    {
        $device = $this->registered();
        $this->postJson($this->prefix.'/devices', ['name' => 'Duplicate', 'code' => $device->code])->assertUnprocessable();
        $other = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $this->getJson('/api/v1/organizations/'.$other->uuid.'/devices/'.$device->uuid)->assertNotFound();
        $url = $this->prefix.'/devices/'.$device->uuid;
        $this->patchJson($url, ['name' => 'Renamed', 'code' => $device->code, 'draft_revision' => 1])->assertOk()->assertJsonPath('data.draft_revision', 2);
        $this->patchJson($url, ['name' => 'Stale', 'code' => $device->code, 'draft_revision' => 1])->assertConflict();
        $this->postJson($url.'/archive', ['draft_revision' => 2])->assertOk()->assertJsonPath('data.lifecycle', 'archived');
        $this->assertDatabaseHas('devices', ['uuid' => $device->uuid, 'name' => 'Renamed']);
    }

    public function test_configuration_pins_artifact_and_rejects_duplicate_source_and_changed_birth(): void
    {
        $device = $this->configured();
        $another = $this->registered('meter-2');
        $this->putJson($this->prefix.'/devices/'.$another->uuid.'/configuration', ['draft_revision' => 1, ...$device->draft])->assertConflict();
        $artifact = DeviceProfileArtifact::where('uuid', $device->draft['artifact_uuid'])->firstOrFail();
        $artifact->update(['status' => 'retired']);
        $artifact->profile->update(['name' => 'Changed draft']);
        $compiled = app(DeviceConfigurationService::class)->compile($device);
        $this->assertSame($artifact->definition_hash, $compiled['profile_hash']);
        $this->assertSame('Three-phase Energy Meter', json_decode($compiled['profile_canonical_json'], true)['profile']['name']);
        $device->candidate->update(['birth_revision' => 2]);
        $this->postJson($this->prefix.'/devices/'.$device->uuid.'/validate', ['draft_revision' => $device->draft_revision])->assertConflict();
    }

    public function test_activation_acknowledgement_and_failure_do_not_replace_previous_snapshot(): void
    {
        $device = $this->active($this->configured());
        $applied = $device->applied_configuration_uuid;
        $this->assertNotNull($applied);
        $this->postJson($this->prefix.'/devices/'.$device->uuid.'/archive', ['draft_revision' => $device->draft_revision])->assertUnprocessable();
        $this->postJson($this->prefix.'/devices/'.$device->uuid.'/activate', ['draft_revision' => $device->draft_revision])->assertAccepted();
        $device->refresh();
        $this->runtimeEvent('device.failed.v1', ['organization_uuid' => $this->organization->uuid, 'device_uuid' => $device->uuid, 'generation' => $device->deployment_generation, 'diagnostic' => 'Incompatible metric'])->assertOk();
        $this->assertSame($applied, $device->fresh()->applied_configuration_uuid);
        $this->assertSame('failed', $device->fresh()->deployment_status);
        $this->assertDatabaseCount('device_configurations', 2);
        $snapshot = DeviceConfiguration::first();
        $this->expectException(\LogicException::class);
        $snapshot->update(['definition_hash' => str_repeat('0', 64)]);
    }

    public function test_deactivation_requires_runtime_ack_before_archive_and_events_are_idempotent(): void
    {
        $device = $this->active($this->configured());
        $path = $this->prefix.'/devices/'.$device->uuid;
        $this->postJson($path.'/deactivate', ['draft_revision' => $device->draft_revision])->assertAccepted();
        $device->refresh();
        $this->postJson($path.'/archive', ['draft_revision' => $device->draft_revision])->assertUnprocessable();
        $id = (string) Str::uuid();
        $payload = ['organization_uuid' => $this->organization->uuid, 'device_uuid' => $device->uuid, 'generation' => $device->deployment_generation];
        $this->runtimeEvent('device.deactivated.v1', $payload, $id)->assertOk();
        $this->runtimeEvent('device.deactivated.v1', $payload, $id)->assertOk()->assertJsonPath('duplicate', true);
        $this->postJson($path.'/archive', ['draft_revision' => $device->draft_revision])->assertOk();
        $this->assertDatabaseCount('device_configurations', 1);
    }

    public function test_commands_require_confirmation_are_idempotent_and_keep_one_outstanding_request(): void
    {
        $device = $this->active($this->configured('rgb-light'));
        $url = $this->prefix.'/devices/'.$device->uuid.'/commands';
        $request = ['configuration_uuid' => $device->applied_configuration_uuid, 'parameter_uuid' => '10000000-0000-4000-8000-000000000004', 'value' => 8, 'idempotency_key' => (string) Str::uuid()];
        $command = $this->postJson($url, $request)->assertCreated()->assertJsonPath('data.status', 'prepared')->json('data.uuid');
        $this->assertSame(0, DB::table('device_outbox')->where('type', 'device.command.v1')->count());
        $this->postJson($url, $request)->assertCreated()->assertJsonPath('data.uuid', $command);
        $this->postJson($url, [...$request, 'idempotency_key' => (string) Str::uuid()])->assertConflict();
        $this->postJson($url.'/'.$command.'/confirm', [])->assertUnprocessable();
        $this->postJson($url.'/'.$command.'/confirm', ['confirmed' => true])->assertOk()->assertJsonPath('data.status', 'pending');
        $this->postJson($url.'/'.$command.'/confirm', ['confirmed' => true])->assertOk();
        $this->assertSame(1, DB::table('device_outbox')->where('type', 'device.command.v1')->count());
        $this->runtimeEvent('command.status.v1', ['organization_uuid' => $this->organization->uuid, 'device_uuid' => $device->uuid, 'command_uuid' => $command, 'status' => 'observed'])->assertOk();
        $this->assertDatabaseHas('device_commands', ['uuid' => $command, 'status' => 'observed', 'outstanding_key' => null]);
        $this->postJson($url, [...$request, 'value' => 11, 'idempotency_key' => (string) Str::uuid()])->assertUnprocessable();
    }

    public function test_direct_controls_send_once_and_preserve_command_fences(): void
    {
        $device = $this->active($this->configured('rgb-light'));
        $url = $this->prefix.'/devices/'.$device->uuid.'/commands/send';
        $request = ['configuration_uuid' => $device->applied_configuration_uuid, 'parameter_uuid' => '10000000-0000-4000-8000-000000000004', 'value' => 8, 'idempotency_key' => (string) Str::uuid()];
        $command = $this->postJson($url, $request)->assertCreated()->assertJsonPath('data.status', 'pending')->json('data');
        $this->assertNotNull($command['confirmed_at']);
        $this->postJson($url, $request)->assertCreated()->assertJsonPath('data.uuid', $command['uuid']);
        $this->assertSame(1, DB::table('device_outbox')->where('type', 'device.command.v1')->count());
        $this->postJson($url, [...$request, 'value' => 9])->assertConflict();
        $this->postJson($url, [...$request, 'idempotency_key' => (string) Str::uuid()])->assertConflict();
        $this->postJson($url, [...$request, 'configuration_uuid' => (string) Str::uuid()])->assertConflict();
        $this->postJson($url, [...$request, 'value' => 101])->assertUnprocessable();
        $other = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $this->postJson('/api/v1/organizations/'.$other->uuid.'/devices/'.$device->uuid.'/commands/send', $request)->assertNotFound();
        $this->actingAs(User::where('email', 'acme.member@example.test')->firstOrFail(), 'sanctum');
        $this->postJson($url, $request)->assertForbidden();
    }

    public function test_direct_control_failure_rolls_back_preparation_and_already_target_does_not_dispatch(): void
    {
        $device = $this->active($this->configured('rgb-light'));
        $url = $this->prefix.'/devices/'.$device->uuid.'/commands/send';
        $request = ['configuration_uuid' => $device->applied_configuration_uuid, 'parameter_uuid' => '10000000-0000-4000-8000-000000000004', 'value' => 8, 'idempotency_key' => (string) Str::uuid()];
        Http::swap(new \Illuminate\Http\Client\Factory);
        Http::fake(['http://runtime:8081/*' => Http::sequence()->push(['session_id' => 'session-test', 'already_at_target' => false])->push(['error' => 'The source is offline.'], 409)]);
        $this->postJson($url, $request)->assertStatus(503);
        $this->assertDatabaseCount('device_commands', 0);
        $this->assertSame(0, DB::table('device_outbox')->where('type', 'device.command.v1')->count());
        Http::swap(new \Illuminate\Http\Client\Factory);
        Http::fake(['http://runtime:8081/*' => Http::response(['session_id' => 'session-test', 'already_at_target' => true])]);
        $this->postJson($url, $request)->assertCreated()->assertJsonPath('data.status', 'already_at_target');
        $this->assertSame(0, DB::table('device_outbox')->where('type', 'device.command.v1')->count());
    }

    public function test_mapping_suggestions_copy_direct_bindings_using_pinned_parameter_definitions(): void
    {
        $device = $this->configured('rgb-light');
        $artifact = DeviceProfileArtifact::where('uuid', $device->draft['artifact_uuid'])->firstOrFail();
        $parameter = $artifact->definition['parameters'][0];
        // The mutable row deliberately disagrees with the published writable parameter.
        $row = ProfileParameter::create(['device_profile_id' => $artifact->device_profile_id, 'uuid' => $parameter['uuid'], 'key' => $parameter['key'], 'label' => 'Edited draft', 'kind' => 'state', 'data_type' => 'boolean', 'reports_state' => true, 'accepts_command' => false]);
        $binding = TransportBinding::create(['device_profile_id' => $artifact->device_profile_id, 'adapter_key' => 'sparkplug_b', 'name' => 'Light defaults']);
        $mapping = $binding->parameterMappings()->create(['profile_parameter_id' => $row->id, 'direction' => 'bidirectional', 'transport_locator' => ['metric_name' => 'Power']]);
        $url = $this->prefix.'/devices/'.$device->uuid.'/mapping-suggestions?artifact_uuid='.$artifact->uuid;
        $draft = $device->draft;
        $this->getJson($url)->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.mappings.0.parameter_uuid', $parameter['uuid'])->assertJsonPath('data.0.mappings.0.command_metric', 'Power');
        $this->assertSame($draft, $device->fresh()->draft);
        $mapping->update(['transform_config' => ['scale' => 2]]);
        $this->getJson($url)->assertOk()->assertJsonCount(0, 'data');
        $mapping->update(['transform_config' => null]);
        $row->update(['uuid' => (string) Str::uuid()]);
        $this->getJson($url)->assertOk()->assertJsonCount(0, 'data');
    }

    public function test_gateway_provisioning_can_be_retried_without_exposing_credentials(): void
    {
        $this->configured();
        $gateway = SparkplugGateway::firstOrFail();
        $gateway->update(['username' => 'test-gateway', 'password' => 'test-gateway-secret']);
        $url = $this->prefix.'/gateways/'.$gateway->uuid.'/provision';
        config(['devices.emqx_url' => 'http://broker.test/api/v5', 'devices.emqx_key' => 'test-key', 'devices.emqx_secret' => 'test-secret']);
        Http::fake(['http://broker.test/*' => Http::sequence()->push([], 503)->whenEmpty(Http::response([], 200))]);
        $this->postJson($url)->assertStatus(503);
        $this->postJson($url)->assertOk()->assertJsonMissingPath('data.username')->assertJsonMissingPath('data.password');
        $this->postJson($url)->assertOk();
        $this->assertSame(1, SparkplugGateway::count());
        $this->actingAs(User::where('email', 'acme.member@example.test')->firstOrFail(), 'sanctum');
        $this->postJson($url)->assertForbidden();
    }

    public function test_retention_overrides_persist_require_reduction_confirmation_and_are_platform_only(): void
    {
        $global = '/api/v1/admin/settings/telemetry-retention';
        $org = '/api/v1/admin/organizations/'.$this->organization->uuid.'/settings/telemetry-retention';
        $this->getJson($global)->assertOk()->assertJsonPath('data.days', 90)->assertJsonPath('data.source', 'default');
        $this->putJson($global, ['days' => 120, 'revision' => 0])->assertOk()->assertJsonPath('data.days', 120);
        $this->putJson($org, ['days' => 30, 'revision' => 0])->assertUnprocessable();
        $this->putJson($org, ['days' => 30, 'revision' => 0, 'confirmed_reduction' => true])->assertOk()->assertJsonPath('data.source', 'organization');
        $this->putJson($global, ['days' => 180, 'revision' => 0])->assertConflict();
        $this->getJson($org)->assertJsonPath('data.days', 30);
        $this->putJson($org, ['days' => null, 'revision' => 1])->assertOk()->assertJsonPath('data.days', 120)->assertJsonPath('data.source', 'platform');
        $this->actingAs(User::where('email', 'shared.operator@example.test')->firstOrFail(), 'sanctum');
        $this->putJson($global, ['days' => 999, 'revision' => 1])->assertForbidden();
    }

    public function test_permission_upgrade_is_additive_and_connection_responses_do_not_expose_credentials(): void
    {
        $device = $this->configured();
        $counts = [DB::table('users')->count(), DB::table('organization_user')->count()];
        $this->seed(DevicePermissionSeeder::class);
        $this->seed(DevicePermissionSeeder::class);
        $this->assertSame($counts, [DB::table('users')->count(), DB::table('organization_user')->count()]);
        $this->getJson($this->prefix.'/sparkplug-connections')->assertOk()->assertJsonMissingPath('data.0.password')->assertJsonMissingPath('data.0.username');
        $this->withToken('invalid')->getJson('/api/internal/devices/state')->assertUnauthorized();
        $this->withToken(str_repeat('t', 40))->getJson('/api/internal/devices/state')->assertOk()->assertJsonPath('connections.0.password', 'test-secret');
    }

    public function test_compatible_birth_updates_aliases_without_requiring_mapping_review(): void
    {
        $device = $this->configured();
        $candidate = $device->candidate;
        $metrics = $candidate->metrics;
        foreach ($metrics as $index => &$metric) {
            $metric['alias'] = $index + 50;
            $metric['value'] = 231;
        }
        unset($metric);
        $payload = ['connection_uuid' => $candidate->gateway->connection->uuid, 'edge_node_id' => $candidate->gateway->edge_node_id, 'device_id' => $candidate->source_device_id, 'session_id' => 'new-session', 'received_at' => now()->toIso8601String(), 'metrics' => $metrics];
        $this->runtimeEvent('discovery.birth.v1', $payload)->assertOk();
        $this->assertSame(1, $candidate->fresh()->birth_revision);
        $metrics[0]['datatype'] = 'Float';
        $this->runtimeEvent('discovery.birth.v1', [...$payload, 'metrics' => $metrics])->assertOk();
        $this->assertSame(2, $candidate->fresh()->birth_revision);
    }

    public function test_cleanup_failures_are_visible_and_a_successful_retry_clears_them(): void
    {
        $payload = ['organization_uuid' => $this->organization->uuid, 'status' => 'failed', 'diagnostic' => 'Storage unavailable', 'deleted_rows' => 0];
        $this->runtimeEvent('retention.cleanup.v1', $payload)->assertOk();
        $url = '/api/v1/admin/organizations/'.$this->organization->uuid.'/settings/telemetry-retention';
        $this->getJson($url)->assertOk()->assertJsonPath('data.cleanup_failures', 1)->assertJsonPath('data.cleanup.status', 'failed');
        $this->runtimeEvent('retention.cleanup.v1', [...$payload, 'status' => 'complete', 'diagnostic' => '', 'deleted_rows' => 5])->assertOk();
        $this->getJson($url)->assertOk()->assertJsonPath('data.cleanup_failures', 0)->assertJsonPath('data.cleanup.deleted_rows', 5);
    }

    public function test_registration_without_a_profile_returns_a_validation_error_and_directories_are_bounded(): void
    {
        $device = $this->registered();
        $this->postJson($this->prefix.'/devices/'.$device->uuid.'/activate', ['draft_revision' => 1])->assertUnprocessable();
        $this->configured('three-phase-energy-meter', 'second');
        $this->getJson($this->prefix.'/discovery-candidates?per_page=1')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('meta.current_page', 1);
        $this->getJson($this->prefix.'/discovery-candidates?per_page=101')->assertUnprocessable();
    }

    public function test_lifecycle_round_trip_resumes_confirmed_snapshot_and_not_changed_draft(): void
    {
        $device = $this->active($this->configured());
        $configuration = $device->applied_configuration_uuid;
        $path = $this->prefix.'/devices/'.$device->uuid;
        $off = ['operation_uuid' => (string) Str::uuid(), 'target_state' => 'inactive', 'expected_generation' => $device->deployment_generation];
        $accepted = $this->postJson($path.'/lifecycle', $off)->assertAccepted()->assertJsonPath('data.lifecycle', 'active')->assertJsonPath('operation.status', 'pending');
        $this->postJson($path.'/lifecycle', $off)->assertAccepted()->assertJsonPath('operation.uuid', $off['operation_uuid']);
        $this->assertDatabaseCount('device_operations', 2);
        $this->getJson($path.'/operations/'.$off['operation_uuid'])->assertOk()->assertJsonPath('operation.status', 'pending');
        $device->refresh();
        $ack = ['organization_uuid' => $this->organization->uuid, 'device_uuid' => $device->uuid, 'generation' => $device->deployment_generation, 'operation_uuid' => $off['operation_uuid'], 'uncertain_command_uuids' => []];
        $this->runtimeEvent('device.deactivated.v1', [...$ack, 'operation_uuid' => (string) Str::uuid()])->assertOk()->assertJsonPath('stale', true);
        $this->assertSame('active', $device->fresh()->lifecycle);
        $this->runtimeEvent('device.deactivated.v1', $ack)->assertOk();
        $this->runtimeEvent('device.deactivated.v1', $ack)->assertOk()->assertJsonPath('stale', true);
        $this->getJson($path)->assertOk()->assertJsonPath('data.lifecycle', 'deactivated')->assertJsonPath('data.deployment_status', 'inactive')->assertJsonPath('data.last_applied_configuration_uuid', $configuration);
        $device->refresh();
        $draft = $device->draft;
        $draft['mappings'] = [];
        $device->update(['draft' => $draft]);
        $on = ['operation_uuid' => (string) Str::uuid(), 'target_state' => 'active', 'expected_generation' => $device->deployment_generation];
        $this->postJson($path.'/lifecycle', $on)->assertAccepted()->assertJsonPath('data.lifecycle', 'deactivated')->assertJsonPath('data.desired_configuration_uuid', $configuration);
        $this->assertDatabaseCount('device_configurations', 1);
        $device->refresh();
        $this->runtimeEvent('device.applied.v1', [...$ack, 'operation_uuid' => $on['operation_uuid'], 'generation' => $device->deployment_generation, 'configuration_uuid' => $configuration])->assertOk();
        $this->getJson($path.'/operations/'.$on['operation_uuid'])->assertOk()->assertJsonPath('operation.status', 'succeeded')->assertJsonPath('data.lifecycle', 'active');
        $this->assertSame([], $device->fresh()->draft['mappings']);
    }

    public function test_lifecycle_rejects_conflicts_and_keeps_previous_state_on_failure(): void
    {
        $device = $this->active($this->configured());
        $path = $this->prefix.'/devices/'.$device->uuid;
        $request = ['operation_uuid' => (string) Str::uuid(), 'target_state' => 'inactive', 'expected_generation' => $device->deployment_generation];
        $this->postJson($path.'/lifecycle', [...$request, 'expected_generation' => 0])->assertConflict();
        $this->postJson($path.'/lifecycle', $request)->assertAccepted();
        $this->postJson($path.'/lifecycle', [...$request, 'target_state' => 'active'])->assertConflict();
        $this->postJson($path.'/lifecycle', [...$request, 'operation_uuid' => (string) Str::uuid()])->assertConflict();
        $device->refresh();
        $this->runtimeEvent('device.failed.v1', ['organization_uuid' => $this->organization->uuid, 'device_uuid' => $device->uuid, 'generation' => $device->deployment_generation, 'operation_uuid' => $request['operation_uuid'], 'diagnostic' => 'Runtime storage unavailable'])->assertOk();
        $this->getJson($path.'/operations/'.$request['operation_uuid'])->assertOk()->assertJsonPath('operation.status', 'failed')->assertJsonPath('data.lifecycle', 'active');
        $this->assertNotNull($device->fresh()->applied_configuration_uuid);
    }

    public function test_lifecycle_never_guesses_an_unconfirmed_configuration(): void
    {
        $device = $this->configured();
        $device->update(['lifecycle' => 'deactivated']);
        $this->postJson($this->prefix.'/devices/'.$device->uuid.'/lifecycle', ['operation_uuid' => (string) Str::uuid(), 'target_state' => 'active', 'expected_generation' => 0])->assertUnprocessable();
    }

    public function test_lifecycle_and_operation_reads_reject_cross_organization_access(): void
    {
        $device = $this->active($this->configured());
        $other = Organization::where('id', '!=', $this->organization->id)->firstOrFail();
        $path = '/api/v1/organizations/'.$other->uuid.'/devices/'.$device->uuid;
        $this->postJson($path.'/lifecycle', ['operation_uuid' => (string) Str::uuid(), 'target_state' => 'inactive', 'expected_generation' => $device->deployment_generation])->assertNotFound();
        $this->getJson($path.'/operations/'.(string) Str::uuid())->assertNotFound();
    }

    public function test_deactivation_blocks_commands_and_resolves_unsent_and_potentially_sent_outcomes(): void
    {
        foreach (['prepared', 'pending', 'sent'] as $status) {
            $device = $this->active($this->configured('rgb-light', 'light-'.$status));
            $path = $this->prefix.'/devices/'.$device->uuid;
            $request = ['configuration_uuid' => $device->applied_configuration_uuid, 'parameter_uuid' => '10000000-0000-4000-8000-000000000004', 'value' => 8, 'idempotency_key' => (string) Str::uuid()];
            $command = $this->postJson($path.'/commands', $request)->assertCreated()->json('data.uuid');
            if ($status !== 'prepared') {
                $this->postJson($path.'/commands/'.$command.'/confirm', ['confirmed' => true])->assertOk();
            }
            if ($status === 'sent') {
                $this->runtimeEvent('command.status.v1', ['organization_uuid' => $this->organization->uuid, 'device_uuid' => $device->uuid, 'command_uuid' => $command, 'status' => 'sent'])->assertOk();
            }
            $operation = (string) Str::uuid();
            $this->postJson($path.'/lifecycle', ['operation_uuid' => $operation, 'target_state' => 'inactive', 'expected_generation' => $device->deployment_generation])->assertAccepted();
            $this->postJson($path.'/commands', [...$request, 'idempotency_key' => (string) Str::uuid()])->assertConflict();
            if ($status === 'prepared') {
                $this->postJson($path.'/commands/'.$command.'/confirm', ['confirmed' => true])->assertConflict();
            }
            $this->runtimeEvent('device.deactivated.v1', ['organization_uuid' => $this->organization->uuid, 'device_uuid' => $device->uuid, 'operation_uuid' => $operation, 'generation' => $device->fresh()->deployment_generation, 'uncertain_command_uuids' => $status === 'sent' ? [$command] : []])->assertOk();
            $this->assertDatabaseHas('device_commands', ['uuid' => $command, 'status' => $status === 'sent' ? 'uncertain' : 'cancelled', 'outstanding_key' => null]);
        }
    }

    public function test_conversion_modes_resolve_from_the_selected_artifact(): void
    {
        $device = $this->configured();
        $old = DeviceProfileArtifact::where('uuid', $device->draft['artifact_uuid'])->firstOrFail();
        $definition = $old->definition;
        $definition['schema_version'] = 'device-profile.v2';
        $definition['parameters'][0]['ingress_conversion'] = ['source_unit' => 'W', 'multiplier' => 0.001, 'offset' => 0];
        $definition['parameters'][0]['kind'] = 'measurement';
        $definition['parameters'][0]['data_type'] = 'number';
        $definition['parameters'][0]['accepts_command'] = false;
        $artifact = DeviceProfileArtifact::create(['device_profile_id' => $old->device_profile_id, 'revision' => 2, 'definition' => $definition, 'definition_hash' => hash('sha256', app(CanonicalJson::class)->encode($definition)), 'status' => 'active', 'compiled_at' => now(), 'compiled_by' => $this->actor->id]);
        $draft = $device->draft;
        $draft['artifact_uuid'] = $artifact->uuid;
        $device = app(DeviceConfigurationService::class)->saveDraft($device, $draft, $device->draft_revision, $this->actor->id);
        $compiled = app(DeviceConfigurationService::class)->compile($device);
        $this->assertSame('device-configuration.v2', $compiled['schema_version']);
        $this->assertSame('profile', $compiled['mappings'][0]['conversion_mode']);
        $this->assertEquals(0.001, $compiled['mappings'][0]['ingress_conversion']['multiplier']);
        foreach (['custom', 'none'] as $mode) {
            $draft['mappings'][0]['conversion_mode'] = $mode;
            $draft['mappings'][0]['ingress_conversion'] = $mode === 'custom' ? ['source_unit' => 'W', 'multiplier' => 0.01, 'offset' => 1] : null;
            $device = app(DeviceConfigurationService::class)->saveDraft($device, $draft, $device->draft_revision, $this->actor->id);
            $mapping = app(DeviceConfigurationService::class)->compile($device)['mappings'][0];
            $this->assertSame($mode, $mapping['conversion_mode']);
            $this->assertEquals($draft['mappings'][0]['ingress_conversion'], $mapping['ingress_conversion']);
        }
        $this->assertSame($old->definition, $old->fresh()->definition);
        $this->assertSame($definition, $artifact->fresh()->definition);
    }
}
