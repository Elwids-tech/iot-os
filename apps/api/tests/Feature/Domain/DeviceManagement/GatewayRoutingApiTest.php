<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\DeviceManagement;

use App\Domain\DeviceManagement\Http\Resources\GatewayRouteResource;
use App\Domain\DeviceManagement\Models\Device;
use App\Domain\DeviceManagement\Models\Gateway;
use App\Domain\DeviceManagement\Models\GatewayRoute;
use App\Domain\DeviceManagement\Services\DeviceRegistrationManager;
use App\Domain\DeviceProfile\Data\DeviceProfileAuthoringData;
use App\Domain\DeviceProfile\Data\NativeMqttBindingAuthoringData;
use App\Domain\DeviceProfile\Enums\DefinitionState;
use App\Domain\DeviceProfile\Models\DeviceProfileVersion;
use App\Domain\DeviceProfile\Models\TransportBindingVersion;
use App\Domain\DeviceProfile\Services\DefinitionAuthoringManager;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use JsonException;
use Tests\TestCase;

final class GatewayRoutingApiTest extends TestCase
{
    use RefreshDatabase;

    /** @throws JsonException */
    public function test_gateway_and_route_crud_are_tenant_safe_concurrent_and_route_aware(): void
    {
        [$organization, $administrator] = $this->tenantAdministrator();
        [$profileVersion, $bindingVersion] = $this->publishedDefinition($organization);
        [$device, $deviceEtag] = $this->createLogicalDevice(
            $organization,
            $administrator,
            $profileVersion,
            $bindingVersion,
        );
        $assignment = $device->definitionAssignment()->firstOrFail();

        $gatewayPayload = $this->fixture('hub-fanout/gateway.json');
        $gatewayResponse = $this->actingAs($administrator, 'sanctum')
            ->postJson(
                '/api/v1/gateways',
                $gatewayPayload,
                $this->headers($organization, ['Idempotency-Key' => 'gateway-create']),
            )
            ->assertCreated()
            ->assertJsonPath('data.gateway.mqtt_client_id', 'north-hub-001')
            ->assertJsonPath('data.meta.revision', 1);
        $gateway = Gateway::query()->where('uuid', $gatewayResponse->json('data.gateway.uuid'))->firstOrFail();

        $wrongVersion = $profileVersion->profile->versions()->create([
            'uuid' => (string) Str::uuid(),
            'organization_id' => $organization->id,
            'version' => 2,
            'state' => DefinitionState::PUBLISHED,
            'definition' => [
                ...$profileVersion->definition,
                'uuid' => (string) Str::uuid(),
                'version' => 2,
            ],
            'artifact_hash' => str_repeat('e', 64),
            'published_at' => now(),
        ]);
        $incompatibleRoute = $this->fixture('hub-fanout/temperature-route.json');
        $incompatibleRoute['route']['profile_version_uuid'] = $wrongVersion->uuid;

        $this->actingAs($administrator, 'sanctum')
            ->postJson(
                '/api/v1/gateway-routes',
                $incompatibleRoute,
                $this->headers($organization, ['Idempotency-Key' => 'route-incompatible']),
            )
            ->assertConflict();

        $routePayload = $this->fixture('hub-fanout/temperature-route.json');
        $outboundScopeRoute = $routePayload;
        $outboundScopeRoute['route']['inbound_scopes'][0]['channel'] = 'set_temperature_request';

        $this->actingAs($administrator, 'sanctum')
            ->postJson(
                '/api/v1/gateway-routes',
                $outboundScopeRoute,
                $this->headers($organization, ['Idempotency-Key' => 'route-outbound-scope']),
            )
            ->assertConflict();

        $routeResponse = $this->actingAs($administrator, 'sanctum')
            ->postJson(
                '/api/v1/gateway-routes',
                $routePayload,
                $this->headers($organization, ['Idempotency-Key' => 'route-create']),
            )
            ->assertCreated()
            ->assertJsonPath('data.route.device_uuid', $device->uuid);
        $route = GatewayRoute::query()->where('uuid', $routeResponse->json('data.route.uuid'))->firstOrFail();
        $assignment->refresh();
        $this->assertSame($profileVersion->artifact_hash, $assignment->profile_artifact_hash);
        $this->assertSame($bindingVersion->artifact_hash, $assignment->binding_artifact_hash);

        $gatewayPayload['gateway']['name'] = 'North plant hub updated';
        $this->actingAs($administrator, 'sanctum')
            ->putJson(
                "/api/v1/gateways/{$gateway->uuid}",
                $gatewayPayload,
                $this->headers($organization, ['If-Match' => '"gateway-stale-r0"']),
            )
            ->assertStatus(412);
        $gatewayUpdated = $this->actingAs($administrator, 'sanctum')
            ->putJson(
                "/api/v1/gateways/{$gateway->uuid}",
                $gatewayPayload,
                $this->headers($organization, ['If-Match' => $gatewayResponse->headers->get('ETag')]),
            )
            ->assertOk()
            ->assertJsonPath('data.gateway.name', 'North plant hub updated')
            ->assertJsonPath('data.meta.revision', 2);

        $routePayload['route']['route_path'] = 'sensors/temperature/primary';
        $this->actingAs($administrator, 'sanctum')
            ->putJson(
                "/api/v1/gateway-routes/{$route->uuid}",
                $routePayload,
                $this->headers($organization, ['If-Match' => '"gateway-route-stale-r0"']),
            )
            ->assertStatus(412);
        $routeUpdated = $this->actingAs($administrator, 'sanctum')
            ->putJson(
                "/api/v1/gateway-routes/{$route->uuid}",
                $routePayload,
                $this->headers($organization, ['If-Match' => $routeResponse->headers->get('ETag')]),
            )
            ->assertOk()
            ->assertJsonPath('data.route.revision', 2)
            ->assertJsonPath('data.route.route_path', 'sensors/temperature/primary');

        $otherOrganization = Organization::query()->where('slug', 'northstar-utilities')->firstOrFail();
        $otherAdministrator = User::query()->where('email', 'northstar.admin@example.test')->firstOrFail();
        $this->actingAs($otherAdministrator, 'sanctum')
            ->getJson("/api/v1/gateway-routes/{$route->uuid}", $this->headers($otherOrganization))
            ->assertNotFound();

        $this->actingAs($administrator, 'sanctum')
            ->postJson(
                "/api/v1/devices/{$device->uuid}/register",
                [],
                $this->headers($organization, [
                    'If-Match' => $deviceEtag,
                    'Idempotency-Key' => 'register-before-runtime',
                ]),
            )
            ->assertConflict();

        $route->refresh();
        $assignment->refresh();
        $runtimeBundle = $this->runtimeBundle(
            $organization,
            $gateway->refresh(),
            $route,
            $device,
            $profileVersion,
            $bindingVersion,
        );
        $assignment = app(DeviceRegistrationManager::class)->pinRuntimeBundle(
            $assignment,
            $runtimeBundle,
            $assignment->etag(),
            $administrator,
        );
        $this->assertSame($runtimeBundle['runtime_bundle_hash'], $assignment->runtime_bundle_hash);

        $this->actingAs($administrator, 'sanctum')
            ->postJson(
                "/api/v1/devices/{$device->uuid}/register",
                [],
                $this->headers($organization, [
                    'If-Match' => $device->refresh()->etag(),
                    'Idempotency-Key' => 'register-route-aware-device',
                ]),
            )
            ->assertOk()
            ->assertJsonPath('data.lifecycle_state', 'registered')
            ->assertJsonPath('data.definition_assignment.runtime_bundle_hash', $runtimeBundle['runtime_bundle_hash']);

        $routePayload['route']['revision'] = 2;
        $this->actingAs($administrator, 'sanctum')
            ->putJson(
                "/api/v1/gateway-routes/{$route->uuid}",
                $routePayload,
                $this->headers($organization, ['If-Match' => $routeUpdated->headers->get('ETag')]),
            )
            ->assertForbidden();
        $this->actingAs($administrator, 'sanctum')
            ->deleteJson(
                "/api/v1/gateway-routes/{$route->uuid}",
                [],
                $this->headers($organization, ['If-Match' => $routeUpdated->headers->get('ETag')]),
            )
            ->assertForbidden();
        $this->actingAs($administrator, 'sanctum')
            ->deleteJson(
                "/api/v1/gateways/{$gateway->uuid}",
                [],
                $this->headers($organization, ['If-Match' => $gatewayUpdated->headers->get('ETag')]),
            )
            ->assertConflict();
    }

