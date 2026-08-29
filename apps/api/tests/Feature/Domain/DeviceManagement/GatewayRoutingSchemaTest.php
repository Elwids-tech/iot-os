<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\DeviceManagement;

use App\Domain\DeviceManagement\Models\Device;
use App\Domain\DeviceManagement\Models\Gateway;
use App\Domain\DeviceProfile\Models\DeviceProfile;
use App\Domain\DeviceProfile\Models\DeviceProfileVersion;
use App\Domain\DeviceProfile\Models\TransportBinding;
use App\Domain\DeviceProfile\Models\TransportBindingVersion;
use App\Domain\Shared\Models\Organization;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

final class GatewayRoutingSchemaTest extends TestCase
{
    use RefreshDatabase;

    public function test_gateway_routing_schema_exposes_tenant_keys_runtime_pins_and_resolution_indexes(): void
    {
        $this->assertTrue(Schema::hasColumns('gateways', [
            'uuid',
            'organization_id',
            'key',
            'mqtt_client_id',
            'revision',
        ]));
        $this->assertTrue(Schema::hasColumns('gateway_routes', [
            'uuid',
            'organization_id',
            'gateway_id',
            'device_id',
            'device_profile_version_id',
            'transport_binding_version_id',
            'revision',
            'route_path',
            'topic_variables',
            'inbound_scopes',
            'enabled',
        ]));
        $this->assertTrue(Schema::hasColumns('device_definition_assignments', [
            'gateway_route_id',
            'profile_artifact_hash',
            'binding_artifact_hash',
            'route_source_hash',
            'runtime_bundle_hash',
            'runtime_bundle',
            'runtime_compiled_at',
        ]));
        $this->assertFalse(Schema::hasColumn('device_definition_assignments', 'compatibility_state'));
        $this->assertFalse(Schema::hasColumn('devices', 'identity_model'));
        $this->assertFalse(Schema::hasColumn('device_profile_versions', 'contract_version'));
        $this->assertFalse(Schema::hasColumn('transport_binding_versions', 'contract_version'));

        $indexes = collect(Schema::getIndexes('gateway_routes'))->pluck('name');
        $this->assertContains('gateway_routes_resolve_index', $indexes);
        $this->assertContains('gateway_routes_device_index', $indexes);
        $this->assertContains('gateway_routes_profile_version_index', $indexes);
        $this->assertContains('gateway_routes_binding_version_index', $indexes);
    }

    public function test_composite_foreign_keys_reject_a_cross_tenant_gateway_route(): void
    {
        $routeOrganization = Organization::factory()->create();
        $deviceOrganization = Organization::factory()->create();
        $gateway = Gateway::query()->create([
            'organization_id' => $routeOrganization->id,
            'key' => 'route_gateway',
            'name' => 'Route Gateway',
            'mqtt_client_id' => 'route-gateway-client',
        ]);
        $device = Device::query()->create([
            'organization_id' => $deviceOrganization->id,
            'external_id' => 'foreign-device',
            'name' => 'Foreign Device',
        ]);
        [$profileVersion, $bindingVersion] = $this->definitionVersions($routeOrganization);

        $this->expectException(QueryException::class);

        DB::table('gateway_routes')->insert([
            'uuid' => '70000000-0000-4000-8000-000000000001',
            'organization_id' => $routeOrganization->id,
            'gateway_id' => $gateway->id,
            'device_id' => $device->id,
            'device_profile_version_id' => $profileVersion->id,
            'transport_binding_version_id' => $bindingVersion->id,
            'revision' => 1,
            'route_path' => 'foreign/device',
            'topic_variables' => '{}',
            'inbound_scopes' => '[]',
            'enabled' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** @return array{DeviceProfileVersion, TransportBindingVersion} */
    private function definitionVersions(Organization $organization): array
    {
        $profile = DeviceProfile::query()->create([
            'organization_id' => $organization->id,
            'key' => 'schema_profile_'.strtolower(substr($organization->uuid, 0, 6)),
            'name' => 'Schema Profile',
        ]);
        $profileVersion = $profile->versions()->create([
            'organization_id' => $organization->id,
            'version' => 1,
            'definition' => ['version' => 1, 'components' => []],
        ]);
        $binding = TransportBinding::query()->create([
            'organization_id' => $organization->id,
            'device_profile_id' => $profile->id,
            'key' => 'schema_binding_'.strtolower(substr($organization->uuid, 0, 6)),
            'name' => 'Schema Binding',
        ]);
        $bindingVersion = $binding->versions()->create([
            'organization_id' => $organization->id,
            'device_profile_version_id' => $profileVersion->id,
            'version' => 1,
            'definition' => ['version' => 1, 'channels' => []],
        ]);

        return [$profileVersion, $bindingVersion];
    }
}
