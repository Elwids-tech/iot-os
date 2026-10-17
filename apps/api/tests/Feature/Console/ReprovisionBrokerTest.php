<?php

declare(strict_types=1);

namespace Tests\Feature\Console;

use App\Domain\Devices\Models\SparkplugConnection;
use App\Domain\Devices\Models\SparkplugGateway;
use App\Domain\Shared\Models\Organization;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

final class ReprovisionBrokerTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_rejected_identity_does_not_stop_the_others(): void
    {
        config(['devices.broker_admin_url' => 'http://broker-admin.test', 'devices.broker_admin_token' => 'test-token']);
        $organization = Organization::factory()->create();
        $connection = SparkplugConnection::create(['organization_id' => $organization->id, 'name' => 'Plant', 'group_id' => 'plant', 'host_id' => 'plant-host', 'username' => 'host-plant', 'password' => str_repeat('p', 32)]);
        $legacy = SparkplugGateway::create(['organization_id' => $organization->id, 'sparkplug_connection_id' => $connection->id, 'name' => 'Legacy', 'edge_node_id' => 'legacy', 'username' => 'gateway-legacy', 'password' => str_repeat('l', 32)]);
        SparkplugGateway::create(['organization_id' => $organization->id, 'sparkplug_connection_id' => $connection->id, 'name' => 'Edge', 'edge_node_id' => 'edge', 'username' => 'edge-current', 'password' => str_repeat('e', 32)]);
        // broker-admin rejects usernames outside its allowlist with 400.
        Http::fake(fn (Request $request) => Http::response(null, $request['username'] === 'gateway-legacy' ? 400 : 204));

        $this->artisan('devices:reprovision-broker')
            ->expectsOutput('Reprovisioned 1 connections and 1 managed gateways.')
            ->expectsOutputToContain("gateway {$legacy->uuid}")
            ->assertFailed();

        Http::assertSentCount(3);
        Http::assertSent(fn (Request $request) => $request['username'] === 'edge-current');
        $this->assertSame('ready', $connection->fresh()->status);
    }

    public function test_every_identity_succeeding_exits_cleanly(): void
    {
        config(['devices.broker_admin_url' => 'http://broker-admin.test', 'devices.broker_admin_token' => 'test-token']);
        $organization = Organization::factory()->create();
        SparkplugConnection::create(['organization_id' => $organization->id, 'name' => 'Plant', 'group_id' => 'plant', 'host_id' => 'plant-host', 'username' => 'host-plant', 'password' => str_repeat('p', 32)]);
        Http::fake(fn () => Http::response(null, 204));

        $this->artisan('devices:reprovision-broker')
            ->expectsOutput('Reprovisioned 1 connections and 0 managed gateways.')
            ->assertSuccessful();
    }
}