    /** @throws JsonException */
    public function test_deleting_a_draft_route_returns_assignment_to_route_pending_and_allows_gateway_deletion(): void
    {
        [$organization, $administrator] = $this->tenantAdministrator();
        [$profileVersion, $bindingVersion] = $this->publishedDefinition($organization);
        [$device] = $this->createLogicalDevice($organization, $administrator, $profileVersion, $bindingVersion);
        $gatewayPayload = $this->fixture('hub-fanout/gateway.json');
        $gatewayResponse = $this->actingAs($administrator, 'sanctum')
            ->postJson(
                '/api/v1/gateways',
                $gatewayPayload,
                $this->headers($organization, ['Idempotency-Key' => 'delete-route-gateway']),
            )
            ->assertCreated();
        $routePayload = $this->fixture('hub-fanout/temperature-route.json');
        $routeResponse = $this->actingAs($administrator, 'sanctum')
            ->postJson(
                '/api/v1/gateway-routes',
                $routePayload,
                $this->headers($organization, ['Idempotency-Key' => 'delete-draft-route']),
            )
            ->assertCreated();

        $this->actingAs($administrator, 'sanctum')
            ->deleteJson(
                '/api/v1/gateway-routes/'.$routeResponse->json('data.route.uuid'),
                [],
                $this->headers($organization, ['If-Match' => $routeResponse->headers->get('ETag')]),
            )
            ->assertNoContent();

        $assignment = $device->definitionAssignment()->firstOrFail();
        $this->assertNull($assignment->gateway_route_id);
        $this->assertNull($assignment->profile_artifact_hash);
        $this->assertDatabaseCount('gateway_routes', 0);

        $this->actingAs($administrator, 'sanctum')
            ->deleteJson(
                '/api/v1/gateways/'.$gatewayResponse->json('data.gateway.uuid'),
                [],
                $this->headers($organization, ['If-Match' => $gatewayResponse->headers->get('ETag')]),
            )
            ->assertNoContent();
    }

