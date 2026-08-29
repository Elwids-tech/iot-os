<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\DeviceProfile;

use App\Domain\DeviceProfile\Data\DeviceProfileAuthoringData;
use App\Domain\DeviceProfile\Data\NativeMqttBindingAuthoringData;
use App\Domain\DeviceProfile\Enums\DefinitionState;
use App\Domain\DeviceProfile\Http\Resources\DeviceProfileResource;
use App\Domain\DeviceProfile\Http\Resources\NativeMqttBindingResource;
use App\Domain\DeviceProfile\Models\DeviceProfile;
use App\Domain\DeviceProfile\Models\TransportBinding;
use App\Domain\DeviceProfile\Services\DefinitionAuthoringManager;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use JsonException;
use stdClass;
use Tests\TestCase;

final class DeviceDomainApiTest extends TestCase
{
    use RefreshDatabase;

    /** @throws JsonException */
    public function test_all_golden_canonical_authoring_documents_are_accepted_by_the_laravel_dtos(): void
    {
        foreach ([
            'hub-fanout/temperature-profile.json',
            'hub-fanout/humidity-profile.json',
            'three-phase-meter/profile.json',
        ] as $fixture) {
            $this->assertInstanceOf(
                DeviceProfileAuthoringData::class,
                DeviceProfileAuthoringData::fromArray($this->fixture($fixture)),
            );
        }

        foreach ([
            'hub-fanout/temperature-binding.json',
            'hub-fanout/humidity-binding.json',
            'three-phase-meter/binding.json',
        ] as $fixture) {
            $this->assertInstanceOf(
                NativeMqttBindingAuthoringData::class,
                NativeMqttBindingAuthoringData::fromArray($this->fixture($fixture)),
            );
        }
    }

