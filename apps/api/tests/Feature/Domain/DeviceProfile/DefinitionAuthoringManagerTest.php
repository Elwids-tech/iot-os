<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\DeviceProfile;

use App\Domain\DeviceProfile\Data\DefinitionTestResultData;
use App\Domain\DeviceProfile\Data\DeviceProfileAuthoringData;
use App\Domain\DeviceProfile\Data\NativeMqttBindingAuthoringData;
use App\Domain\DeviceProfile\Enums\DefinitionState;
use App\Domain\DeviceProfile\Services\DefinitionAuthoringManager;
use App\Domain\DeviceProfile\Services\DefinitionLifecycleManager;
use App\Domain\Shared\Concurrency\PreconditionRequired;
use App\Domain\Shared\Concurrency\StaleEntityTag;
use App\Domain\Shared\Exceptions\DomainInvariantViolation;
use App\Domain\Shared\Models\Organization;
use Illuminate\Foundation\Testing\RefreshDatabase;
use JsonException;
use Tests\TestCase;

final class DefinitionAuthoringManagerTest extends TestCase
{
    use RefreshDatabase;

    /**
     * @throws JsonException
     */
    public function test_it_creates_coordinated_profile_and_native_mqtt_binding_drafts(): void
    {
        $organization = Organization::factory()->create();
        $authoring = app(DefinitionAuthoringManager::class);
        $profileData = DeviceProfileAuthoringData::fromArray($this->fixture('profile.json'));

        $profileVersion = $authoring->createProfileDraft($organization, $profileData);
        $profile = $profileVersion->profile;
        $bindingData = NativeMqttBindingAuthoringData::fromArray($this->fixture('binding.json'));
        $bindingVersion = $authoring->createBindingDraft($profile, $profileVersion, $bindingData);

        $this->assertSame($organization->id, $profile->organization_id);
        $this->assertSame('environment_thermostat', $profile->key);
        $this->assertSame(DefinitionState::DRAFT, $profileVersion->state);
        $this->assertSame($profileData->versionDefinition(), $profileVersion->definition);
        $this->assertSame($profileVersion->id, $bindingVersion->device_profile_version_id);
        $this->assertSame('native_mqtt_json', $bindingVersion->binding->transport);
        $this->assertSame($bindingData->versionDefinition(), $bindingVersion->definition);
        $this->assertSame('"profile-version-'.$profileVersion->uuid.'-r1"', $profileVersion->etag());
    }

    /**
     * @throws JsonException
     */
    public function test_draft_replacement_requires_a_current_entity_tag_and_preserves_identity(): void
    {
        $organization = Organization::factory()->create();
        $authoring = app(DefinitionAuthoringManager::class);
        $payload = $this->fixture('profile.json');
        $version = $authoring->createProfileDraft(
            $organization,
            DeviceProfileAuthoringData::fromArray($payload),
        );

        $this->expectException(PreconditionRequired::class);
        $authoring->replaceProfileVersionDraft(
            $version,
            DeviceProfileAuthoringData::fromArray($payload),
            null,
        );
    }

    /**
     * @throws JsonException
     */
    public function test_stale_entity_tags_are_rejected_after_a_successful_revision(): void
    {
        $organization = Organization::factory()->create();
        $authoring = app(DefinitionAuthoringManager::class);
        $payload = $this->fixture('profile.json');
        $version = $authoring->createProfileDraft(
            $organization,
            DeviceProfileAuthoringData::fromArray($payload),
        );
        $staleEntityTag = $version->etag();
        $payload['version']['notes'] = 'Revised locally.';

        $authoring->replaceProfileVersionDraft(
            $version,
            DeviceProfileAuthoringData::fromArray($payload),
            $staleEntityTag,
        );

        $this->assertSame(2, $version->revision);
        $this->assertSame('"profile-version-'.$version->uuid.'-r2"', $version->etag());

        $this->expectException(StaleEntityTag::class);
        $authoring->replaceProfileVersionDraft(
            $version,
            DeviceProfileAuthoringData::fromArray($payload),
            $staleEntityTag,
        );
    }