    /** @throws JsonException */
    public function test_members_can_view_but_cannot_create_gateways(): void
    {
        [$organization] = $this->tenantAdministrator();
        $member = User::query()->where('email', 'acme.member@example.test')->firstOrFail();

        $this->actingAs($member, 'sanctum')
            ->getJson('/api/v1/gateways', $this->headers($organization))
            ->assertOk();
        $this->actingAs($member, 'sanctum')
            ->postJson(
                '/api/v1/gateways',
                $this->fixture('hub-fanout/gateway.json'),
                $this->headers($organization, ['Idempotency-Key' => 'member-gateway-create']),
            )
            ->assertForbidden();
    }

    public function test_gateway_route_resource_does_not_lazy_load_missing_relations(): void
    {
        $route = new GatewayRoute;
        $route->forceFill([
            'uuid' => '43000000-0000-4000-8000-000000000099',
            'revision' => 1,
            'route_path' => 'unloaded/route',
            'topic_variables' => [],
            'inbound_scopes' => [],
            'enabled' => true,
        ]);

        $payload = GatewayRouteResource::make($route)->resolve(request());

        $this->assertNull($payload['route']['gateway_uuid']);
        $this->assertNull($payload['route']['device_uuid']);
        $this->assertNull($payload['route']['profile_version_uuid']);
        $this->assertNull($payload['route']['binding_version_uuid']);
        $this->assertFalse($route->relationLoaded('gateway'));
        $this->assertFalse($route->relationLoaded('device'));
    }

    /** @return array{Organization, User} */
    private function tenantAdministrator(): array
    {
        $this->seed(DatabaseSeeder::class);

        return [
            Organization::query()->where('slug', 'acme-manufacturing')->firstOrFail(),
            User::query()->where('email', 'shared.operator@example.test')->firstOrFail(),
        ];
    }