    /** @throws JsonException */
    public function test_profile_and_binding_canonical_aggregates_support_tenant_crud_and_etags(): void
    {
        [$organization, $administrator] = $this->tenantAdministrator();
        $profilePayload = $this->fixture('hub-fanout/temperature-profile.json');
        $profilePayload['version']['parameters'][0]['value_schema']['constraints'] = (object) [];

        $created = $this->actingAs($administrator, 'sanctum')
            ->postJson(
                '/api/v1/device-profiles',
                $profilePayload,
                $this->headers($organization, ['Idempotency-Key' => 'profile-canonical-create']),
            )
            ->assertCreated()
            ->assertJsonPath('data.schema', 'iot.device-profile.authoring.v1')
            ->assertJsonPath('data.version.parameters.0.key', 'temperature');
        $createdDocument = json_decode((string) $created->getContent(), false, flags: JSON_THROW_ON_ERROR);
        $this->assertInstanceOf(
            stdClass::class,
            $createdDocument->data->version->parameters[0]->value_schema->constraints,
        );

        $profileUuid = (string) $created->json('data.profile.uuid');
        $etag = (string) $created->headers->get('ETag');
        $storedProfile = DeviceProfile::query()->where('uuid', $profileUuid)->firstOrFail();
        $storedProfileDefinition = json_decode(
            (string) $storedProfile->versions()->firstOrFail()->getRawOriginal('definition'),
            false,
            flags: JSON_THROW_ON_ERROR,
        );
        $this->assertInstanceOf(
            stdClass::class,
            $storedProfileDefinition->parameters[0]->value_schema->constraints,
        );

        $profilePayload['profile']['name'] = 'Updated temperature thermostat';

        $this->actingAs($administrator, 'sanctum')
            ->putJson("/api/v1/device-profiles/{$profileUuid}", $profilePayload, $this->headers($organization))
            ->assertStatus(428);

        $this->actingAs($administrator, 'sanctum')
            ->putJson(
                "/api/v1/device-profiles/{$profileUuid}",
                $profilePayload,
                $this->headers($organization, ['If-Match' => '"device-profile-stale-r0"']),
            )
            ->assertStatus(412)
            ->assertHeader('ETag', $etag);

        $updated = $this->actingAs($administrator, 'sanctum')
            ->putJson(
                "/api/v1/device-profiles/{$profileUuid}",
                $profilePayload,
                $this->headers($organization, ['If-Match' => $etag]),
            )
            ->assertOk()
            ->assertJsonPath('data.profile.name', 'Updated temperature thermostat')
            ->assertJsonPath('data.meta.profile_revision', 2)
            ->assertJsonPath('data.meta.version_revision', 2);

        $this->assertNotSame($etag, $updated->headers->get('ETag'));

        $bindingPayload = $this->fixture('hub-fanout/temperature-binding.json');
        $binding = $this->actingAs($administrator, 'sanctum')
            ->postJson(
                '/api/v1/native-mqtt-bindings',
                $bindingPayload,
                $this->headers($organization, ['Idempotency-Key' => 'binding-canonical-create']),
            )
            ->assertCreated()
            ->assertJsonPath('data.schema', 'iot.native-mqtt-binding.authoring.v1')
            ->assertJsonPath('data.version.parameter_mappings.0.target_parameter_uuid', '41000000-0000-4000-8000-000000000003');
        $bindingDocument = json_decode((string) $binding->getContent(), false, flags: JSON_THROW_ON_ERROR);
        $this->assertInstanceOf(stdClass::class, $bindingDocument->data->version->channels[1]->envelope);
        $this->assertInstanceOf(
            stdClass::class,
            $bindingDocument->data->version->command_mappings[0]->request_template,
        );

        $bindingUuid = (string) $binding->json('data.binding.uuid');
        $storedBinding = TransportBinding::query()->where('uuid', $bindingUuid)->firstOrFail();
        $storedDefinition = json_decode(
            (string) $storedBinding->versions()->firstOrFail()->getRawOriginal('definition'),
            false,
            flags: JSON_THROW_ON_ERROR,
        );
        $this->assertInstanceOf(stdClass::class, $storedDefinition->channels[1]->envelope);
        $this->assertInstanceOf(
            stdClass::class,
            $storedDefinition->command_mappings[0]->request_template,
        );

        $this->actingAs($administrator, 'sanctum')
            ->getJson('/api/v1/device-profiles', $this->headers($organization))
            ->assertOk()
            ->assertJsonCount(1, 'data');
        $this->actingAs($administrator, 'sanctum')
            ->getJson('/api/v1/native-mqtt-bindings', $this->headers($organization))
            ->assertOk()
            ->assertJsonCount(1, 'data');

        $this->actingAs($administrator, 'sanctum')
            ->deleteJson(
                "/api/v1/native-mqtt-bindings/{$bindingUuid}",
                [],
                $this->headers($organization, ['If-Match' => $binding->headers->get('ETag')]),
            )
            ->assertNoContent();
        $this->actingAs($administrator, 'sanctum')
            ->deleteJson(
                "/api/v1/device-profiles/{$profileUuid}",
                [],
                $this->headers($organization, ['If-Match' => $updated->headers->get('ETag')]),
            )
            ->assertNoContent();
    }

    /** @throws JsonException */
    public function test_profile_canonical_rejects_duplicate_parameter_identity_and_invalid_cel_dependencies(): void
    {
        [$organization, $administrator] = $this->tenantAdministrator();
        $duplicate = $this->fixture('hub-fanout/temperature-profile.json');
        $duplicateParameter = $duplicate['version']['parameters'][0];
        $duplicateParameter['key'] = 'temperature_duplicate';
        $duplicateParameter['label'] = 'Duplicate temperature';
        $duplicate['version']['parameters'][] = $duplicateParameter;

        $this->actingAs($administrator, 'sanctum')
            ->postJson(
                '/api/v1/device-profiles',
                $duplicate,
                $this->headers($organization, ['Idempotency-Key' => 'duplicate-parameter']),
            )
            ->assertUnprocessable()
            ->assertJsonValidationErrors('version');

        $invalidDependency = $this->fixture('three-phase-meter/profile.json');
        $invalidDependency['version']['derived_parameters'][0]['dependencies'][0] = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

        $this->actingAs($administrator, 'sanctum')
            ->postJson(
                '/api/v1/device-profiles',
                $invalidDependency,
                $this->headers($organization, ['Idempotency-Key' => 'invalid-cel-dependency']),
            )
            ->assertUnprocessable()
            ->assertJsonValidationErrors('version');
    }

