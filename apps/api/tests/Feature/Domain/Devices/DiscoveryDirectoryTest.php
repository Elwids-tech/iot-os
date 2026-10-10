<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Devices;

use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DiscoveryCandidate;
use App\Domain\Devices\Models\SparkplugConnection;
use App\Domain\Devices\Models\SparkplugGateway;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

final class DiscoveryDirectoryTest extends TestCase
{
    use RefreshDatabase;

    public function test_candidates_filter_by_status_and_sources_no_device_has_reserved(): void
    {
        $this->seed(DatabaseSeeder::class);
        $organization = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->actingAs(User::where('email', 'super-admin@example.test')->firstOrFail(), 'sanctum');
        $prefix = '/api/v1/organizations/'.$organization->uuid;
        $connection = SparkplugConnection::create(['organization_id' => $organization->id, 'name' => 'Connection', 'group_id' => 'plant', 'host_id' => 'plant', 'username' => 'plant', 'password' => 'test-secret', 'status' => 'ready']);
        $gateway = SparkplugGateway::create(['organization_id' => $organization->id, 'sparkplug_connection_id' => $connection->id, 'name' => 'Gateway', 'edge_node_id' => 'edge']);
        $candidate = fn (string $source, string $status) => DiscoveryCandidate::create(['organization_id' => $organization->id, 'sparkplug_gateway_id' => $gateway->id, 'source_device_id' => $source, 'status' => $status, 'metrics' => []]);
        $candidate('waiting-1', 'pending');
        $candidate('waiting-2', 'pending');
        $reserved = $candidate('onboarding', 'pending');
        $candidate('ignored', 'rejected');
        $candidate('approved', 'approved');
        $device = Device::where('uuid', $this->postJson($prefix.'/devices', ['name' => 'Meter', 'code' => 'meter-1'])->assertCreated()->json('data.uuid'))->firstOrFail();
        $device->forceFill(['reserved_source_uuid' => $reserved->uuid])->save();

        $this->getJson($prefix.'/discovery-candidates?per_page=1')->assertOk()->assertJsonPath('meta.total', 5);
        $this->getJson($prefix.'/discovery-candidates?status=pending&per_page=1')->assertOk()->assertJsonPath('meta.total', 3);
        $this->getJson($prefix.'/discovery-candidates?status=pending&unassigned=1')->assertOk()->assertJsonPath('meta.total', 2)
            ->assertJsonPath('data.0.source_device_id', 'waiting-1')->assertJsonPath('data.1.source_device_id', 'waiting-2');
        $this->getJson($prefix.'/discovery-candidates?status=rejected')->assertOk()->assertJsonPath('meta.total', 1);
        $this->getJson($prefix.'/discovery-candidates?status=unknown')->assertUnprocessable();
        $this->getJson($prefix.'/discovery-candidates?unassigned=maybe')->assertUnprocessable();
    }
}