    /**
     * @return array{DeviceProfileVersion, TransportBindingVersion}
     *
     * @throws JsonException
     */
    private function publishedDefinition(Organization $organization): array
    {
        $manager = app(DefinitionAuthoringManager::class);
        $profile = $manager->createProfileDraft(
            $organization,
            DeviceProfileAuthoringData::fromArray($this->fixture('hub-fanout/temperature-profile.json')),
        );
        $profileVersion = $profile->versions()->firstOrFail();
        $bindingPayload = NativeMqttBindingAuthoringData::fromArray(
            $this->fixture('hub-fanout/temperature-binding.json'),
        );
        $binding = $manager->createBindingDraft(
            $organization,
            $profile,
            $profileVersion,
            $bindingPayload,
        );
        $bindingVersion = $binding->versions()->firstOrFail();
        $profileVersion->forceFill([
            'state' => DefinitionState::PUBLISHED,
            'artifact_hash' => str_repeat('a', 64),
            'published_at' => now(),
        ])->save();
        $bindingVersion->forceFill([
            'state' => DefinitionState::PUBLISHED,
            'artifact_hash' => str_repeat('b', 64),
            'published_at' => now(),
        ])->save();

        return [$profileVersion->refresh(), $bindingVersion->refresh()];
    }

    /** @return array{Device, string} */
    private function createLogicalDevice(
        Organization $organization,
        User $administrator,
        DeviceProfileVersion $profileVersion,
        TransportBindingVersion $bindingVersion,
    ): array {
        $response = $this->actingAs($administrator, 'sanctum')
            ->postJson(
                '/api/v1/devices',
                [
                    'uuid' => '40000000-0000-4000-8000-000000000001',
                    'external_id' => 'north-hub-temperature',
                    'name' => 'North hub temperature',
                    'description' => 'A logical Device reached through the north hub.',
                    'profile_version_uuid' => $profileVersion->uuid,
                    'binding_version_uuid' => $bindingVersion->uuid,
                ],
                $this->headers($organization, ['Idempotency-Key' => 'logical-device-create']),
            )
            ->assertCreated();

        return [
            Device::query()->where('uuid', $response->json('data.uuid'))->firstOrFail(),
            (string) $response->headers->get('ETag'),
        ];
    }

    /** @return array<string, mixed> */
    private function runtimeBundle(
        Organization $organization,
        Gateway $gateway,
        GatewayRoute $route,
        Device $device,
        DeviceProfileVersion $profileVersion,
        TransportBindingVersion $bindingVersion,
    ): array {
        return [
            'schema' => 'iot.runtime-bundle.v1',
            'runtime_bundle_hash' => str_repeat('d', 64),
            'organization_uuid' => $organization->uuid,
            'gateway_uuid' => $gateway->uuid,
            'gateway_route_uuid' => $route->uuid,
            'route_revision' => $route->revision,
            'route_path' => $route->route_path,
            'device_uuid' => $device->uuid,
            'profile_uuid' => $profileVersion->profile->uuid,
            'profile_version_uuid' => $profileVersion->uuid,
            'binding_uuid' => $bindingVersion->binding->uuid,
            'binding_version_uuid' => $bindingVersion->uuid,
            'profile_artifact_hash' => $profileVersion->artifact_hash,
            'binding_artifact_hash' => $bindingVersion->artifact_hash,
            'route_source_hash' => str_repeat('c', 64),
            'compiler' => ['name' => 'd4r2-test-fixture'],
            'channels' => [],
            'parameter_pipelines' => [],
            'derived_pipelines' => [],
            'command_pipelines' => [],
        ];
    }

    /** @param array<string, string|null> $extra @return array<string, string|null> */
    private function headers(Organization $organization, array $extra = []): array
    {
        return ['X-Organization-UUID' => $organization->uuid, ...$extra];
    }

    /** @return array<string, mixed> @throws JsonException */
    private function fixture(string $name): array
    {
        $contents = file_get_contents(base_path("../../contracts/fixtures/device-onboarding/valid/{$name}"));
        $this->assertNotFalse($contents);

        return json_decode($contents, true, flags: JSON_THROW_ON_ERROR);
    }
}