    /** @throws JsonException */
    public function test_canonical_api_enforces_schema_values_and_profile_binding_type_compatibility(): void
    {
        [$organization, $administrator] = $this->tenantAdministrator();
        $invalidProfile = $this->fixture('hub-fanout/temperature-profile.json');
        $invalidProfile['profile']['uuid'] = '67000000-0000-4000-8000-000000000001';
        $invalidProfile['version']['uuid'] = '67000000-0000-4000-8000-000000000002';
        $invalidProfile['version']['parameters'][0]['uuid'] = '67000000-0000-4000-8000-000000000003';
        $invalidProfile['version']['parameters'][0]['value_schema']['data_type'] = 'decimal';

        $this->actingAs($administrator, 'sanctum')
            ->postJson(
                '/api/v1/device-profiles',
                $invalidProfile,
                $this->headers($organization, ['Idempotency-Key' => 'invalid-profile-data-type']),
            )
            ->assertUnprocessable()
            ->assertJsonValidationErrors('version');

        $this->actingAs($administrator, 'sanctum')
            ->postJson(
                '/api/v1/device-profiles',
                $this->fixture('hub-fanout/temperature-profile.json'),
                $this->headers($organization, ['Idempotency-Key' => 'binding-validation-profile']),
            )
            ->assertCreated();

        $this->actingAs($administrator, 'sanctum')
            ->postJson(
                '/api/v1/native-mqtt-bindings',
                $this->invalidFixture('binding-missing-policies.json'),
                $this->headers($organization, ['Idempotency-Key' => 'binding-missing-policies']),
            )
            ->assertUnprocessable()
            ->assertJsonValidationErrors('version');

        $ambiguousStatus = $this->fixture('hub-fanout/temperature-binding.json');
        $ambiguousStatus['version']['command_mappings'][0]['response']['status']['values']['failed'][0] = 'succeeded';

        $this->actingAs($administrator, 'sanctum')
            ->postJson(
                '/api/v1/native-mqtt-bindings',
                $ambiguousStatus,
                $this->headers($organization, ['Idempotency-Key' => 'binding-ambiguous-command-status']),
            )
            ->assertUnprocessable()
            ->assertJsonValidationErrors('version');

        $invalidCalibration = $this->fixture('hub-fanout/temperature-binding.json');
        $invalidCalibration['binding']['uuid'] = '68000000-0000-4000-8000-000000000001';
        $invalidCalibration['version']['uuid'] = '68000000-0000-4000-8000-000000000002';
        $invalidCalibration['version']['parameter_mappings'][0]['uuid'] = '68000000-0000-4000-8000-000000000003';
        $invalidCalibration['version']['parameter_mappings'][0]['calibration'][0]['value'] = 0;

        $this->actingAs($administrator, 'sanctum')
            ->postJson(
                '/api/v1/native-mqtt-bindings',
                $invalidCalibration,
                $this->headers($organization, ['Idempotency-Key' => 'binding-invalid-calibration']),
            )
            ->assertUnprocessable()
            ->assertJsonValidationErrors('version');

        $this->actingAs($administrator, 'sanctum')
            ->postJson(
                '/api/v1/native-mqtt-bindings',
                $this->invalidFixture('binding-incompatible-type.json'),
                $this->headers($organization, ['Idempotency-Key' => 'binding-incompatible-type']),
            )
            ->assertConflict();
    }

