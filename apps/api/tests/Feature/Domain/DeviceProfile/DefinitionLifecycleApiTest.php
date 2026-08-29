<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\DeviceProfile;

use App\Domain\DeviceProfile\Enums\DefinitionState;
use App\Domain\DeviceProfile\Models\DeviceProfileVersion;
use App\Domain\DeviceProfile\Models\TransportBindingVersion;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use JsonException;
use Tests\TestCase;

final class DefinitionLifecycleApiTest extends TestCase
{
    use RefreshDatabase;

    /** @throws JsonException */
    public function test_tenant_can_preview_publish_compile_pin_and_register_a_routed_device(): void
    {
        [$organization, $administrator] = $this->tenantAdministrator();
        $profile = $this->fixture('hub-fanout/humidity-profile.json');
        $binding = $this->fixture('hub-fanout/humidity-binding.json');
        $gateway = $this->fixture('hub-fanout/gateway.json');
        $route = $this->fixture('hub-fanout/humidity-route.json');
        $fixtures = $this->compileFixtures();
        $compile = $this->compileResult($organization, $profile, $binding);
        $this->fakeCompiler($compile);

        $createdProfile = $this->actingAs($administrator, 'sanctum')
            ->postJson(
                '/api/v1/device-profiles',
                $profile,
                $this->headers($organization, ['Idempotency-Key' => 'profile-lifecycle-create']),
            )
            ->assertCreated();
        $createdBinding = $this->actingAs($administrator, 'sanctum')
            ->postJson(
                '/api/v1/native-mqtt-bindings',
                $binding,
                $this->headers($organization, ['Idempotency-Key' => 'binding-lifecycle-create']),
            )
            ->assertCreated();

        $compileRequest = [
            'schema' => 'iot.definition-compile-request.v1',
            'organization_uuid' => $organization->uuid,
            'profile' => $profile,
            'binding' => $binding,
            'gateway' => $gateway,
            'route' => $route,
            'fixtures' => $fixtures,
        ];

        $this->actingAs($administrator, 'sanctum')
            ->postJson(
                '/api/v1/definition-compilations/preview',
                $compileRequest,
                $this->headers($organization),
            )
            ->assertOk()
            ->assertJsonPath('data.valid', true)
            ->assertJsonPath('data.runtime_bundle.device_uuid', $route['route']['device_uuid']);

        $published = $this->actingAs($administrator, 'sanctum')
            ->postJson(
                '/api/v1/definition-compilations/publish',
                $compileRequest,
                $this->headers($organization, [
                    'Idempotency-Key' => 'definition-lifecycle-publish',
                    'If-Match-Profile' => $createdProfile->headers->get('ETag'),
                    'If-Match-Binding' => $createdBinding->headers->get('ETag'),
                ]),
            )
            ->assertOk()
            ->assertJsonPath('data.profile.meta.state', 'published')
            ->assertJsonPath('data.binding.meta.state', 'published')
            ->assertJsonPath('data.compile.valid', true);

        $this->assertNotNull($published->headers->get('ETag-Profile'));
        $this->assertNotNull($published->headers->get('ETag-Binding'));
        $this->assertSame(
            DefinitionState::PUBLISHED,
            DeviceProfileVersion::query()->where('uuid', $profile['version']['uuid'])->firstOrFail()->state,
        );
        $this->assertSame(
            DefinitionState::PUBLISHED,
            TransportBindingVersion::query()->where('uuid', $binding['version']['uuid'])->firstOrFail()->state,
        );

        $device = $this->actingAs($administrator, 'sanctum')
            ->postJson('/api/v1/devices', [
                'uuid' => $route['route']['device_uuid'],
                'name' => 'North hub humidity',
                'external_id' => 'north-hub-humidity',
                'description' => 'Logical humidity Device behind the north hub.',
                'profile_version_uuid' => $profile['version']['uuid'],
                'binding_version_uuid' => $binding['version']['uuid'],
            ], $this->headers($organization, ['Idempotency-Key' => 'humidity-device-create']))
            ->assertCreated();
        $this->actingAs($administrator, 'sanctum')
            ->postJson(
                '/api/v1/gateways',
                $gateway,
                $this->headers($organization, ['Idempotency-Key' => 'humidity-gateway-create']),
            )
            ->assertCreated();
        $this->actingAs($administrator, 'sanctum')
            ->postJson(
                '/api/v1/gateway-routes',
                $route,
                $this->headers($organization, ['Idempotency-Key' => 'humidity-route-create']),
            )
            ->assertCreated();

        $assignment = $this->actingAs($administrator, 'sanctum')
            ->getJson(
                "/api/v1/devices/{$route['route']['device_uuid']}/definition-assignment",
                $this->headers($organization),
            )
            ->assertOk();
        $fixtureRequest = [
            'schema' => 'iot.definition-fixtures.v1',
            'fixtures' => $fixtures,
        ];
        $preview = $this->actingAs($administrator, 'sanctum')
            ->postJson(
                "/api/v1/devices/{$route['route']['device_uuid']}/definition-assignment/compile",
                $fixtureRequest,
                $this->headers($organization),
            )
            ->assertOk()
            ->assertJsonPath('data.valid', true);

        $pinned = $this->actingAs($administrator, 'sanctum')
            ->postJson(
                "/api/v1/devices/{$route['route']['device_uuid']}/definition-assignment/pin",
                [
                    ...$fixtureRequest,
                    'expected_input_hash' => $preview->json('data.input_hash'),
                ],
                $this->headers($organization, [
                    'Idempotency-Key' => 'humidity-runtime-pin',
                    'If-Match' => $assignment->headers->get('ETag'),
                ]),
            )
            ->assertOk()
            ->assertJsonPath(
                'data.assignment.runtime_bundle_hash',
                $compile['runtime_bundle']['runtime_bundle_hash'],
            );

        $this->actingAs($administrator, 'sanctum')
            ->postJson(
                "/api/v1/devices/{$route['route']['device_uuid']}/register",
                [],
                $this->headers($organization, [
                    'Idempotency-Key' => 'humidity-device-register',
                    'If-Match' => $device->headers->get('ETag'),
                ]),
            )
            ->assertOk()
            ->assertJsonPath('data.lifecycle_state', 'registered')
            ->assertJsonPath(
                'data.definition_assignment.runtime_bundle_hash',
                $compile['runtime_bundle']['runtime_bundle_hash'],
            );

        Http::assertSentCount(4);
    }

