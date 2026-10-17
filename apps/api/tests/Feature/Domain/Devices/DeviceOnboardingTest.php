<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Devices;

use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceOnboarding;
use App\Domain\Devices\Models\DiscoveryCandidate;
use App\Domain\Devices\Models\SparkplugGateway;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Factory;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

final class DeviceOnboardingTest extends TestCase
{
    use RefreshDatabase;

    private string $prefix;

    private string $artifact;

    private string $ca;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $org = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->actingAs(User::where('is_super_admin', true)->firstOrFail(), 'sanctum');
        $this->prefix = '/api/v1/organizations/'.$org->uuid;
        Artisan::call('devices:prepare-water-meter-profile');
        $this->artifact = DeviceProfile::where('code', 'water-meter-onboarding-example')->firstOrFail()->artifacts()->firstOrFail()->uuid;
        $this->ca = tempnam(sys_get_temp_dir(), 'iot-public-ca-');
        $key = openssl_pkey_new(['private_key_bits' => 2048]);
        $csr = openssl_csr_new(['commonName' => 'Test CA'], $key);
        openssl_x509_export(openssl_csr_sign($csr, null, $key, 1), $certificate);
        file_put_contents($this->ca, $certificate);
        config(['devices.ca_file' => $this->ca, 'devices.broker_public_url' => 'ssl://mqtt.example.test:8883', 'devices.broker_admin_token' => 'test-token']);
        Http::fake(['*' => Http::response([], 200)]);
    }

    protected function tearDown(): void
    {
        if (isset($this->ca)) {
            unlink($this->ca);
        }
        parent::tearDown();
    }

    private function input(): array
    {
        return ['request_uuid' => (string) Str::uuid(), 'name' => 'Water meter', 'artifact_uuid' => $this->artifact, 'mode' => 'direct'];
    }

    private function start(?array $input = null): array
    {
        return $this->postJson($this->prefix.'/device-onboardings', $input ?? $this->input())->assertCreated()->json('data');
    }

    public function test_setup_is_resumable_idempotent_and_does_not_expose_credentials(): void
    {
        $input = $this->input();
        $first = $this->start($input);
        $again = $this->start($input);
        $this->assertSame($first['device']['uuid'], $again['device']['uuid']);
        $this->assertSame(1, DeviceOnboarding::count());
        $this->assertSame('registered', $first['device']['lifecycle']);
        $this->assertFalse($first['provisioned']);
        $response = $this->getJson($this->prefix.'/devices/'.$first['device']['uuid'].'/onboarding')->assertOk();
        $password = SparkplugGateway::where('uuid', $first['gateway']['uuid'])->firstOrFail()->password;
        $this->assertStringNotContainsString($password, $response->getContent());
        $this->postJson($this->prefix.'/device-onboardings', [...$input, 'name' => 'Changed'])->assertConflict();
    }

    public function test_kit_requires_provisioning_contains_public_ca_and_has_no_cache_headers(): void
    {
        $setup = $this->start();
        $url = $this->prefix.'/devices/'.$setup['device']['uuid'];
        $this->postJson($url.'/connection-kit')->assertUnprocessable();
        $this->postJson($url.'/onboarding/provision')->assertOk()->assertJsonPath('data.provisioned', true);
        $kit = $this->postJson($url.'/connection-kit')->assertOk();
        $this->assertStringContainsString('no-store', $kit->headers->get('Cache-Control'));
        $download = $this->get($url.'/connection-kit/archive')->assertOk()->assertHeader('Content-Type', 'application/zip');
        $this->assertStringStartsWith('PK', $download->getContent());
        $this->assertStringContainsString('no-store', $download->headers->get('Cache-Control'));
        $this->assertStringContainsString('attachment;', $download->headers->get('Content-Disposition'));
        $this->assertSame(file_get_contents($this->ca), $kit->json('data.ca_certificate'));
        $path = sys_get_temp_dir().'/test-kit-'.Str::uuid().'.zip';
        try {
            file_put_contents($path, base64_decode($kit->json('data.archive_base64')));
            $zip = new \PharData($path);
            $config = json_decode($zip['device-config.json']->getContent(), true);
            $this->assertSame('ssl://mqtt.example.test:8883', $config['broker_url']);
            $this->assertSame(['flow_rate', 'total_volume'], array_column($config['metrics'], 'name'));
            $this->assertSame('ca.crt', $config['ca_file']);
            $this->assertSame(file_get_contents($this->ca), $zip['ca.crt']->getContent());
            $this->assertTrue(isset($zip['quickstart.md']));
            $this->assertSame(3, count($zip));
        } finally {
            unlink($path);
        }
        $audit = DB::table('device_audit_events')->where('action', 'device.connection-kit.downloaded')->first();
        $this->assertNotNull($audit);
        $this->assertStringNotContainsString($config['password'], json_encode($audit));
    }

    public function test_failed_provisioning_retries_same_identity_without_secret_diagnostics(): void
    {
        $setup = $this->start();
        $url = $this->prefix.'/devices/'.$setup['device']['uuid'];
        $gateway = SparkplugGateway::where('uuid', $setup['gateway']['uuid'])->firstOrFail();
        $password = $gateway->password;
        Http::swap(new Factory);
        Http::fake(['*' => Http::response(['message' => $password], 503)]);
        $this->postJson($url.'/onboarding/provision')->assertStatus(202)->assertJsonPath('data.provisioned', false);
        Http::swap(new Factory);
        Http::fake(['*' => Http::response([], 200)]);
        $this->postJson($url.'/onboarding/provision')->assertOk()->assertJsonPath('data.provisioned', true)->assertJsonPath('data.diagnostic', null);
        $this->assertSame($password, $gateway->fresh()->password);
    }

    public function test_tenant_boundaries_and_connection_permission_protect_kits(): void
    {
        $setup = $this->start();
        $other = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $this->getJson('/api/v1/organizations/'.$other->uuid.'/devices/'.$setup['device']['uuid'].'/connection-kit/archive')->assertNotFound();
        foreach (['/onboarding', '/connection-kit', '/onboarding/provision'] as $suffix) {
            $url = '/api/v1/organizations/'.$other->uuid.'/devices/'.$setup['device']['uuid'].$suffix;
            ($suffix === '/onboarding' ? $this->getJson($url) : $this->postJson($url))->assertNotFound();
        }
        $user = User::factory()->create();
        $org = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $org->users()->attach($user->id);
        $this->actingAs($user, 'sanctum');
        $this->getJson($this->prefix.'/devices/'.$setup['device']['uuid'].'/connection-kit/archive')->assertForbidden();
        $this->postJson($this->prefix.'/devices/'.$setup['device']['uuid'].'/connection-kit')->assertForbidden();
        $this->postJson($this->prefix.'/device-onboardings', $this->input())->assertForbidden();
    }

    public function test_gateway_mode_never_exports_shared_gateway_credentials_and_reserves_source(): void
    {
        $direct = $this->start();
        $this->postJson($this->prefix.'/devices/'.$direct['device']['uuid'].'/onboarding/provision')->assertOk();
        $input = [...$this->input(), 'mode' => 'gateway', 'gateway_uuid' => $direct['gateway']['uuid'], 'source_device_id' => 'downstream-meter'];
        $setup = $this->start($input);
        $this->assertTrue($setup['provisioned']);
        $this->postJson($this->prefix.'/devices/'.$setup['device']['uuid'].'/connection-kit')->assertUnprocessable();
        $this->postJson($this->prefix.'/device-onboardings', [...$input, 'request_uuid' => (string) Str::uuid()])->assertConflict();
    }

    public function test_discovery_reports_sources_claimed_by_a_device_setup(): void
    {
        $setup = $this->start();
        $gateway = SparkplugGateway::where('uuid', $setup['gateway']['uuid'])->firstOrFail();
        $candidate = DiscoveryCandidate::create(['organization_id' => $gateway->organization_id, 'sparkplug_gateway_id' => $gateway->id, 'source_device_id' => '', 'birth_revision' => 1, 'metrics' => []]);
        $other = DiscoveryCandidate::create(['organization_id' => $gateway->organization_id, 'sparkplug_gateway_id' => $gateway->id, 'source_device_id' => 'unclaimed', 'birth_revision' => 1, 'metrics' => []]);
        $rows = collect($this->getJson($this->prefix.'/discovery-candidates')->assertOk()->json('data'))->keyBy('uuid');
        $this->assertNull($rows[$candidate->uuid]['assigned_device_uuid']);
        $this->assertSame($setup['device']['uuid'], $rows[$candidate->uuid]['setup_device_uuid']);
        $this->assertNull($rows[$other->uuid]['setup_device_uuid']);
        $this->getJson($this->prefix.'/discovery-candidates?available=1')->assertOk()->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.uuid', $other->uuid);
        $this->getJson($this->prefix.'/devices/'.$setup['device']['uuid'].'/onboarding')->assertOk()->assertJsonPath('data.candidate.setup_device_uuid', $setup['device']['uuid']);
        $this->patchJson($this->prefix.'/discovery-candidates/'.$candidate->uuid, ['status' => 'rejected', 'birth_revision' => 1])->assertUnprocessable();
        $this->patchJson($this->prefix.'/discovery-candidates/'.$other->uuid, ['status' => 'rejected', 'birth_revision' => 1])->assertOk();
        $another = $this->postJson($this->prefix.'/devices', ['name' => 'Another meter', 'code' => 'another-meter'])->assertCreated()->json('data');
        $this->putJson($this->prefix.'/devices/'.$another['uuid'].'/configuration', ['draft_revision' => $another['draft_revision'], 'artifact_uuid' => $this->artifact, 'candidate_uuid' => $candidate->uuid, 'birth_revision' => 1, 'mappings' => []])
            ->assertConflict()->assertJsonPath('message', 'This source is being set up as another device.');
        $own = Device::where('uuid', $setup['device']['uuid'])->firstOrFail();
        $this->putJson($this->prefix.'/devices/'.$own->uuid.'/configuration', ['draft_revision' => $own->draft_revision, 'artifact_uuid' => $this->artifact, 'candidate_uuid' => $candidate->uuid, 'birth_revision' => 1, 'mappings' => []])->assertOk();
        Device::where('uuid', $setup['device']['uuid'])->update(['reserved_source_uuid' => null]);

        Device::where('uuid', $setup['device']['uuid'])->update(['reserved_source_uuid' => $candidate->uuid]);
        $this->getJson($this->prefix.'/discovery-candidates/'.$candidate->uuid)->assertOk()
            ->assertJsonPath('data.assigned_device_uuid', $setup['device']['uuid'])->assertJsonPath('data.setup_device_uuid', null);

        Device::where('uuid', $setup['device']['uuid'])->update(['reserved_source_uuid' => null, 'lifecycle' => 'archived']);
        $this->getJson($this->prefix.'/discovery-candidates/'.$candidate->uuid)->assertOk()->assertJsonPath('data.setup_device_uuid', null);
        $this->patchJson($this->prefix.'/discovery-candidates/'.$candidate->uuid, ['status' => 'rejected', 'birth_revision' => 1])->assertOk();
    }

    public function test_missing_certificate_is_actionable_and_archive_blocks_kit_download(): void
    {
        $setup = $this->start();
        $url = $this->prefix.'/devices/'.$setup['device']['uuid'];
        $this->postJson($url.'/onboarding/provision')->assertOk();
        config(['devices.ca_file' => '/missing/ca.crt']);
        $this->postJson($url.'/connection-kit')->assertStatus(503);
        Device::where('uuid', $setup['device']['uuid'])->update(['lifecycle' => 'archived']);
        $this->postJson($url.'/connection-kit')->assertUnprocessable();
    }
}