    /**
     * @throws JsonException
     */
    public function test_publication_requires_current_valid_evidence_and_makes_versions_immutable(): void
    {
        $organization = Organization::factory()->create();
        $authoring = app(DefinitionAuthoringManager::class);
        $lifecycle = app(DefinitionLifecycleManager::class);
        $profilePayload = $this->fixture('profile.json');
        $profileVersion = $authoring->createProfileDraft(
            $organization,
            DeviceProfileAuthoringData::fromArray($profilePayload),
        );
        $bindingVersion = $authoring->createBindingDraft(
            $profileVersion->profile,
            $profileVersion,
            NativeMqttBindingAuthoringData::fromArray($this->fixture('binding.json')),
        );

        $staleRun = $lifecycle->recordTestRun(
            $profileVersion,
            $bindingVersion,
            DefinitionTestResultData::fromArray($this->validPreview()),
        );

        $profilePayload['version']['notes'] = 'Changed after validation.';
        $authoring->replaceProfileVersionDraft(
            $profileVersion,
            DeviceProfileAuthoringData::fromArray($profilePayload),
            $profileVersion->etag(),
        );

        try {
            $lifecycle->publish(
                $profileVersion,
                $bindingVersion,
                $staleRun,
                $profileVersion->etag(),
                $bindingVersion->etag(),
            );
            $this->fail('A stale validation run must not publish.');
        } catch (DomainInvariantViolation $exception) {
            $this->assertStringContainsString('current draft revisions', $exception->getMessage());
        }

        $currentRun = $lifecycle->recordTestRun(
            $profileVersion,
            $bindingVersion,
            DefinitionTestResultData::fromArray($this->validPreview()),
        );
        $lifecycle->publish(
            $profileVersion,
            $bindingVersion,
            $currentRun,
            $profileVersion->etag(),
            $bindingVersion->etag(),
        );

        $this->assertSame(DefinitionState::PUBLISHED, $profileVersion->state);
        $this->assertSame(DefinitionState::PUBLISHED, $bindingVersion->state);
        $this->assertSame(str_repeat('a', 64), $profileVersion->artifact_hash);
        $this->assertSame(str_repeat('b', 64), $bindingVersion->artifact_hash);

        $this->expectException(DomainInvariantViolation::class);
        $authoring->replaceProfileVersionDraft(
            $profileVersion,
            DeviceProfileAuthoringData::fromArray($profilePayload),
            $profileVersion->etag(),
        );
    }

    /**
     * @throws JsonException
     */
    public function test_archiving_a_profile_freezes_its_draft_versions(): void
    {
        $organization = Organization::factory()->create();
        $authoring = app(DefinitionAuthoringManager::class);
        $profileData = DeviceProfileAuthoringData::fromArray($this->fixture('profile.json'));
        $profileVersion = $authoring->createProfileDraft($organization, $profileData);
        $profile = $profileVersion->profile;

        $authoring->archiveProfile($profile, $profile->etag());

        $this->expectException(DomainInvariantViolation::class);
        $authoring->replaceProfileVersionDraft($profileVersion, $profileData, $profileVersion->etag());
    }

    /**
     * @throws JsonException
     */
    public function test_archived_catalogs_cannot_be_published(): void
    {
        $organization = Organization::factory()->create();
        $authoring = app(DefinitionAuthoringManager::class);
        $lifecycle = app(DefinitionLifecycleManager::class);
        $profileVersion = $authoring->createProfileDraft(
            $organization,
            DeviceProfileAuthoringData::fromArray($this->fixture('profile.json')),
        );
        $bindingVersion = $authoring->createBindingDraft(
            $profileVersion->profile,
            $profileVersion,
            NativeMqttBindingAuthoringData::fromArray($this->fixture('binding.json')),
        );
        $testRun = $lifecycle->recordTestRun(
            $profileVersion,
            $bindingVersion,
            DefinitionTestResultData::fromArray($this->validPreview()),
        );
        $binding = $bindingVersion->binding;

        $authoring->archiveBinding($binding, $binding->etag());

        $this->expectException(DomainInvariantViolation::class);
        $lifecycle->publish(
            $profileVersion,
            $bindingVersion,
            $testRun,
            $profileVersion->etag(),
            $bindingVersion->etag(),
        );
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

    /**
     * @return array<string, mixed>
     */
    private function validPreview(): array
    {
        return [
            'schema' => 'iot.definition-preview.v1',
            'valid' => true,
            'input_hash' => str_repeat('c', 64),
            'compiler' => [
                'name' => 'iot-definition-compiler',
                'version' => 'test',
                'cel_environment' => 'v1',
                'jsonpath_version' => 'v1',
                'unit_registry' => 'ucum-v1',
            ],
            'diagnostics' => [],
            'profile_artifact' => ['schema' => 'iot.device-profile.v1'],
            'binding_artifact' => ['schema' => 'iot.native-mqtt-binding.v1'],
            'artifact_hashes' => [
                'profile' => str_repeat('a', 64),
                'binding' => str_repeat('b', 64),
            ],
            'previews' => [],
        ];
    }
}
