<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Devices;

use App\Domain\Authorization\Enums\OrganizationRoleName;
use App\Domain\Authorization\Models\Role;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\DeviceProfiles\Models\ProfileParameter;
use App\Domain\DeviceProfiles\Models\TransportBinding;
use App\Domain\DeviceProfiles\Services\ProfileConfigurationValidator;
use App\Domain\DeviceProfiles\Support\CanonicalJson;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceConfiguration;
use App\Domain\Devices\Models\DiscoveryCandidate;
use App\Domain\Devices\Models\Site;
use App\Domain\Devices\Models\SparkplugConnection;
use App\Domain\Devices\Models\SparkplugGateway;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceConfigurationService;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Database\Seeders\DevicePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Factory;
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

    public function test_presence_without_last_seen_at_keeps_when_the_device_was_last_seen(): void
    {
        $device = $this->active($this->configured());
        $seen = now()->subDays(3)->startOfSecond();
        $device->update(['last_seen_at' => $seen]);
        $device->candidate->update(['last_seen_at' => $seen]);
        $presence = ['organization_uuid' => $this->organization->uuid, 'device_uuid' => $device->uuid, 'configuration_uuid' => $device->applied_configuration_uuid, 'generation' => $device->deployment_generation];

        // The runtime lost its broker connection; nothing arrived from the device.
        $lost = 'Broker connection was lost; waiting for fresh birth certificates.';
        $this->runtimeEvent('device.presence.v1', [...$presence, 'presence' => 'unknown', 'diagnostic' => $lost])->assertOk()->assertJsonMissingPath('stale');
        $device->refresh();
        $this->assertSame('unknown', $device->presence);
        $this->assertSame($lost, $device->diagnostic);
        $this->assertEquals($seen, $device->last_seen_at);
        $this->assertEquals($seen, $device->candidate->last_seen_at);

        $received = now()->subMinute()->startOfSecond();
        $this->runtimeEvent('device.presence.v1', [...$presence, 'presence' => 'online', 'diagnostic' => '', 'last_seen_at' => $received->toIso8601ZuluString()])->assertOk();
        $device->refresh();
        $this->assertSame('online', $device->presence);
        $this->assertEquals($received, $device->last_seen_at);
        $this->assertEquals($received, $device->candidate->last_seen_at);
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
        Http::swap(new Factory);
        Http::fake(['http://runtime:8081/*' => Http::sequence()->push(['session_id' => 'session-test', 'already_at_target' => false])->push(['error' => 'The source is offline.'], 409)]);
        $this->postJson($url, $request)->assertStatus(503);
        $this->assertDatabaseCount('device_commands', 0);
        $this->assertSame(0, DB::table('device_outbox')->where('type', 'device.command.v1')->count());
        Http::swap(new Factory);
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
        config(['devices.broker_admin_url' => 'http://broker.test', 'devices.broker_admin_token' => 'test-token']);
        Http::fake(['http://broker.test/*' => Http::sequence()->push([], 503)->whenEmpty(Http::response([], 200))]);
        $this->postJson($url)->assertStatus(503);
        $this->postJson($url)->assertOk()->assertJsonMissingPath('data.username')->assertJsonMissingPath('data.password');
        $this->postJson($url)->assertOk();
        $this->assertSame(1, SparkplugGateway::count());
        $this->actingAs(User::where('email', 'acme.member@example.test')->firstOrFail(), 'sanctum');
        $this->postJson($url)->assertForbidden();
    }

    public function test_device_configuration_includes_profile_identity_and_revision(): void
    {
        $device = $this->active($this->configured('rgb-light'));
        $configuration = $device->configurations()->with('artifact.profile')->firstOrFail();

        $this->getJson($this->prefix.'/devices/'.$device->uuid)
            ->assertOk()
            ->assertJsonPath('data.configurations.0.profile_artifact_uuid', $configuration->artifact->uuid)
            ->assertJsonPath('data.configurations.0.profile_uuid', $configuration->artifact->profile->uuid)
            ->assertJsonPath('data.configurations.0.profile_name', $configuration->artifact->profile->name)
            ->assertJsonPath('data.configurations.0.profile_revision', $configuration->artifact->revision);
    }

    public function test_device_list_names_profile_and_gateway_and_profile_list_counts_devices(): void
    {
        $device = $this->active($this->configured('rgb-light'));
        $artifact = $device->configurations()->with('artifact.profile')->firstOrFail()->artifact;
        $draftOnly = $this->configured('three-phase-energy-meter', 'second');
        $unconfigured = $this->registered('third');
        $devices = fn () => collect($this->getJson($this->prefix.'/devices')->assertOk()->json('data'))->keyBy('uuid');
        $profiles = fn () => collect($this->getJson($this->prefix.'/device-profiles?per_page=100')->assertOk()->json('data'))->keyBy('uuid');

        $listed = $devices();
        $this->assertSame(['uuid' => $artifact->profile->uuid, 'name' => $artifact->profile->name, 'revision' => $artifact->revision], $listed[$device->uuid]['profile']);
        $this->assertSame('Gateway', $listed[$device->uuid]['candidate']['gateway']['name']);
        $this->assertNull($listed[$draftOnly->uuid]['profile']);
        $this->assertNull($listed[$unconfigured->uuid]['profile']);
        $this->getJson($this->prefix.'/devices/'.$device->uuid)->assertJsonPath('data.profile.uuid', $artifact->profile->uuid);
        $this->assertSame(1, $profiles()[$artifact->profile->uuid]['devices_count']);
        $this->assertSame(0, $profiles()[DeviceProfile::where('code', 'second-profile')->value('uuid')]['devices_count']);

        $device->forceFill(['applied_configuration_uuid' => null, 'lifecycle' => 'deactivated'])->save();
        $this->assertSame($artifact->profile->uuid, $devices()[$device->uuid]['profile']['uuid']);
        $this->assertSame(1, $profiles()[$artifact->profile->uuid]['devices_count']);
        $device->forceFill(['lifecycle' => 'archived'])->save();
        $this->assertSame(0, $profiles()[$artifact->profile->uuid]['devices_count']);
    }

    public function test_profile_list_omits_device_counts_without_device_view(): void
    {
        $device = $this->active($this->configured('rgb-light'));
        $profile = $device->configurations()->with('artifact.profile')->firstOrFail()->artifact->profile;
        $member = User::where('email', 'acme.member@example.test')->firstOrFail();
        $listed = fn () => collect($this->actingAs($member, 'sanctum')->getJson($this->prefix.'/device-profiles?per_page=100')->assertOk()->json('data'))->firstWhere('uuid', $profile->uuid);
        $this->assertSame(1, $listed()['devices_count']);

        Role::where('organization_id', $this->organization->id)->where('name', OrganizationRoleName::MEMBER->value)->firstOrFail()->revokePermissionTo(DevicePermission::VIEW->value);
        $this->getJson($this->prefix.'/devices')->assertForbidden();
        $this->assertArrayNotHasKey('devices_count', $listed());
    }

    public function test_device_list_query_count_does_not_grow_with_the_page(): void
    {
        $queries = function (): int {
            DB::flushQueryLog();
            DB::enableQueryLog();
            $this->getJson($this->prefix.'/devices')->assertOk();
            DB::disableQueryLog();

            return count(DB::getQueryLog());
        };
        $this->active($this->configured('rgb-light', 'first'));
        $small = $queries();
        $this->active($this->configured('rgb-light', 'second'));
        $this->active($this->configured('three-phase-energy-meter', 'third'));
        $this->configured('three-phase-energy-meter', 'fourth');
        $this->registered('fifth');

        $this->assertSame($small, $queries());
        $this->assertGreaterThanOrEqual(5, $this->getJson($this->prefix.'/devices')->json('meta.total'));
    }

    public function test_sites_give_devices_a_reporting_time_zone_with_tags_and_attributes(): void
    {
        $vancouver = $this->postJson($this->prefix.'/sites', ['name' => 'Vancouver plant', 'timezone' => 'America/Vancouver', 'latitude' => 49.28, 'longitude' => -123.12])
            ->assertCreated()->assertJsonPath('data.timezone', 'America/Vancouver')->json('data.uuid');
        $this->postJson($this->prefix.'/sites', ['name' => 'Vancouver plant', 'timezone' => 'America/Toronto'])->assertUnprocessable()->assertJsonValidationErrors('name');
        $this->postJson($this->prefix.'/sites', ['name' => 'Nowhere', 'timezone' => 'Mars/Olympus'])->assertUnprocessable()->assertJsonValidationErrors('timezone');
        $this->postJson($this->prefix.'/sites', ['name' => 'Half', 'timezone' => 'UTC', 'latitude' => 1])->assertUnprocessable()->assertJsonValidationErrors('longitude');

        $device = $this->registered('site-meter');
        $this->patchJson($this->prefix.'/devices/'.$device->uuid, ['name' => 'Site meter', 'code' => 'site-meter', 'draft_revision' => $device->draft_revision,
            'site_uuid' => $vancouver, 'tags' => [' Line 2 ', 'line 2', 'Energy'], 'attributes' => ['line' => '2', 'rated_kw' => 80, 'critical' => true]])
            ->assertOk()->assertJsonPath('data.site.timezone', 'America/Vancouver')->assertJsonPath('data.tags', ['Line 2', 'Energy'])
            ->assertJsonPath('data.attributes.rated_kw', 80);
        $device->refresh();
        $this->patchJson($this->prefix.'/devices/'.$device->uuid, ['name' => 'Site meter', 'code' => 'site-meter', 'draft_revision' => $device->draft_revision, 'attributes' => ['Bad Key' => 'x']])
            ->assertUnprocessable()->assertJsonValidationErrors('attributes');
        $this->patchJson($this->prefix.'/devices/'.$device->uuid, ['name' => 'Site meter', 'code' => 'site-meter', 'draft_revision' => $device->draft_revision, 'attributes' => ['nested' => ['a' => 1]]])
            ->assertUnprocessable()->assertJsonValidationErrors('attributes.nested');
        $foreign = Site::create(['organization_id' => Organization::where('slug', 'northstar-utilities')->firstOrFail()->id, 'name' => 'Elsewhere', 'timezone' => 'UTC']);
        $this->patchJson($this->prefix.'/devices/'.$device->uuid, ['name' => 'Site meter', 'code' => 'site-meter', 'draft_revision' => $device->draft_revision, 'site_uuid' => $foreign->uuid])
            ->assertUnprocessable()->assertJsonValidationErrors('site_uuid');
        $this->patchJson($this->prefix.'/sites/'.$foreign->uuid, ['name' => 'Taken'])->assertNotFound();

        $codes = fn (string $query) => collect($this->getJson($this->prefix.'/devices?per_page=100&'.$query)->assertOk()->json('data'))->pluck('code')->all();
        $this->assertSame(['site-meter'], $codes('site_uuid='.$vancouver));
        $this->assertSame(['site-meter'], $codes('tag=Energy'));
        $this->getJson($this->prefix.'/sites')->assertOk()->assertJsonPath('data.0.devices_count', 1);
        $this->assertSame('America/Vancouver', $device->fresh()->reportingTimezone());
        $this->getJson($this->prefix.'/devices/'.$device->uuid)->assertOk()->assertJsonPath('data.reporting_timezone', 'America/Vancouver');

        // Devices without a site use the organization's zone, then UTC.
        $this->putJson($this->prefix.'/settings/timezone', ['timezone' => 'America/Toronto'])->assertOk()->assertJsonPath('data.timezone', 'America/Toronto');
        $this->deleteJson($this->prefix.'/sites/'.$vancouver)->assertNoContent();
        $this->assertNull($device->fresh()->site_id);
        $this->assertSame('America/Toronto', $device->fresh()->reportingTimezone());
        $this->getJson($this->prefix.'/devices/'.$device->uuid)->assertOk()->assertJsonPath('data.reporting_timezone', 'America/Toronto');
        $this->putJson($this->prefix.'/settings/timezone', ['timezone' => null])->assertOk();
        $this->assertSame('UTC', $device->fresh()->reportingTimezone());

        $this->actingAs(User::where('email', 'shared.operator@example.test')->firstOrFail(), 'sanctum');
        Role::where('organization_id', $this->organization->id)->each(fn ($role) => $role->revokePermissionTo(DevicePermission::MANAGE->value));
        $this->postJson($this->prefix.'/sites', ['name' => 'Denied', 'timezone' => 'UTC'])->assertForbidden();
        $this->putJson($this->prefix.'/settings/timezone', ['timezone' => 'UTC'])->assertForbidden();
    }

    public function test_devices_can_be_listed_by_profile(): void
    {
        $light = $this->active($this->configured('rgb-light', 'by-profile-light'));
        $meter = $this->active($this->configured('three-phase-energy-meter', 'by-profile-meter'));
        $this->registered('by-profile-unconfigured');
        $profile = $meter->fresh()->appliedConfiguration->artifact->profile->uuid;

        $codes = collect($this->getJson($this->prefix.'/devices?per_page=100&profile_uuid='.$profile)->assertOk()->json('data'))->pluck('code');
        $this->assertContains('by-profile-meter', $codes);
        $this->assertNotContains('by-profile-light', $codes);
        $this->assertNotContains('by-profile-unconfigured', $codes);
        $this->getJson($this->prefix.'/devices?profile_uuid=not-a-uuid')->assertUnprocessable();
        $this->assertNotNull($light);
    }

    public function test_devices_filter_by_the_list_status_and_leave_out_archived_as_current(): void
    {
        $states = [
            'status-online' => ['lifecycle' => 'active', 'presence' => 'online', 'runtime_seen_at' => now()],
            'status-stale' => ['lifecycle' => 'active', 'presence' => 'online', 'runtime_seen_at' => now()->subMinute()],
            'status-offline' => ['lifecycle' => 'active', 'presence' => 'offline'],
            'status-unseen' => ['lifecycle' => 'active', 'presence' => 'unseen'],
            'status-registered' => ['lifecycle' => 'registered', 'presence' => 'unseen'],
            'status-pending' => ['lifecycle' => 'active', 'presence' => 'online', 'runtime_seen_at' => now(), 'deployment_status' => 'pending'],
            'status-failed' => ['lifecycle' => 'registered', 'deployment_status' => 'failed'],
            'status-deactivated' => ['lifecycle' => 'deactivated', 'presence' => 'offline', 'deployment_status' => 'inactive'],
            // Archived wins over a failed configuration, as in the portal.
            'status-archived' => ['lifecycle' => 'archived', 'deployment_status' => 'failed'],
        ];
        foreach ($states as $code => $state) {
            $this->registered($code)->forceFill($state)->save();
        }
        $codes = fn (string $query) => collect($this->getJson($this->prefix.'/devices?per_page=100&search=status-&'.$query)->assertOk()->json('data'))->pluck('code')->sort()->values()->all();

        $this->assertSame(['status-online'], $codes('status[]=online'));
        $this->assertSame(['status-stale'], $codes('status[]=unknown'));
        $this->assertSame(['status-offline', 'status-unseen'], $codes('status[]=offline&status[]=unseen'));
        $this->assertSame(['status-registered'], $codes('status[]=unconfigured'));
        $this->assertSame(['status-pending'], $codes('status[]=updating'));
        $this->assertSame(['status-failed'], $codes('status[]=failed'));
        $this->assertSame(['status-deactivated'], $codes('status[]=deactivated'));
        $this->assertSame(['status-archived'], $codes('status[]=archived'));
        $this->assertNotContains('status-archived', $codes('lifecycle=current'));
        $this->assertCount(8, $codes('lifecycle=current'));
        $this->assertSame([], $codes('lifecycle=current&status[]=archived'));
        $this->getJson($this->prefix.'/devices?status[]=quiet')->assertUnprocessable()->assertJsonValidationErrors('status.0');
        $this->getJson($this->prefix.'/devices?status=online')->assertUnprocessable()->assertJsonValidationErrors('status');
    }

    public function test_devices_sort_by_an_allowed_column_with_never_seen_devices_last(): void
    {
        $old = $this->registered('sort-b-old');
        $recent = $this->registered('sort-a-recent');
        $this->registered('sort-c-never');
        $old->forceFill(['name' => 'Sort B', 'last_seen_at' => now()->subDay()])->save();
        $recent->forceFill(['name' => 'Sort A', 'last_seen_at' => now()->subMinute()])->save();
        Device::where('code', 'sort-c-never')->update(['name' => 'Sort C', 'last_seen_at' => null]);
        $codes = fn (string $sort) => collect($this->getJson($this->prefix.'/devices?per_page=100&search=sort-&sort='.$sort)->assertOk()->assertJsonPath('meta.sort', $sort)->json('data'))->pluck('code')->all();

        $this->assertSame(['sort-a-recent', 'sort-b-old', 'sort-c-never'], $codes('name'));
        $this->assertSame(['sort-c-never', 'sort-b-old', 'sort-a-recent'], $codes('-name'));
        $this->assertSame(['sort-a-recent', 'sort-b-old', 'sort-c-never'], $codes('-last_seen'));
        $this->assertSame(['sort-b-old', 'sort-a-recent', 'sort-c-never'], $codes('last_seen'));
        $this->getJson($this->prefix.'/devices?search=sort-')->assertOk()->assertJsonPath('meta.sort', 'name');
        $this->getJson($this->prefix.'/devices?sort=organization_id')->assertUnprocessable()->assertJsonValidationErrors('sort');
    }

    public function test_history_record_and_state_endpoints_proxy_bounded_contracts(): void
    {
        $device = $this->active($this->configured('rgb-light'));
        $parameter = '10000000-0000-4000-8000-000000000001';
        Http::swap(new Factory);
        Http::fake([
            'http://runtime:8081/internal/measurements/records*' => Http::response([
                'data' => [['event_uuid' => (string) Str::uuid(), 'data_type' => 'boolean', 'value' => true]],
                'meta' => ['limit' => 500, 'page_size' => 50, 'next_cursor' => null, 'has_more' => false, 'limit_reached' => false],
            ]),
            'http://runtime:8081/internal/measurements/state-history*' => Http::response([
                'data' => ['durations' => [], 'timeline' => [], 'sampled' => false],
            ]),
        ]);
        $range = ['parameter_uuid' => $parameter, 'from' => '2026-09-12T00:00:00Z', 'to' => '2026-09-12T01:00:00Z'];

        $this->getJson($this->prefix.'/devices/'.$device->uuid.'/measurements/records?'.http_build_query($range))
            ->assertOk()
            ->assertJsonPath('meta.limit', 500)
            ->assertJsonPath('data.0.value', true);
        $this->getJson($this->prefix.'/devices/'.$device->uuid.'/measurements/state-history?'.http_build_query([...$range, 'max_points' => 500]))
            ->assertOk()
            ->assertJsonPath('data.sampled', false);
        $this->getJson($this->prefix.'/devices/'.$device->uuid.'/measurements/state-history?'.http_build_query([...$range, 'parameter_uuid' => '10000000-0000-4000-8000-000000000004']))
            ->assertUnprocessable();
        $this->getJson($this->prefix.'/devices/'.$device->uuid.'/measurements/records?'.http_build_query([...$range, 'limit' => 5001]))
            ->assertUnprocessable();
        $this->getJson($this->prefix.'/devices/'.$device->uuid.'/measurements/state-history?'.http_build_query([...$range, 'max_points' => 501]))
            ->assertUnprocessable();

        Http::assertSent(fn ($request) => str_contains($request->url(), '/internal/measurements/records')
            && str_contains($request->url(), 'limit=500')
            && str_contains($request->url(), 'page_size=50')
            && str_contains($request->url(), 'retention_days='));
        Http::assertSent(fn ($request) => str_contains($request->url(), '/internal/measurements/state-history')
            && str_contains($request->url(), 'max_points=500')
            && str_contains($request->url(), 'retention_days='));
    }

    public function test_range_reads_cut_off_by_the_runtime_explain_themselves(): void
    {
        $device = $this->active($this->configured('rgb-light'));
        Http::swap(new Factory);
        Http::fake([
            'http://runtime:8081/internal/measurements/state-history*' => Http::response(['message' => 'This range has too many readings to load in time. Choose a shorter range.'], 504),
            'http://runtime:8081/internal/measurements/history*' => Http::response(['message' => 'state history is unavailable'], 503),
        ]);
        $range = ['parameter_uuid' => '10000000-0000-4000-8000-000000000001', 'from' => '2026-09-01T00:00:00Z', 'to' => '2026-10-01T00:00:00Z'];

        $this->getJson($this->prefix.'/devices/'.$device->uuid.'/measurements/state-history?'.http_build_query($range))
            ->assertStatus(504)
            ->assertJsonPath('message', 'This range has too many readings to load in time. Choose a shorter range.');
        // Other runtime failures keep the generic answer.
        $this->getJson($this->prefix.'/devices/'.$device->uuid.'/measurements/history?'.http_build_query($range))
            ->assertStatus(503)
            ->assertJsonPath('message', 'The device runtime could not complete this request.');
    }

    public function test_counter_increase_proxies_calendar_buckets_for_counters_only(): void
    {
        $device = $this->active($this->configured('three-phase-energy-meter'));
        $energy = '20000000-0000-4000-8000-000000000004';
        Http::swap(new Factory);
        Http::fake([
            'http://runtime:8081/internal/measurements/history*' => Http::response(['data' => []]),
            'http://runtime:8081/internal/measurements/increase*' => Http::response([
                'data' => ['bucket' => '1d', 'timezone' => 'America/Vancouver', 'unit' => 'kWh', 'points' => [['at' => '2026-09-12T00:00:00-07:00', 'increase' => 12.5, 'samples' => 96, 'resets' => 0, 'partial' => false]]],
            ]),
        ]);
        $query = fn (array $values) => $this->prefix.'/devices/'.$device->uuid.'/measurements/increase?'.http_build_query([
            'parameter_uuid' => $energy, 'from' => '2026-09-12T07:00:00Z', 'to' => '2026-09-19T07:00:00Z', 'bucket' => '1d', 'timezone' => 'America/Vancouver', ...$values,
        ]);

        $this->getJson($query([]))->assertOk()->assertJsonPath('data.points.0.increase', 12.5);
        // Without a time zone, buckets follow the device's site, then its organization.
        $this->organization->forceFill(['timezone' => 'America/Halifax'])->save();
        $this->getJson($this->prefix.'/devices/'.$device->uuid.'/measurements/increase?'.http_build_query(['parameter_uuid' => $energy, 'from' => '2026-09-12T07:00:00Z', 'to' => '2026-09-19T07:00:00Z', 'bucket' => '1d']))->assertOk();
        Http::assertSent(fn ($request) => str_contains($request->url(), '/internal/measurements/increase') && str_contains($request->url(), 'timezone=America%2FHalifax'));
        $this->getJson($this->prefix.'/devices/'.$device->uuid.'/measurements/history?'.http_build_query(['parameter_uuid' => $energy, 'from' => '2026-09-12T07:00:00Z', 'to' => '2026-09-13T07:00:00Z']))->assertOk();
        // Portal charts opt into observed time and joined configuration revisions.
        Http::assertSent(fn ($request) => str_contains($request->url(), '/internal/measurements/history')
            && str_contains($request->url(), 'time_basis=observed') && str_contains($request->url(), 'merge_configurations=1'));
        // Voltage is a measurement, not a counter.
        $this->getJson($query(['parameter_uuid' => '20000000-0000-4000-8000-000000000001']))->assertUnprocessable()->assertJsonValidationErrors('parameter_uuid');
        $this->getJson($query(['bucket' => '2d']))->assertUnprocessable()->assertJsonValidationErrors('bucket');
        $this->getJson($query(['timezone' => 'Mars/Olympus']))->assertUnprocessable()->assertJsonValidationErrors('timezone');

        Http::assertSent(fn ($request) => str_contains($request->url(), '/internal/measurements/increase')
            && str_contains($request->url(), 'timezone=America%2FVancouver')
            && str_contains($request->url(), 'bucket=1d')
            && str_contains($request->url(), 'retention_days=400')
            && ! str_contains($request->url(), 'rollover_at=1'));
    }

    public function test_counter_settings_accept_reset_policies_and_rollover_only(): void
    {
        $validator = app(ProfileConfigurationValidator::class);
        $this->assertSame([], $validator->errors(['counter_config' => ['monotonic' => true, 'reset_behavior' => 'diagnose', 'rollover_at' => 99999999]]));
        $this->assertSame([], $validator->errors(['counter_config' => ['reset_behavior' => 'new_segment']]));
        $this->assertArrayHasKey('counter_config.reset_behavior', $validator->errors(['counter_config' => ['reset_behavior' => 'ignore']]));
        $this->assertArrayHasKey('counter_config.rollover_at', $validator->errors(['counter_config' => ['rollover_at' => 0]]));
    }

    public function test_retention_overrides_persist_require_reduction_confirmation_and_are_platform_only(): void
    {
        $global = '/api/v1/admin/settings/telemetry-retention';
        $org = '/api/v1/admin/organizations/'.$this->organization->uuid.'/settings/telemetry-retention';
        $this->getJson($global)->assertOk()->assertJsonPath('data.days', 400)->assertJsonPath('data.source', 'default');
        $this->putJson($global, ['days' => 500, 'revision' => 0])->assertOk()->assertJsonPath('data.days', 500);
        $this->putJson($org, ['days' => 30, 'revision' => 0])->assertUnprocessable();
        $this->putJson($org, ['days' => 30, 'revision' => 0, 'confirmed_reduction' => true])->assertOk()->assertJsonPath('data.source', 'organization');
        $this->putJson($global, ['days' => 180, 'revision' => 0])->assertConflict();
        $this->getJson($org)->assertJsonPath('data.days', 30);
        $this->putJson($org, ['days' => null, 'revision' => 1])->assertOk()->assertJsonPath('data.days', 500)->assertJsonPath('data.source', 'platform');
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
        $this->assertSameJsonDocument($definition, $artifact->fresh()->definition);
    }
}