    /** @throws JsonException */
    public function test_compatible_profile_clone_changes_version_identity_but_preserves_parameter_uuids(): void
    {
        $organization = Organization::factory()->create();
        $manager = app(DefinitionAuthoringManager::class);
        $profile = $manager->createProfileDraft(
            $organization,
            DeviceProfileAuthoringData::fromArray($this->fixture('three-phase-meter/profile.json')),
        );
        $source = $profile->versions()->firstOrFail();
        $clone = $manager->cloneCompatibleProfileVersion($source);

        $sourceData = DeviceProfileAuthoringData::fromArray([
            'schema' => 'iot.device-profile.authoring.v1',
            'profile' => [
                'uuid' => $profile->uuid,
                'key' => $profile->key,
                'name' => $profile->name,
                'description' => $profile->description,
            ],
            'version' => $source->definition,
        ]);
        $cloneData = DeviceProfileAuthoringData::fromArray([
            'schema' => 'iot.device-profile.authoring.v1',
            'profile' => [
                'uuid' => $profile->uuid,
                'key' => $profile->key,
                'name' => $profile->name,
                'description' => $profile->description,
            ],
            'version' => $clone->definition,
        ]);

        $this->assertNotSame($source->uuid, $clone->uuid);
        $this->assertSame($clone->uuid, $clone->definition['uuid']);
        $this->assertSame(2, $clone->definition['version']);
        $this->assertSame($sourceData->parameterIdentityMap(), $cloneData->parameterIdentityMap());
    }

    /** @throws JsonException */
    public function test_property_mappings_follow_profile_ownership_and_channel_semantics(): void
    {
        [$organization, $administrator] = $this->tenantAdministrator();
        $profilePayload = $this->fixture('hub-fanout/temperature-profile.json');
        $profilePayload['version']['properties'] = [
            [
                'uuid' => '69000000-0000-4000-8000-000000000001',
                'key' => 'installation_note',
                'label' => 'Installation note',
                'description' => null,
                'scope' => 'platform',
                'value_schema' => [
                    'data_type' => 'string',
                    'unit_code' => null,
                    'constraints' => (object) [],
                ],
            ],
            [
                'uuid' => '69000000-0000-4000-8000-000000000002',
                'key' => 'battery_level',
                'label' => 'Battery level',
                'description' => null,
                'scope' => 'reported',
                'value_schema' => [
                    'data_type' => 'float64',
                    'unit_code' => '%',
                    'constraints' => [
                        'minimum' => 0,
                        'maximum' => 100,
                    ],
                ],
            ],
        ];

        $this->actingAs($administrator, 'sanctum')
            ->postJson(
                '/api/v1/device-profiles',
                $profilePayload,
                $this->headers($organization, ['Idempotency-Key' => 'property-profile-create']),
            )
            ->assertCreated();

        $bindingPayload = $this->fixture('hub-fanout/temperature-binding.json');
        $bindingPayload['version']['channels'][] = [
            'uuid' => '69000000-0000-4000-8000-000000000003',
            'key' => 'reported_properties',
            'label' => 'Reported properties',
            'purpose' => 'reported_properties',
            'direction' => 'device_to_platform',
            'topic_template' => 'gateways/{gateway_id}/devices/{route_path}/properties/reported',
            'qos' => 1,
            'retain' => false,
            'content_type' => 'application/json',
            'record_path' => '$',
            'max_records' => 1,
            'envelope' => (object) [],
        ];
        $bindingPayload['version']['property_mappings'] = [[
            'uuid' => '69000000-0000-4000-8000-000000000004',
            'channel' => 'reported_properties',
            'target_property_uuid' => '69000000-0000-4000-8000-000000000002',
            'direction' => 'platform_to_device',
            'source' => [
                'scope' => 'record',
                'json_path' => '$.battery_level',
            ],
            'wire_data_type' => 'float64',
            'operations' => [],
            'on_missing' => 'omit_value',
            'on_invalid' => 'omit_value',
        ]];

        $this->actingAs($administrator, 'sanctum')
            ->postJson(
                '/api/v1/native-mqtt-bindings',
                $bindingPayload,
                $this->headers($organization, ['Idempotency-Key' => 'property-binding-wrong-direction']),
            )
            ->assertConflict();

        $bindingPayload['version']['property_mappings'][0]['direction'] = 'device_to_platform';
        $bindingPayload['version']['channels'][3]['purpose'] = 'telemetry';

        $this->actingAs($administrator, 'sanctum')
            ->postJson(
                '/api/v1/native-mqtt-bindings',
                $bindingPayload,
                $this->headers($organization, ['Idempotency-Key' => 'property-binding-wrong-purpose']),
            )
            ->assertConflict();

        $bindingPayload['version']['channels'][3]['purpose'] = 'reported_properties';

        $this->actingAs($administrator, 'sanctum')
            ->postJson(
                '/api/v1/native-mqtt-bindings',
                $bindingPayload,
                $this->headers($organization, ['Idempotency-Key' => 'property-binding-create']),
            )
            ->assertCreated()
            ->assertJsonCount(1, 'data.version.property_mappings');
    }