    /** @throws JsonException */
    public function test_invalid_compile_does_not_publish_or_pin_and_stale_publication_is_rejected(): void
    {
        [$organization, $administrator] = $this->tenantAdministrator();
        $profile = $this->fixture('hub-fanout/humidity-profile.json');
        $binding = $this->fixture('hub-fanout/humidity-binding.json');
        $compile = $this->invalidCompileResult();
        $this->fakeCompiler($compile);

        $createdProfile = $this->actingAs($administrator, 'sanctum')
            ->postJson(
                '/api/v1/device-profiles',
                $profile,
                $this->headers($organization, ['Idempotency-Key' => 'invalid-profile-create']),
            )
            ->assertCreated();
        $createdBinding = $this->actingAs($administrator, 'sanctum')
            ->postJson(
                '/api/v1/native-mqtt-bindings',
                $binding,
                $this->headers($organization, ['Idempotency-Key' => 'invalid-binding-create']),
            )
            ->assertCreated();
        $request = [
            'schema' => 'iot.definition-compile-request.v1',
            'organization_uuid' => $organization->uuid,
            'profile' => $profile,
            'binding' => $binding,
            'gateway' => $this->fixture('hub-fanout/gateway.json'),
            'route' => $this->fixture('hub-fanout/humidity-route.json'),
            'fixtures' => $this->compileFixtures(),
        ];

        $this->actingAs($administrator, 'sanctum')
            ->postJson(
                '/api/v1/definition-compilations/publish',
                $request,
                $this->headers($organization, [
                    'Idempotency-Key' => 'invalid-definition-publish',
                    'If-Match-Profile' => '"device-profile-stale-r0"',
                    'If-Match-Binding' => $createdBinding->headers->get('ETag'),
                ]),
            )
            ->assertStatus(412);

        $this->actingAs($administrator, 'sanctum')
            ->postJson(
                '/api/v1/definition-compilations/publish',
                $request,
                $this->headers($organization, [
                    'Idempotency-Key' => 'invalid-definition-publish-valid-etags',
                    'If-Match-Profile' => $createdProfile->headers->get('ETag'),
                    'If-Match-Binding' => $createdBinding->headers->get('ETag'),
                ]),
            )
            ->assertUnprocessable()
            ->assertJsonPath('data.valid', false)
            ->assertJsonPath('data.diagnostics.0.code', 'jsonpath_invalid');

        $this->assertSame(
            DefinitionState::DRAFT,
            DeviceProfileVersion::query()->where('uuid', $profile['version']['uuid'])->firstOrFail()->state,
        );
        $this->assertSame(
            DefinitionState::DRAFT,
            TransportBindingVersion::query()->where('uuid', $binding['version']['uuid'])->firstOrFail()->state,
        );
    }

