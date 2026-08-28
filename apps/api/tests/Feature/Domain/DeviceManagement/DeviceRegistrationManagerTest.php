<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\DeviceManagement;

use App\Domain\DeviceManagement\Data\DeviceDraftData;
use App\Domain\DeviceManagement\Enums\DeviceLifecycleState;
use App\Domain\DeviceManagement\Services\DeviceRegistrationManager;
use App\Domain\DeviceProfile\Data\DefinitionTestResultData;
use App\Domain\DeviceProfile\Data\DeviceProfileAuthoringData;
use App\Domain\DeviceProfile\Data\NativeMqttBindingAuthoringData;
use App\Domain\DeviceProfile\Models\DeviceProfileVersion;
use App\Domain\DeviceProfile\Models\TransportBindingVersion;
use App\Domain\DeviceProfile\Services\DefinitionAuthoringManager;
use App\Domain\DeviceProfile\Services\DefinitionLifecycleManager;
use App\Domain\Shared\Exceptions\DomainInvariantViolation;
use App\Domain\Shared\Models\Organization;
use Illuminate\Foundation\Testing\RefreshDatabase;
use JsonException;
use Tests\TestCase;

final class DeviceRegistrationManagerTest extends TestCase
{
    use RefreshDatabase;

    /**
     * @throws JsonException
     */
    public function test_a_device_draft_pins_a_published_definition_before_registration(): void
    {
        $organization = Organization::factory()->create();
        [$profileVersion, $bindingVersion] = $this->publishedDefinition($organization);
        $manager = app(DeviceRegistrationManager::class);
        $device = $manager->createDraft(
            $organization,
            DeviceDraftData::fromArray([
                'name' => 'Boiler room environment controller',
                'external_id' => 'sensor-001',
                'description' => 'Temperature and humidity controller.',
            ]),
        );

        $assignment = $manager->replaceDefinitionAssignment(
            $device,
            $profileVersion,
            $bindingVersion,
            $device->etag(),
        );
        $draftAssignmentEntityTag = $assignment->etag();

        $registered = $manager->register($device, $device->etag());
        $assignment->refresh();

        $this->assertSame(DeviceLifecycleState::REGISTERED, $registered->lifecycle_state);
        $this->assertNotNull($registered->registered_at);
        $this->assertTrue($assignment->isLocked());
        $this->assertSame(2, $assignment->revision);
        $this->assertNotSame($draftAssignmentEntityTag, $assignment->etag());
        $this->assertSame($profileVersion->id, $assignment->device_profile_version_id);
        $this->assertSame($bindingVersion->id, $assignment->transport_binding_version_id);

        $this->expectException(DomainInvariantViolation::class);
        $manager->replaceDefinitionAssignment(
            $registered,
            $profileVersion,
            $bindingVersion,
            $assignment->etag(),
        );
    }

    /**
     * @throws JsonException
     */
    public function test_archived_definitions_cannot_be_assigned_to_new_devices(): void
    {
        $organization = Organization::factory()->create();
        [$profileVersion, $bindingVersion] = $this->publishedDefinition($organization);
        $authoring = app(DefinitionAuthoringManager::class);
        $manager = app(DeviceRegistrationManager::class);
        $profile = $profileVersion->profile;
        $device = $manager->createDraft(
            $organization,
            DeviceDraftData::fromArray([
                'name' => 'Boiler room environment controller',
                'external_id' => 'sensor-001',
            ]),
        );

        $authoring->archiveProfile($profile, $profile->etag());

        $this->expectException(DomainInvariantViolation::class);
        $manager->replaceDefinitionAssignment(
            $device,
            $profileVersion,
            $bindingVersion,
            $device->etag(),
        );
    }

    /**
     * @throws JsonException
     */
    public function test_cross_organization_definitions_cannot_be_assigned(): void
    {
        $deviceOrganization = Organization::factory()->create();
        $definitionOrganization = Organization::factory()->create();
        [$profileVersion, $bindingVersion] = $this->publishedDefinition($definitionOrganization);
        $manager = app(DeviceRegistrationManager::class);
        $device = $manager->createDraft(
            $deviceOrganization,
            DeviceDraftData::fromArray(['name' => 'Sensor', 'external_id' => 'sensor-001']),
        );

        $this->expectException(DomainInvariantViolation::class);
        $manager->replaceDefinitionAssignment(
            $device,
            $profileVersion,
            $bindingVersion,
            $device->etag(),
        );
    }

    /**
     * @return array{DeviceProfileVersion, TransportBindingVersion}
     *
     * @throws JsonException
     */
    private function publishedDefinition(Organization $organization): array
    {
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
        $run = $lifecycle->recordTestRun(
            $profileVersion,
            $bindingVersion,
            DefinitionTestResultData::fromArray([
                'schema' => 'iot.definition-preview.v1',
                'valid' => true,
                'input_hash' => str_repeat('c', 64),
                'compiler' => ['name' => 'test'],
                'diagnostics' => [],
                'profile_artifact' => ['schema' => 'iot.device-profile.v1'],
                'binding_artifact' => ['schema' => 'iot.native-mqtt-binding.v1'],
                'artifact_hashes' => [
                    'profile' => str_repeat('a', 64),
                    'binding' => str_repeat('b', 64),
                ],
                'previews' => [],
            ]),
        );
        $lifecycle->publish(
            $profileVersion,
            $bindingVersion,
            $run,
            $profileVersion->etag(),
            $bindingVersion->etag(),
        );

        return [$profileVersion, $bindingVersion];
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
