<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\DeviceProfile;

use App\Domain\DeviceManagement\Models\Device;
use App\Domain\DeviceManagement\Models\DeviceDefinitionAssignment;
use App\Domain\DeviceProfile\Models\DefinitionTestRun;
use App\Domain\DeviceProfile\Models\DeviceProfile;
use App\Domain\DeviceProfile\Models\DeviceProfileVersion;
use App\Domain\DeviceProfile\Models\TransportBindingVersion;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use JsonException;
use Tests\TestCase;

final class DeviceDomainApiTest extends TestCase
{
    use RefreshDatabase;

    private const INTERNAL_TOKEN = 'test-runtime-internal-token-00000001';

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('services.iot_runtime', [
            'url' => 'http://runtime.test:8081',
            'token' => self::INTERNAL_TOKEN,
            'connect_timeout_seconds' => 1,
            'timeout_seconds' => 3,
            'attempts' => 1,
            'retry_delay_milliseconds' => 0,
        ]);
        Http::preventStrayRequests();
    }

    public function test_device_domain_routes_require_authentication_and_a_valid_member_organization_context(): void
    {
        [$organization, $administrator] = $this->tenantAdministrator();

        $this->getJson('/api/v1/device-profiles', $this->organizationHeaders($organization))
            ->assertUnauthorized();

        $this->actingAs($administrator, 'sanctum')
            ->getJson('/api/v1/device-profiles')
            ->assertBadRequest();

        $this->actingAs($administrator, 'sanctum')
            ->getJson('/api/v1/device-profiles', ['X-Organization-UUID' => 'not-a-uuid'])
            ->assertBadRequest();

        $member = User::query()->where('email', 'acme.member@example.test')->firstOrFail();
        $otherOrganization = Organization::query()->where('slug', 'northstar-utilities')->firstOrFail();

        $this->actingAs($member, 'sanctum')
            ->getJson('/api/v1/device-profiles', $this->organizationHeaders($otherOrganization))
            ->assertForbidden();

        $this->actingAs($administrator, 'sanctum')
            ->getJson('/api/v1/device-profiles', ['X-Organization-UUID' => (string) Str::uuid()])
            ->assertNotFound();
    }

    /** @throws JsonException */
    public function test_profile_crud_enforces_permissions_idempotency_etags_and_tenant_isolation(): void
    {
        [$organization, $administrator] = $this->tenantAdministrator();
        $profilePayload = $this->fixture('profile.json');

        $this->actingAs($administrator, 'sanctum')
            ->postJson('/api/v1/device-profiles', $profilePayload, $this->organizationHeaders($organization))
            ->assertBadRequest();

        $created = $this->actingAs($administrator, 'sanctum')
            ->postJson(
                '/api/v1/device-profiles',
                $profilePayload,
                $this->organizationHeaders($organization, ['Idempotency-Key' => 'create-profile-001']),
            )
            ->assertCreated()
            ->assertJsonPath('data.key', 'environment_thermostat')
            ->assertJsonPath('data.revision', 1);

        $profileUuid = (string) $created->json('data.uuid');
        $entityTag = (string) $created->headers->get('ETag');
        $this->assertNotSame('', $entityTag);
        $this->assertSame($entityTag, $created->json('etag'));

        $member = User::query()->where('email', 'acme.member@example.test')->firstOrFail();
        $this->actingAs($member, 'sanctum')
            ->getJson('/api/v1/device-profiles', $this->organizationHeaders($organization))
            ->assertOk()
            ->assertJsonCount(1, 'data');
        $this->actingAs($member, 'sanctum')
            ->postJson(
                '/api/v1/device-profiles',
                $profilePayload,
                $this->organizationHeaders($organization, ['Idempotency-Key' => 'member-create-001']),
            )
            ->assertForbidden();

        $this->actingAs($administrator, 'sanctum')
            ->patchJson(
                "/api/v1/device-profiles/{$profileUuid}",
                ['name' => 'Updated Environment Profile'],
                $this->organizationHeaders($organization),
            )
            ->assertStatus(428)
            ->assertHeader('Content-Type', 'application/problem+json');

        $stale = $this->actingAs($administrator, 'sanctum')
            ->patchJson(
                "/api/v1/device-profiles/{$profileUuid}",
                ['name' => 'Updated Environment Profile'],
                $this->organizationHeaders($organization, ['If-Match' => '"profile-stale-r0"']),
            )
            ->assertStatus(412)
            ->assertHeader('ETag', $entityTag)
            ->assertJsonPath('status', 412);
        $this->assertStringStartsWith('application/problem+json', (string) $stale->headers->get('Content-Type'));

        $updated = $this->actingAs($administrator, 'sanctum')
            ->patchJson(
                "/api/v1/device-profiles/{$profileUuid}",
                ['name' => 'Updated Environment Profile'],
                $this->organizationHeaders($organization, ['If-Match' => $entityTag]),
            )
            ->assertOk()
            ->assertJsonPath('data.name', 'Updated Environment Profile')
            ->assertJsonPath('data.revision', 2);
        $this->assertNotSame($entityTag, $updated->headers->get('ETag'));

        $otherOrganization = Organization::query()->where('slug', 'northstar-utilities')->firstOrFail();
        $otherProfile = DeviceProfile::query()->create([
            'organization_id' => $otherOrganization->id,
            'key' => 'other-profile',
            'name' => 'Other Profile',
        ]);

        $this->actingAs($administrator, 'sanctum')
            ->getJson(
                "/api/v1/device-profiles/{$otherProfile->uuid}",
                $this->organizationHeaders($organization),
            )
            ->assertNotFound();
    }

    /** @throws JsonException */
    public function test_profile_and_binding_versions_can_be_listed_cloned_and_safely_deleted(): void
    {
        [$organization, $administrator] = $this->tenantAdministrator();

        $profileResponse = $this->actingAs($administrator, 'sanctum')
            ->postJson(
                '/api/v1/device-profiles',
                $this->fixture('profile.json'),
                $this->organizationHeaders($organization, ['Idempotency-Key' => 'create-profile-versions']),
            )
            ->assertCreated();
        $profile = DeviceProfile::query()->where('uuid', $profileResponse->json('data.uuid'))->firstOrFail();
        $profileVersion = $profile->versions()->firstOrFail();

        $this->actingAs($administrator, 'sanctum')
            ->getJson(
                "/api/v1/device-profiles/{$profile->uuid}/versions",
                $this->organizationHeaders($organization),
            )
            ->assertOk()
            ->assertJsonCount(1, 'data');

        $profileVersionPayload = $this->fixture('profile.json');
        $profileVersionPayload['profile']['uuid'] = $profile->uuid;
        $profileVersionPayload['version']['uuid'] = (string) Str::uuid();
        $profileVersionPayload['version']['version'] = 2;
        $createdProfileVersion = $this->actingAs($administrator, 'sanctum')
            ->postJson(
                "/api/v1/device-profiles/{$profile->uuid}/versions",
                $profileVersionPayload,
                $this->organizationHeaders($organization, ['Idempotency-Key' => 'create-profile-version-2']),
            )
            ->assertCreated()
            ->assertJsonPath('data.version', 2);

        $clonedProfile = $this->actingAs($administrator, 'sanctum')
            ->postJson(
                "/api/v1/device-profile-versions/{$profileVersion->uuid}/clone",
                [],
                $this->organizationHeaders($organization, ['Idempotency-Key' => 'clone-profile-version']),
            )
            ->assertCreated()
            ->assertJsonPath('data.version', 3);

        $this->actingAs($administrator, 'sanctum')
            ->deleteJson(
                '/api/v1/device-profile-versions/'.$clonedProfile->json('data.uuid'),
                [],
                $this->organizationHeaders($organization, ['If-Match' => $clonedProfile->headers->get('ETag')]),
            )
            ->assertNoContent();

        $bindingResponse = $this->actingAs($administrator, 'sanctum')
            ->postJson(
                '/api/v1/transport-bindings',
                $this->fixture('binding.json'),
                $this->organizationHeaders($organization, ['Idempotency-Key' => 'create-binding-versions']),
            )
            ->assertCreated();
        $bindingVersion = TransportBindingVersion::query()
            ->where('uuid', $bindingResponse->json('data.versions.0.uuid'))
            ->firstOrFail();

        $bindingVersionPayload = $this->fixture('binding.json');
        $bindingVersionPayload['binding']['uuid'] = $bindingVersion->binding->uuid;
        $bindingVersionPayload['version']['uuid'] = (string) Str::uuid();
        $bindingVersionPayload['version']['profile_version_uuid'] = $createdProfileVersion->json('data.uuid');
        $bindingVersionPayload['version']['version'] = 2;
        $this->actingAs($administrator, 'sanctum')
            ->postJson(
                "/api/v1/transport-bindings/{$bindingVersion->binding->uuid}/versions",
                $bindingVersionPayload,
                $this->organizationHeaders($organization, ['Idempotency-Key' => 'create-binding-version-2']),
            )
            ->assertCreated()
            ->assertJsonPath('data.version', 2);

        $clonedBinding = $this->actingAs($administrator, 'sanctum')
            ->postJson(
                "/api/v1/transport-binding-versions/{$bindingVersion->uuid}/clone",
                [],
                $this->organizationHeaders($organization, ['Idempotency-Key' => 'clone-binding-version']),
            )
            ->assertCreated()
            ->assertJsonPath('data.version', 3);

        $this->actingAs($administrator, 'sanctum')
            ->deleteJson(
                '/api/v1/transport-binding-versions/'.$clonedBinding->json('data.uuid'),
                [],
                $this->organizationHeaders($organization, ['If-Match' => $clonedBinding->headers->get('ETag')]),
            )
            ->assertNoContent();

        $binding = $bindingVersion->binding;
        $this->actingAs($administrator, 'sanctum')
            ->getJson(
                "/api/v1/transport-bindings/{$binding->uuid}",
                $this->organizationHeaders($organization),
            )
            ->assertOk()
            ->assertJsonPath('data.name', $binding->name);

        $updatedBinding = $this->actingAs($administrator, 'sanctum')
            ->patchJson(
                "/api/v1/transport-bindings/{$binding->uuid}",
                ['name' => 'Updated Native MQTT Binding'],
                $this->organizationHeaders($organization, ['If-Match' => $bindingResponse->headers->get('ETag')]),
            )
            ->assertOk()
            ->assertJsonPath('data.name', 'Updated Native MQTT Binding');

        $this->actingAs($administrator, 'sanctum')
            ->deleteJson(
                "/api/v1/transport-bindings/{$binding->uuid}",
                [],
                $this->organizationHeaders($organization, ['If-Match' => $updatedBinding->headers->get('ETag')]),
            )
            ->assertNoContent();

        $this->actingAs($administrator, 'sanctum')
            ->deleteJson(
                "/api/v1/device-profiles/{$profile->uuid}",
                [],
                $this->organizationHeaders($organization, ['If-Match' => $profile->refresh()->etag()]),
            )
            ->assertNoContent();
    }

    /** @throws JsonException */
    public function test_coordinated_validation_retains_invalid_results_rejects_stale_evidence_and_publishes_current_valid_evidence(): void
    {
        [$organization, $administrator] = $this->tenantAdministrator();
        $draft = $this->createCoordinatedDraft($organization, $administrator);
        $bindingVersionUuid = (string) $draft->json('data.binding.version.uuid');
        $entityTag = (string) $draft->headers->get('ETag');

        Http::fakeSequence()
            ->push($this->preview(valid: false), 200)
            ->push($this->preview(valid: true), 200)
            ->push($this->preview(valid: true), 200);
        $this->actingAs($administrator, 'sanctum')
            ->postJson(
                "/api/v1/definition-drafts/{$bindingVersionUuid}/validate",
                ['fixtures' => [$this->telemetryFixture()]],
                $this->organizationHeaders($organization, ['If-Match' => $entityTag]),
            )
            ->assertOk()
            ->assertJsonPath('valid', false)
            ->assertJsonPath('diagnostics.0.code', 'INVALID_CEL');
        $this->assertDatabaseCount('definition_test_runs', 1);

        $this->actingAs($administrator, 'sanctum')
            ->postJson(
                "/api/v1/definition-drafts/{$bindingVersionUuid}/validate",
                ['fixtures' => [$this->telemetryFixture()]],
                $this->organizationHeaders($organization, ['If-Match' => $entityTag]),
            )
            ->assertOk()
            ->assertJsonPath('valid', true);

        $replaced = $this->actingAs($administrator, 'sanctum')
            ->putJson(
                "/api/v1/definition-drafts/{$bindingVersionUuid}",
                ['profile' => $this->fixture('profile.json'), 'binding' => $this->fixture('binding.json')],
                $this->organizationHeaders($organization, ['If-Match' => $entityTag]),
            )
            ->assertOk();
        $currentEntityTag = (string) $replaced->headers->get('ETag');

        $this->actingAs($administrator, 'sanctum')
            ->postJson(
                "/api/v1/definition-drafts/{$bindingVersionUuid}/publish",
                [],
                $this->organizationHeaders($organization, [
                    'If-Match' => $currentEntityTag,
                    'Idempotency-Key' => 'publish-with-stale-evidence',
                ]),
            )
            ->assertConflict()
            ->assertJsonPath('status', 409);

        $this->actingAs($administrator, 'sanctum')
            ->postJson(
                "/api/v1/definition-drafts/{$bindingVersionUuid}/validate",
                ['fixtures' => [$this->telemetryFixture()]],
                $this->organizationHeaders($organization, ['If-Match' => $currentEntityTag]),
            )
            ->assertOk()
            ->assertJsonPath('valid', true);

        $this->actingAs($administrator, 'sanctum')
            ->postJson(
                "/api/v1/definition-drafts/{$bindingVersionUuid}/publish",
                [],
                $this->organizationHeaders($organization, [
                    'If-Match' => $currentEntityTag,
                    'Idempotency-Key' => 'publish-current-evidence',
                ]),
            )
            ->assertOk()
            ->assertJsonPath('data.binding.version.uuid', $bindingVersionUuid);

        $publishedBinding = TransportBindingVersion::query()->where('uuid', $bindingVersionUuid)->firstOrFail();
        $this->assertSame('published', $publishedBinding->state->value);
        $this->assertSame('published', $publishedBinding->profileVersion->state->value);

        $this->assertDatabaseCount('definition_test_runs', 3);
        $this->assertSame(2, DefinitionTestRun::query()->where('valid', true)->count());
    }

    /** @throws JsonException */
    public function test_compiler_transport_failure_is_exposed_as_a_service_unavailable_problem(): void
    {
        [$organization, $administrator] = $this->tenantAdministrator();
        $draft = $this->createCoordinatedDraft($organization, $administrator);
        $bindingVersionUuid = (string) $draft->json('data.binding.version.uuid');

        Http::fake(['*' => Http::response(['error' => 'unavailable'], 503)]);

        $response = $this->actingAs($administrator, 'sanctum')
            ->postJson(
                "/api/v1/definition-drafts/{$bindingVersionUuid}/validate",
                ['fixtures' => [$this->telemetryFixture()]],
                $this->organizationHeaders($organization, ['If-Match' => $draft->headers->get('ETag')]),
            )
            ->assertServiceUnavailable()
            ->assertJsonPath('status', 503)
            ->assertJsonPath('title', 'Service Unavailable');

        $this->assertStringStartsWith('application/problem+json', (string) $response->headers->get('Content-Type'));
        $this->assertDatabaseCount('definition_test_runs', 0);
    }

    /** @throws JsonException */
    public function test_device_draft_assignment_registration_and_archive_lifecycle_is_enforced(): void
    {
        [$organization, $administrator] = $this->tenantAdministrator();
        [$profileVersion, $bindingVersion] = $this->publishedDefinition($organization, $administrator);

        $created = $this->actingAs($administrator, 'sanctum')
            ->postJson(
                '/api/v1/devices',
                [
                    'name' => 'Boiler Room Sensor',
                    'external_id' => 'boiler-room-sensor-001',
                    'description' => 'Temperature and humidity sensor with thermostat control.',
                ],
                $this->organizationHeaders($organization, ['Idempotency-Key' => 'create-device-001']),
            )
            ->assertCreated()
            ->assertJsonPath('data.lifecycle_state', 'draft');
        $deviceUuid = (string) $created->json('data.uuid');
        $deviceEntityTag = (string) $created->headers->get('ETag');

        $assignment = $this->actingAs($administrator, 'sanctum')
            ->putJson(
                "/api/v1/devices/{$deviceUuid}/definition-assignment",
                [
                    'profile_version_uuid' => $profileVersion->uuid,
                    'binding_version_uuid' => $bindingVersion->uuid,
                ],
                $this->organizationHeaders($organization, ['If-Match' => $deviceEntityTag]),
            )
            ->assertOk()
            ->assertJsonPath('data.profile_version_uuid', $profileVersion->uuid)
            ->assertJsonPath('data.binding_version_uuid', $bindingVersion->uuid);
        $this->assertNotSame($deviceEntityTag, $assignment->headers->get('ETag'));

        $this->actingAs($administrator, 'sanctum')
            ->deleteJson(
                "/api/v1/devices/{$deviceUuid}",
                [],
                $this->organizationHeaders($organization, ['If-Match' => $deviceEntityTag]),
            )
            ->assertConflict();

        $registered = $this->actingAs($administrator, 'sanctum')
            ->postJson(
                "/api/v1/devices/{$deviceUuid}/register",
                [],
                $this->organizationHeaders($organization, [
                    'If-Match' => $deviceEntityTag,
                    'Idempotency-Key' => 'register-device-001',
                ]),
            )
            ->assertOk()
            ->assertJsonPath('data.lifecycle_state', 'registered');
        $registeredEntityTag = (string) $registered->headers->get('ETag');

        $this->actingAs($administrator, 'sanctum')
            ->putJson(
                "/api/v1/devices/{$deviceUuid}/definition-assignment",
                [
                    'profile_version_uuid' => $profileVersion->uuid,
                    'binding_version_uuid' => $bindingVersion->uuid,
                ],
                $this->organizationHeaders($organization, ['If-Match' => $assignment->headers->get('ETag')]),
            )
            ->assertForbidden();

        $archived = $this->actingAs($administrator, 'sanctum')
            ->postJson(
                "/api/v1/devices/{$deviceUuid}/archive",
                [],
                $this->organizationHeaders($organization, [
                    'If-Match' => $registeredEntityTag,
                    'Idempotency-Key' => 'archive-device-001',
                ]),
            )
            ->assertOk()
            ->assertJsonPath('data.lifecycle_state', 'archived');

        $this->assertNotSame($registeredEntityTag, $archived->headers->get('ETag'));
        $this->assertNotNull(Device::query()->where('uuid', $deviceUuid)->firstOrFail()->archived_at);
        $this->assertNotNull(DeviceDefinitionAssignment::query()->firstOrFail()->locked_at);
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
     * @param  array<string, string>  $extra
     * @return array<string, string>
     */
    private function organizationHeaders(Organization $organization, array $extra = []): array
    {
        return [
            'X-Organization-UUID' => $organization->uuid,
            ...$extra,
        ];
    }

    /** @throws JsonException */
    private function createCoordinatedDraft(Organization $organization, User $administrator): TestResponse
    {
        return $this->actingAs($administrator, 'sanctum')
            ->postJson(
                '/api/v1/definition-drafts',
                [
                    'profile' => $this->fixture('profile.json'),
                    'binding' => $this->fixture('binding.json'),
                ],
                $this->organizationHeaders($organization, ['Idempotency-Key' => 'create-definition-draft']),
            )
            ->assertCreated();
    }

    /** @return array{DeviceProfileVersion, TransportBindingVersion} */
    private function publishedDefinition(Organization $organization, User $administrator): array
    {
        $draft = $this->createCoordinatedDraft($organization, $administrator);
        $bindingVersionUuid = (string) $draft->json('data.binding.version.uuid');
        $entityTag = (string) $draft->headers->get('ETag');
        Http::fake(['*' => Http::response($this->preview(valid: true), 200)]);

        $this->actingAs($administrator, 'sanctum')
            ->postJson(
                "/api/v1/definition-drafts/{$bindingVersionUuid}/validate",
                ['fixtures' => [$this->telemetryFixture()]],
                $this->organizationHeaders($organization, ['If-Match' => $entityTag]),
            )
            ->assertOk();
        $this->actingAs($administrator, 'sanctum')
            ->postJson(
                "/api/v1/definition-drafts/{$bindingVersionUuid}/publish",
                [],
                $this->organizationHeaders($organization, [
                    'If-Match' => $entityTag,
                    'Idempotency-Key' => 'publish-definition-draft',
                ]),
            )
            ->assertOk();

        $bindingVersion = TransportBindingVersion::query()->where('uuid', $bindingVersionUuid)->firstOrFail();

        return [$bindingVersion->profileVersion, $bindingVersion];
    }

    /** @return array<string, mixed> */
    private function preview(bool $valid): array
    {
        return [
            'schema' => 'iot.definition-preview.v1',
            'valid' => $valid,
            'input_hash' => str_repeat('c', 64),
            'compiler' => [
                'name' => 'iot-definition-compiler',
                'version' => '1.0.0',
                'cel_environment' => 'cel-go-v0.26-restricted-v1',
                'jsonpath_version' => 'ojg-v1-restricted-v1',
                'unit_registry' => 'ucum-v1',
            ],
            'diagnostics' => $valid ? [] : [[
                'severity' => 'error',
                'code' => 'INVALID_CEL',
                'path' => '/profile/version/components',
                'message' => 'Invalid expression.',
            ]],
            'profile_artifact' => $valid ? ['schema' => 'iot.device-profile.v1'] : null,
            'binding_artifact' => $valid ? ['schema' => 'iot.native-mqtt-binding.v1'] : null,
            'artifact_hashes' => [
                'profile' => $valid ? str_repeat('a', 64) : null,
                'binding' => $valid ? str_repeat('b', 64) : null,
            ],
            'previews' => [],
        ];
    }

    /** @return array<string, mixed> */
    private function telemetryFixture(): array
    {
        return [
            'name' => 'temperature and humidity telemetry',
            'kind' => 'telemetry',
            'input' => $this->fixture('telemetry-payload.json'),
        ];
    }

    /**
     * @return array<string, mixed>
     *
     * @throws JsonException
     */
    private function fixture(string $name): array
    {
        $path = base_path("../../contracts/fixtures/device-onboarding/valid/temperature-humidity-thermostat/{$name}");
        $contents = file_get_contents($path);
        $this->assertNotFalse($contents);

        return json_decode($contents, true, flags: JSON_THROW_ON_ERROR);
    }
}