    /** @throws JsonException */
    public function test_published_canonical_aggregate_is_immutable_and_other_tenants_cannot_resolve_it(): void
    {
        [$organization, $administrator] = $this->tenantAdministrator();
        $payload = $this->fixture('hub-fanout/temperature-profile.json');
        $created = $this->actingAs($administrator, 'sanctum')
            ->postJson(
                '/api/v1/device-profiles',
                $payload,
                $this->headers($organization, ['Idempotency-Key' => 'published-canonical-profile']),
            )
            ->assertCreated();
        $profile = DeviceProfile::query()->where('uuid', $created->json('data.profile.uuid'))->firstOrFail();
        $version = $profile->versions()->firstOrFail();
        $version->forceFill([
            'state' => DefinitionState::PUBLISHED,
            'published_at' => now(),
        ])->save();

        $payload['profile']['name'] = 'Cannot change';
        $this->actingAs($administrator, 'sanctum')
            ->putJson(
                "/api/v1/device-profiles/{$profile->uuid}",
                $payload,
                $this->headers($organization, ['If-Match' => $created->headers->get('ETag')]),
            )
            ->assertConflict();

        $otherOrganization = Organization::query()->where('slug', 'northstar-utilities')->firstOrFail();
        $otherAdministrator = User::query()->where('email', 'northstar.admin@example.test')->firstOrFail();
        $this->actingAs($otherAdministrator, 'sanctum')
            ->getJson("/api/v1/device-profiles/{$profile->uuid}", $this->headers($otherOrganization))
            ->assertNotFound();
    }

    public function test_canonical_resources_do_not_lazy_load_missing_relations(): void
    {
        $organization = Organization::factory()->create();
        $profile = DeviceProfile::query()->create([
            'organization_id' => $organization->id,
            'key' => 'unloaded_profile',
            'name' => 'Unloaded Profile',
        ]);
        $binding = TransportBinding::query()->create([
            'organization_id' => $organization->id,
            'device_profile_id' => $profile->id,
            'key' => 'unloaded_binding',
            'name' => 'Unloaded Binding',
        ]);

        $profilePayload = DeviceProfileResource::make($profile)->resolve(request());
        $bindingPayload = NativeMqttBindingResource::make($binding)->resolve(request());

        $this->assertNull($profilePayload['version']);
        $this->assertNull($bindingPayload['binding']['profile_uuid']);
        $this->assertNull($bindingPayload['version']);
        $this->assertFalse($binding->relationLoaded('profile'));
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

    /** @return array<string, mixed> @throws JsonException */
    private function invalidFixture(string $name): array
    {
        $contents = file_get_contents(base_path("../../contracts/fixtures/device-onboarding/invalid/{$name}"));
        $this->assertNotFalse($contents);

        return json_decode($contents, true, flags: JSON_THROW_ON_ERROR);
    }
}
