<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Firmware;

use App\Domain\DeviceProfiles\Enums\DeviceProfileStatus;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceOnboarding;
use App\Domain\Devices\Models\SparkplugConnection;
use App\Domain\Devices\Models\SparkplugGateway;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Filesystem\Filesystem;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Phar;
use PharData;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;

/** Published fixture profiles, a provisioned gateway and archive helpers for the firmware tests. */
trait FirmwareTestSupport
{
    protected Organization $organization;

    protected string $prefix;

    protected string $ca;

    protected function setUpFirmware(): void
    {
        $this->seed(DatabaseSeeder::class);
        $this->organization = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->prefix = '/api/v1/organizations/'.$this->organization->uuid;
        $this->actAs(User::where('is_super_admin', true)->firstOrFail());
        $this->ca = tempnam(sys_get_temp_dir(), 'iot-firmware-ca-');
        $key = openssl_pkey_new(['private_key_bits' => 2048]);
        openssl_x509_export(openssl_csr_sign(openssl_csr_new(['commonName' => 'Firmware test CA'], $key), null, $key, 1), $certificate);
        file_put_contents($this->ca, $certificate);
        config(['devices.ca_file' => $this->ca, 'devices.broker_public_url' => 'ssl://mqtt.example.test:8883', 'devices.broker_admin_token' => 'test-token']);
        Http::fake(['*' => Http::response([], 200)]);
    }

    protected function tearDownFirmware(): void
    {
        if (isset($this->ca) && is_file($this->ca)) {
            unlink($this->ca);
        }
    }

    protected function actAs(User|string $user): void
    {
        $this->actingAs($user instanceof User ? $user : User::where('email', $user)->firstOrFail(), 'sanctum');
    }

    /**
     * Publishes a fixture profile's revisions into an organization.
     *
     * @return list<string> artifact UUIDs by revision, oldest first
     */
    protected function publish(string $fixture, ?Organization $organization = null, ?string $code = null): array
    {
        $organization ??= $this->organization;
        $data = json_decode((string) file_get_contents(base_path('../../contracts/firmware/fixtures/profiles/'.$fixture.'.json')), true);
        $code ??= $data['profile']['code'];
        $last = end($data['revisions'])['revision'];
        $profile = DeviceProfile::create([
            'organization_id' => $organization->id, 'code' => $code, 'name' => $data['profile']['name'], 'category' => 'test',
            'status' => DeviceProfileStatus::PUBLISHED, 'revision' => $last, 'published_at' => now(),
        ]);
        $uuids = [];
        foreach ($data['revisions'] as $revision) {
            $definition = $revision['definition'];
            $definition['profile']['code'] = $code;
            $definition['profile']['uuid'] = $profile->uuid;
            $uuids[] = DeviceProfileArtifact::create([
                'device_profile_id' => $profile->id, 'revision' => $revision['revision'], 'definition' => $definition,
                'definition_hash' => hash('sha256', json_encode($definition)), 'status' => $revision['revision'] === $last ? 'active' : 'retired',
                'compiled_at' => now(),
            ])->uuid;
        }

        return $uuids;
    }

    protected function gateway(?Organization $organization = null): SparkplugGateway
    {
        $organization ??= $this->organization;
        $connection = SparkplugConnection::create(['organization_id' => $organization->id, 'name' => 'Firmware connection', 'group_id' => 'firmware-plant',
            'host_id' => 'firmware-host', 'username' => 'plant-'.Str::random(8), 'password' => 'connection-secret-'.Str::random(16), 'status' => 'ready']);

        return SparkplugGateway::create(['uuid' => (string) Str::uuid(), 'organization_id' => $organization->id, 'sparkplug_connection_id' => $connection->id,
            'name' => 'Line 2 gateway', 'edge_node_id' => 'line2-edge', 'username' => 'edge-'.Str::uuid(), 'password' => 'gateway-secret-'.Str::random(32)]);
    }

    /** A provisioned direct device from the onboarding flow, with its credentials. */
    protected function directDevice(string $artifactUuid): array
    {
        $setup = $this->postJson($this->prefix.'/device-onboardings', [
            'request_uuid' => (string) Str::uuid(), 'name' => 'Pump relay', 'artifact_uuid' => $artifactUuid, 'mode' => 'direct',
        ])->assertCreated()->json('data');
        $this->postJson($this->prefix.'/devices/'.$setup['device']['uuid'].'/onboarding/provision')->assertOk();
        $device = Device::where('uuid', $setup['device']['uuid'])->firstOrFail();

        return ['device' => $device, 'gateway' => DeviceOnboarding::where('device_id', $device->id)->firstOrFail()->gateway];
    }

    /** @return array<string, string> archive path => contents */
    protected function unzip(string $base64): array
    {
        $directory = sys_get_temp_dir().'/iot-firmware-test-'.bin2hex(random_bytes(8));
        mkdir($directory, 0700);
        try {
            file_put_contents($directory.'/archive.zip', base64_decode($base64));
            (new PharData($directory.'/archive.zip', 0, null, Phar::ZIP))->extractTo($directory.'/out');
            $files = [];
            foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($directory.'/out', RecursiveDirectoryIterator::SKIP_DOTS)) as $file) {
                $files[substr($file->getPathname(), strlen($directory.'/out/'))] = (string) file_get_contents($file->getPathname());
            }
            ksort($files);

            return $files;
        } finally {
            (new Filesystem)->deleteDirectory($directory);
        }
    }

    /**
     * Strings that must never appear in a starter: the gateway's and the connection's
     * credentials, the broker host, its identity in Sparkplug, and certificates.
     *
     * @return list<string>
     */
    protected function secrets(SparkplugGateway $gateway): array
    {
        return array_values(array_filter([
            $gateway->username, $gateway->password, $gateway->connection->username, $gateway->connection->password,
            'mqtt.example.test', 'BEGIN CERTIFICATE', $gateway->connection->group_id, $gateway->edge_node_id,
        ]));
    }
}