    /** @return array{Organization, User} */
    private function tenantAdministrator(): array
    {
        $this->seed(DatabaseSeeder::class);
        config()->set('services.iot_runtime.url', 'http://runtime.test');
        config()->set('services.iot_runtime.token', str_repeat('t', 32));
        config()->set('services.iot_runtime.attempts', 1);

        return [
            Organization::query()->where('slug', 'acme-manufacturing')->firstOrFail(),
            User::query()->where('email', 'shared.operator@example.test')->firstOrFail(),
        ];
    }

    /** @param array<string, mixed> $result */
    private function fakeCompiler(array $result): void
    {
        Http::fake([
            'http://runtime.test/internal/v1/definitions/compile' => Http::response($result),
        ]);
    }

    /** @return list<array<string, mixed>> @throws JsonException */
    private function compileFixtures(): array
    {
        return [[
            'name' => 'North hub humidity telemetry',
            'kind' => 'telemetry',
            'channel' => 'telemetry',
            'topic' => 'gateways/north-hub-001/telemetry',
            'payload' => $this->fixture('hub-fanout/telemetry-payload.json'),
        ]];
    }

    /**
     * @param  array<string, mixed>  $profile
     * @param  array<string, mixed>  $binding
     * @return array<string, mixed>
     *
     * @throws JsonException
     */
    private function compileResult(Organization $organization, array $profile, array $binding): array
    {
        $bundle = $this->fixture('hub-fanout/humidity-runtime-bundle.json');
        $bundle['organization_uuid'] = $organization->uuid;
        $compiler = $bundle['compiler'];
        $profileArtifact = [
            'schema' => 'iot.device-profile.v1',
            'profile_uuid' => $profile['profile']['uuid'],
            'profile_key' => $profile['profile']['key'],
            'profile_version_uuid' => $profile['version']['uuid'],
            'version' => $profile['version']['version'],
            'source_hash' => str_repeat('d', 64),
            'compiler' => $compiler,
            'parameters' => $profile['version']['parameters'],
            'derived_parameters' => $profile['version']['derived_parameters'],
            'properties' => $profile['version']['properties'],
            'events' => $profile['version']['events'],
            'commands' => $profile['version']['commands'],
        ];
        $bindingArtifact = [
            'schema' => 'iot.native-mqtt-binding.v1',
            'binding_uuid' => $binding['binding']['uuid'],
            'binding_key' => $binding['binding']['key'],
            'binding_version_uuid' => $binding['version']['uuid'],
            'version' => $binding['version']['version'],
            'profile_uuid' => $profile['profile']['uuid'],
            'profile_version_uuid' => $profile['version']['uuid'],
            'profile_artifact_hash' => $bundle['profile_artifact_hash'],
            'source_hash' => str_repeat('e', 64),
            'compiler' => $compiler,
            'channels' => $binding['version']['channels'],
            'parameter_mappings' => $binding['version']['parameter_mappings'],
            'property_mappings' => $binding['version']['property_mappings'],
            'event_mappings' => $binding['version']['event_mappings'],
            'command_mappings' => $binding['version']['command_mappings'],
        ];

        return [
            'schema' => 'iot.definition-preview.v1',
            'valid' => true,
            'input_hash' => str_repeat('f', 64),
            'compiler' => $compiler,
            'diagnostics' => [],
            'artifact_hashes' => [
                'profile' => $bundle['profile_artifact_hash'],
                'binding' => $bundle['binding_artifact_hash'],
                'runtime_bundle' => $bundle['runtime_bundle_hash'],
            ],
            'profile_artifact' => $profileArtifact,
            'binding_artifact' => $bindingArtifact,
            'runtime_bundle' => $bundle,
            'previews' => [[
                'name' => 'North hub humidity telemetry',
                'accepted' => true,
                'values' => [],
                'diagnostics' => [],
            ]],
        ];
    }

    /** @return array<string, mixed> */
    private function invalidCompileResult(): array
    {
        return [
            'schema' => 'iot.definition-preview.v1',
            'valid' => false,
            'input_hash' => str_repeat('f', 64),
            'compiler' => [
                'name' => 'iot-os-definition-compiler',
                'version' => '1.0.0',
                'cel_environment' => 'cel-go-v0.26-restricted-v1',
                'jsonpath_version' => 'ojg-v1-restricted-v1',
                'unit_registry' => 'ucum-essence-2026',
            ],
            'diagnostics' => [[
                'severity' => 'error',
                'code' => 'jsonpath_invalid',
                'path' => 'binding.version.parameter_mappings.0.source.json_path',
                'message' => 'JSONPath is invalid.',
            ]],
            'artifact_hashes' => [
                'profile' => null,
                'binding' => null,
                'runtime_bundle' => null,
            ],
            'previews' => [],
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
