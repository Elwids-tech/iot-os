<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Devices;

use App\Domain\DeviceProfiles\Actions\PrepareGatewayHealthProfile;
use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceOnboarding;
use App\Domain\Devices\Models\DiscoveryCandidate;
use App\Domain\Devices\Models\SparkplugConnection;
use App\Domain\Devices\Models\SparkplugGateway;
use App\Domain\Devices\Services\DeviceConfigurationService;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

/** Onboarding a gateway's own source, its node metrics, under an existing gateway (spec 026 US6, R16). */
final class GatewayNodeOnboardingTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private string $prefix;

    private DeviceProfileArtifact $artifact;

    private SparkplugGateway $gateway;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->organization = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $actor = User::where('email', 'super-admin@example.test')->firstOrFail();
        $this->actingAs($actor, 'sanctum');
        $this->prefix = '/api/v1/organizations/'.$this->organization->uuid;
        Http::fake(['*' => Http::response([], 200)]);
        $this->artifact = app(PrepareGatewayHealthProfile::class)->handle($this->organization, $actor)['artifact'];
        $connection = SparkplugConnection::create(['organization_id' => $this->organization->id, 'name' => 'Plant broker', 'group_id' => 'plant', 'host_id' => 'plant-host', 'username' => 'plant-host', 'password' => 'test-secret', 'status' => 'ready']);
        $this->gateway = SparkplugGateway::create(['organization_id' => $this->organization->id, 'sparkplug_connection_id' => $connection->id, 'name' => 'Line 1 gateway', 'edge_node_id' => 'Line-1', 'username' => 'edge-line-1', 'password' => 'gateway-secret-value']);
    }

    private function input(array $overrides = []): array
    {
        return ['request_uuid' => (string) Str::uuid(), 'name' => 'Line 1 gateway health', 'artifact_uuid' => $this->artifact->uuid,
            'mode' => 'gateway', 'gateway_uuid' => $this->gateway->uuid, 'source' => 'node', ...$overrides];
    }

    /** The gateway's own birth, as the SDK announces its default health metrics. */
    private function nodeSource(): DiscoveryCandidate
    {
        $metrics = [['name' => 'uptime', 'datatype' => 'Int64', 'value' => 42], ['name' => 'connection_type', 'datatype' => 'String', 'value' => 'ethernet'],
            ['name' => 'signal_strength', 'datatype' => 'Double', 'value' => null], ['name' => 'firmware_version', 'datatype' => 'String', 'value' => '1.0.0'],
            ['name' => 'sdk_version', 'datatype' => 'String', 'value' => '0.1.0'], ['name' => 'devices_configured', 'datatype' => 'Int64', 'value' => 2],
            ['name' => 'devices_online', 'datatype' => 'Int64', 'value' => 2], ['name' => 'reconnects', 'datatype' => 'Int64', 'value' => 0]];

        return DiscoveryCandidate::create(['organization_id' => $this->organization->id, 'sparkplug_gateway_id' => $this->gateway->id, 'source_device_id' => '',
            'metrics' => $metrics, 'presence' => 'online', 'session_id' => 'session-test', 'birth_revision' => 1, 'last_seen_at' => now()]);
    }

    /** Maps every health parameter to the metric of the same name and returns the compiled configuration. */
    private function configure(string $deviceUuid, DiscoveryCandidate $candidate): array
    {
        $device = Device::where('uuid', $deviceUuid)->firstOrFail();
        $mappings = array_map(fn (array $p): array => ['parameter_uuid' => $p['uuid'], 'metric' => $p['key']], $this->artifact->definition['parameters']);
        $this->putJson($this->prefix.'/devices/'.$deviceUuid.'/configuration', ['draft_revision' => $device->draft_revision, 'artifact_uuid' => $this->artifact->uuid,
            'candidate_uuid' => $candidate->uuid, 'birth_revision' => 1, 'mappings' => $mappings])->assertOk();

        return app(DeviceConfigurationService::class)->compile($device->fresh());
    }

    public function test_the_node_source_onboards_under_the_existing_gateway_and_compiles_an_empty_device_id(): void
    {
        $candidate = $this->nodeSource();
        $setup = $this->postJson($this->prefix.'/device-onboardings', $this->input())->assertCreated()
            ->assertJsonPath('data.mode', 'gateway')->assertJsonPath('data.source_device_id', '')
            ->assertJsonPath('data.gateway.uuid', $this->gateway->uuid)->assertJsonPath('data.candidate.uuid', $candidate->uuid)->json('data');
        $this->assertTrue($setup['provisioned']);
        $this->assertSame(1, SparkplugGateway::count());
        $this->assertSame(1, SparkplugConnection::count());
        $this->assertSame('', DeviceOnboarding::where('uuid', $setup['uuid'])->value('source_device_id'));

        $compiled = $this->configure($setup['device']['uuid'], $candidate);
        $this->assertSame('', $compiled['source']['device_id']);
        $this->assertSame(['plant', 'Line-1'], [$compiled['source']['group_id'], $compiled['source']['edge_node_id']]);
        $this->assertCount(8, $compiled['mappings']);
    }

    public function test_a_second_setup_and_ambiguous_requests_are_refused(): void
    {
        $input = $this->input();
        $first = $this->postJson($this->prefix.'/device-onboardings', $input)->assertCreated()->json('data');
        // A retry of the same request resumes it; another request for the node is the existing one-setup rule.
        $this->postJson($this->prefix.'/device-onboardings', $input)->assertCreated()->assertJsonPath('data.device.uuid', $first['device']['uuid']);
        $this->postJson($this->prefix.'/device-onboardings', $this->input())->assertConflict();

        $this->postJson($this->prefix.'/device-onboardings', $this->input(['source_device_id' => 'meter-1']))->assertUnprocessable()->assertJsonValidationErrors('source');
        $this->postJson($this->prefix.'/device-onboardings', $this->input(['source' => null]))->assertUnprocessable()->assertJsonValidationErrors('source_device_id');
        $this->postJson($this->prefix.'/device-onboardings', $this->input(['source' => 'gateway']))->assertUnprocessable()->assertJsonValidationErrors('source');
        $this->postJson($this->prefix.'/device-onboardings', $this->input(['mode' => 'direct', 'gateway_uuid' => null]))->assertUnprocessable()->assertJsonValidationErrors('source');
        $this->assertSame(1, DeviceOnboarding::count());
    }

    public function test_another_organizations_gateway_gets_404(): void
    {
        $northstar = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $connection = SparkplugConnection::create(['organization_id' => $northstar->id, 'name' => 'Other broker', 'group_id' => 'other', 'host_id' => 'other-host', 'username' => 'other-host', 'password' => 'test-secret', 'status' => 'ready']);
        $other = SparkplugGateway::create(['organization_id' => $northstar->id, 'sparkplug_connection_id' => $connection->id, 'name' => 'Other gateway', 'edge_node_id' => 'Other-1', 'username' => 'edge-other-1', 'password' => 'other-secret-value']);
        $this->postJson($this->prefix.'/device-onboardings', $this->input(['gateway_uuid' => $other->uuid]))->assertNotFound();
        $this->assertSame(0, DeviceOnboarding::count());
    }

    public function test_the_discovery_path_still_attaches_a_node_source(): void
    {
        $candidate = $this->nodeSource();
        $device = $this->postJson($this->prefix.'/devices', ['name' => 'Gateway health from discovery', 'code' => 'line-1-health'])->assertCreated()->json('data');
        $compiled = $this->configure($device['uuid'], $candidate);
        $this->assertSame('', $compiled['source']['device_id']);
        $this->assertSame($candidate->uuid, Device::where('uuid', $device['uuid'])->value('reserved_source_uuid'));
        // The node is then taken, so onboarding it again is refused.
        $this->postJson($this->prefix.'/device-onboardings', $this->input())->assertConflict();
    }
}
