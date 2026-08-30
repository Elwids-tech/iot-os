<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Services;

use App\Domain\DeviceManagement\Models\DeviceDefinitionAssignment;
use App\Domain\DeviceManagement\Models\GatewayRoute;
use App\Domain\DeviceProfile\Data\DeviceProfileAuthoringData;
use App\Domain\DeviceProfile\Data\NativeMqttBindingAuthoringData;
use App\Domain\DeviceProfile\Enums\DefinitionState;
use App\Domain\DeviceProfile\Models\DeviceProfile;
use App\Domain\DeviceProfile\Models\DeviceProfileVersion;
use App\Domain\DeviceProfile\Models\TransportBinding;
use App\Domain\DeviceProfile\Models\TransportBindingVersion;
use App\Domain\Shared\Exceptions\DomainInvariantViolation;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class DefinitionAuthoringManager
{
    public function createProfileDraft(
        Organization $organization,
        DeviceProfileAuthoringData $data,
        ?User $actor = null,
    ): DeviceProfile {
        return DB::transaction(function () use ($organization, $data, $actor): DeviceProfile {
            $this->assertProfileIdentityAvailable($organization, $data);

            $profile = DeviceProfile::query()->create([
                'uuid' => $data->profileUuid(),
                'organization_id' => $organization->getKey(),
                'key' => $data->profileKey(),
                'name' => $data->profileName(),
                'description' => $data->profileDescription(),
            ]);

            $version = $profile->versions()->create([
                'uuid' => $data->versionUuid(),
                'organization_id' => $organization->getKey(),
                'version' => $data->versionNumber(),
                'state' => DefinitionState::DRAFT,
                'definition' => $data->versionDefinition(),
                'created_by_id' => $actor?->getKey(),
            ]);

            return $profile->setRelation('versions', $profile->newCollection([$version]));
        });
    }

    public function replaceProfileDraft(
        DeviceProfile $profile,
        DeviceProfileAuthoringData $data,
        ?string $expectedEntityTag,
    ): DeviceProfile {
        $profile->assertExpectedEntityTag($expectedEntityTag);

        return DB::transaction(function () use ($profile, $data, $expectedEntityTag): DeviceProfile {
            $lockedProfile = DeviceProfile::query()->lockForUpdate()->findOrFail($profile->getKey());
            $lockedProfile->assertExpectedEntityTag($expectedEntityTag);
            $version = $this->editableProfileVersion($lockedProfile);

            if (
                $data->profileUuid() !== $lockedProfile->uuid
                || $data->profileKey() !== $lockedProfile->key
                || $data->versionUuid() !== $version->uuid
                || $data->versionNumber() !== $version->version
            ) {
                throw new DomainInvariantViolation('A Profile draft replacement cannot change catalog or Version identity.');
            }

            $lockedProfile->forceFill([
                'name' => $data->profileName(),
                'description' => $data->profileDescription(),
                'revision' => $lockedProfile->revision + 1,
            ])->save();

            $version->forceFill([
                'definition' => $data->versionDefinition(),
                'revision' => $version->revision + 1,
                'artifact' => null,
                'artifact_hash' => null,
                'source_hash' => null,
                'compiler' => null,
            ])->save();

            return $lockedProfile->refresh()->setRelation(
                'versions',
                $lockedProfile->newCollection([$version->refresh()]),
            );
        });
    }

    public function deleteProfileDraft(DeviceProfile $profile, ?string $expectedEntityTag): void
    {
        $profile->assertExpectedEntityTag($expectedEntityTag);

        DB::transaction(function () use ($profile, $expectedEntityTag): void {
            $locked = DeviceProfile::query()->lockForUpdate()->findOrFail($profile->getKey());
            $locked->assertExpectedEntityTag($expectedEntityTag);
            $versions = $locked->versions()->lockForUpdate()->get();

            if (
                $locked->isArchived()
                || $versions->contains(fn (DeviceProfileVersion $version): bool => ! $version->isDraft())
            ) {
                throw new DomainInvariantViolation('Only an active Device Profile containing drafts can be deleted here.');
            }

            $versionIds = $versions->modelKeys();

            if (
                $locked->transportBindings()->exists()
                || DeviceDefinitionAssignment::query()->whereIn('device_profile_version_id', $versionIds)->exists()
                || GatewayRoute::query()->whereIn('device_profile_version_id', $versionIds)->exists()
            ) {
                throw new DomainInvariantViolation('A referenced Device Profile draft cannot be deleted.');
            }

            DeviceProfileVersion::query()->whereIn('id', $versionIds)->delete();
            $locked->delete();
        });
    }

    public function createBindingDraft(
        Organization $organization,
        DeviceProfile $profile,
        DeviceProfileVersion $profileVersion,
        NativeMqttBindingAuthoringData $data,
        ?User $actor = null,
    ): TransportBinding {
        return DB::transaction(function () use ($organization, $profile, $profileVersion, $data, $actor): TransportBinding {
            $lockedProfile = DeviceProfile::query()->lockForUpdate()->findOrFail($profile->getKey());
            $lockedProfileVersion = DeviceProfileVersion::query()->lockForUpdate()->findOrFail($profileVersion->getKey());
            $this->assertBindingProfile($organization, $lockedProfile, $lockedProfileVersion, $data);
            $this->assertBindingIdentityAvailable($organization, $data);

            $binding = TransportBinding::query()->create([
                'uuid' => $data->bindingUuid(),
                'organization_id' => $organization->getKey(),
                'device_profile_id' => $lockedProfile->getKey(),
                'key' => $data->bindingKey(),
                'name' => $data->bindingName(),
                'description' => $data->bindingDescription(),
                'transport' => 'native_mqtt_json',
            ]);

            $version = $binding->versions()->create([
                'uuid' => $data->versionUuid(),
                'organization_id' => $organization->getKey(),
                'device_profile_version_id' => $lockedProfileVersion->getKey(),
                'version' => $data->versionNumber(),
                'state' => DefinitionState::DRAFT,
                'definition' => $data->versionDefinition(),
                'created_by_id' => $actor?->getKey(),
            ]);

            return $binding->setRelation('versions', $binding->newCollection([$version]));
        });
    }

    public function replaceBindingDraft(
        TransportBinding $binding,
        NativeMqttBindingAuthoringData $data,
        ?string $expectedEntityTag,
    ): TransportBinding {
        $binding->assertExpectedEntityTag($expectedEntityTag);

        return DB::transaction(function () use ($binding, $data, $expectedEntityTag): TransportBinding {
            $lockedBinding = TransportBinding::query()->lockForUpdate()->findOrFail($binding->getKey());
            $lockedBinding->assertExpectedEntityTag($expectedEntityTag);
            $version = $this->editableBindingVersion($lockedBinding);
            $profile = $lockedBinding->profile()->lockForUpdate()->firstOrFail();
            $profileVersion = $version->profileVersion()->lockForUpdate()->firstOrFail();
            $this->assertBindingProfile($lockedBinding->organization, $profile, $profileVersion, $data);

            if (
                $data->bindingUuid() !== $lockedBinding->uuid
                || $data->bindingKey() !== $lockedBinding->key
                || $data->versionUuid() !== $version->uuid
                || $data->versionNumber() !== $version->version
            ) {
                throw new DomainInvariantViolation('A Binding draft replacement cannot change catalog or Version identity.');
            }

            $lockedBinding->forceFill([
                'name' => $data->bindingName(),
                'description' => $data->bindingDescription(),
                'revision' => $lockedBinding->revision + 1,
            ])->save();

            $version->forceFill([
                'definition' => $data->versionDefinition(),
                'revision' => $version->revision + 1,
                'artifact' => null,
                'artifact_hash' => null,
                'source_hash' => null,
                'compiler' => null,
            ])->save();

            return $lockedBinding->refresh()->setRelation(
                'versions',
                $lockedBinding->newCollection([$version->refresh()]),
            );
        });
    }

    public function deleteBindingDraft(TransportBinding $binding, ?string $expectedEntityTag): void
    {
        $binding->assertExpectedEntityTag($expectedEntityTag);

        DB::transaction(function () use ($binding, $expectedEntityTag): void {
            $locked = TransportBinding::query()->lockForUpdate()->findOrFail($binding->getKey());
            $locked->assertExpectedEntityTag($expectedEntityTag);
            $versions = $locked->versions()->lockForUpdate()->get();

            if (
                $locked->isArchived()
                || $versions->contains(fn (TransportBindingVersion $version): bool => ! $version->isDraft())
            ) {
                throw new DomainInvariantViolation('Only an active Native MQTT Binding containing drafts can be deleted here.');
            }

            $versionIds = $versions->modelKeys();

            if (
                DeviceDefinitionAssignment::query()->whereIn('transport_binding_version_id', $versionIds)->exists()
                || GatewayRoute::query()->whereIn('transport_binding_version_id', $versionIds)->exists()
            ) {
                throw new DomainInvariantViolation('A referenced Native MQTT Binding draft cannot be deleted.');
            }

            TransportBindingVersion::query()->whereIn('id', $versionIds)->delete();
            $locked->delete();
        });
    }

    public function cloneCompatibleProfileVersion(
        DeviceProfileVersion $source,
        ?User $actor = null,
    ): DeviceProfileVersion {
        return DB::transaction(function () use ($source, $actor): DeviceProfileVersion {
            $profile = $source->profile()->lockForUpdate()->firstOrFail();
            $lockedSource = DeviceProfileVersion::query()->lockForUpdate()->findOrFail($source->getKey());

            if ($profile->isArchived()) {
                throw new DomainInvariantViolation('Only an active Device Profile Version can be cloned compatibly.');
            }

            $nextVersion = ((int) $profile->versions()->max('version')) + 1;
            $versionUuid = (string) Str::uuid();
            $definition = $lockedSource->definition;
            $definition['uuid'] = $versionUuid;
            $definition['version'] = $nextVersion;

            $sourceData = $this->profileData($profile, $lockedSource);
            $cloneData = DeviceProfileAuthoringData::fromArray([
                'schema' => 'iot.device-profile.authoring.v1',
                'profile' => $sourceData->profile,
                'version' => $definition,
            ]);
            $cloneData->assertCompatibleCloneOf($sourceData);

            return $profile->versions()->create([
                'uuid' => $versionUuid,
                'organization_id' => $profile->organization_id,
                'version' => $nextVersion,
                'state' => DefinitionState::DRAFT,
                'definition' => $definition,
                'created_by_id' => $actor?->getKey(),
            ])->setRelation('profile', $profile);
        });
    }

    public function deleteLatestCompatibleProfileDraft(
        DeviceProfile $profile,
        ?string $expectedEntityTag,
    ): DeviceProfile {
        $profile->assertExpectedEntityTag($expectedEntityTag);

        return DB::transaction(function () use ($profile, $expectedEntityTag): DeviceProfile {
            $lockedProfile = DeviceProfile::query()->lockForUpdate()->findOrFail($profile->getKey());
            $lockedProfile->assertExpectedEntityTag($expectedEntityTag);
            $versions = $lockedProfile->versions()->lockForUpdate()->orderByDesc('version')->get();
            /** @var DeviceProfileVersion|null $draft */
            $draft = $versions->first();

            if ($lockedProfile->isArchived() || $versions->count() < 2 || $draft === null || ! $draft->isDraft()) {
                throw new DomainInvariantViolation('Only the latest compatible Device Profile draft can be discarded here.');
            }

            if (
                TransportBindingVersion::query()->where('device_profile_version_id', $draft->getKey())->exists()
                || DeviceDefinitionAssignment::query()->where('device_profile_version_id', $draft->getKey())->exists()
                || GatewayRoute::query()->where('device_profile_version_id', $draft->getKey())->exists()
            ) {
                throw new DomainInvariantViolation('A referenced Device Profile draft Version cannot be discarded.');
            }

            $draft->delete();

            return $lockedProfile->refresh();
        });
    }

    private function editableProfileVersion(DeviceProfile $profile): DeviceProfileVersion
    {
        if ($profile->isArchived()) {
            throw new DomainInvariantViolation('An archived Device Profile is immutable.');
        }

        $versions = $profile->versions()
            ->where('state', DefinitionState::DRAFT->value)
            ->lockForUpdate()
            ->get();

        if ($versions->count() !== 1) {
            throw new DomainInvariantViolation('An aggregate replacement requires exactly one editable draft Version.');
        }

        return $versions->firstOrFail();
    }

    private function editableBindingVersion(TransportBinding $binding): TransportBindingVersion
    {
        if ($binding->isArchived()) {
            throw new DomainInvariantViolation('An archived Native MQTT Binding is immutable.');
        }

        $versions = $binding->versions()
            ->where('state', DefinitionState::DRAFT->value)
            ->lockForUpdate()
            ->get();

        if ($versions->count() !== 1) {
            throw new DomainInvariantViolation('An aggregate replacement requires exactly one editable draft Version.');
        }

        return $versions->firstOrFail();
    }

    private function assertProfileIdentityAvailable(Organization $organization, DeviceProfileAuthoringData $data): void
    {
        if (
            DeviceProfile::query()->where('uuid', $data->profileUuid())->exists()
            || DeviceProfile::query()
                ->whereBelongsTo($organization)
                ->where('key', $data->profileKey())
                ->exists()
            || DeviceProfileVersion::query()->where('uuid', $data->versionUuid())->exists()
        ) {
            throw new DomainInvariantViolation('The Profile UUID, Version UUID, and tenant key must be unique.');
        }
    }

    private function assertBindingIdentityAvailable(Organization $organization, NativeMqttBindingAuthoringData $data): void
    {
        if (
            TransportBinding::query()->where('uuid', $data->bindingUuid())->exists()
            || TransportBinding::query()
                ->whereBelongsTo($organization)
                ->where('key', $data->bindingKey())
                ->exists()
            || TransportBindingVersion::query()->where('uuid', $data->versionUuid())->exists()
        ) {
            throw new DomainInvariantViolation('The Binding UUID, Version UUID, and tenant key must be unique.');
        }
    }

    private function assertBindingProfile(
        Organization $organization,
        DeviceProfile $profile,
        DeviceProfileVersion $profileVersion,
        NativeMqttBindingAuthoringData $data,
    ): void {
        if (
            $profile->organization_id !== $organization->getKey()
            || $profileVersion->organization_id !== $organization->getKey()
            || $profileVersion->device_profile_id !== $profile->getKey()
            || $profile->isArchived()
            || $profileVersion->state === DefinitionState::RETIRED
            || $profile->uuid !== $data->profileUuid()
            || $profileVersion->uuid !== $data->profileVersionUuid()
        ) {
            throw new DomainInvariantViolation('A Native MQTT Binding must target the exact Profile Version in the same Organization.');
        }

        $profileData = $this->profileData($profile, $profileVersion);
        $this->assertExactTargets('parameter', $profileData->measuredParameterUuids(), $data->targetParameterUuids());
        $this->assertExactTargets('property', $profileData->transportPropertyUuids(), $data->targetPropertyUuids());
        $this->assertExactTargets('event', $profileData->eventUuids(), $data->targetEventUuids());
        $this->assertTargetsExist('event field', $profileData->eventFieldUuids(), $data->targetEventFieldUuids());
        $this->assertExactTargets('command', $profileData->commandUuids(), $data->targetCommandUuids());
        $this->assertTargetsExist('command field', $profileData->commandFieldUuids(), $data->targetCommandFieldUuids());
        $this->assertBindingSemantics($profileData, $data);
    }

    private function profileData(
        DeviceProfile $profile,
        DeviceProfileVersion $version,
    ): DeviceProfileAuthoringData {
        return DeviceProfileAuthoringData::fromArray([
            'schema' => 'iot.device-profile.authoring.v1',
            'profile' => [
                'uuid' => $profile->uuid,
                'key' => $profile->key,
                'name' => $profile->name,
                'description' => $profile->description,
            ],
            'version' => $version->definition,
        ]);
    }

    /** @param list<string> $expected @param list<string> $actual */
    private function assertExactTargets(string $kind, array $expected, array $actual): void
    {
        sort($expected);
        sort($actual);

        if ($expected !== $actual) {
            throw new DomainInvariantViolation("Binding {$kind} mappings must cover exactly the Profile {$kind} identities.");
        }
    }

    /** @param list<string> $allowed @param list<string> $actual */
    private function assertTargetsExist(string $kind, array $allowed, array $actual): void
    {
        $unknown = array_diff($actual, $allowed);

        if ($unknown !== []) {
            throw new DomainInvariantViolation("Binding {$kind} mappings contain unknown Profile UUIDs.");
        }
    }

    private function assertBindingSemantics(
        DeviceProfileAuthoringData $profile,
        NativeMqttBindingAuthoringData $binding,
    ): void {
        $channels = $binding->channelsByKey();
        $parameters = $profile->measuredParametersByUuid();
        $properties = $profile->propertiesByUuid();
        $events = $profile->eventsByUuid();
        $commands = $profile->commandsByUuid();

        foreach ($binding->version['parameter_mappings'] as $mapping) {
            $this->assertChannel(
                $channels,
                (string) $mapping['channel'],
                'device_to_platform',
                'telemetry',
            );
            $this->assertMappingTypes(
                $mapping,
                $parameters[strtolower((string) $mapping['target_parameter_uuid'])],
                $mapping['calibration'],
            );
        }

        foreach ($binding->version['property_mappings'] as $mapping) {
            $property = $properties[strtolower((string) $mapping['target_property_uuid'])];
            $expectedDirection = $property['scope'] === 'desired'
                ? 'platform_to_device'
                : 'device_to_platform';
            $expectedPurpose = $property['scope'] === 'desired'
                ? 'desired_properties'
                : 'reported_properties';

            if ($property['scope'] === 'platform') {
                throw new DomainInvariantViolation('Binding cannot map a platform-owned Property.');
            }

            if ($mapping['direction'] !== $expectedDirection) {
                throw new DomainInvariantViolation(
                    "Binding Property {$property['uuid']} direction does not match its Profile scope.",
                );
            }

            $this->assertChannel(
                $channels,
                (string) $mapping['channel'],
                $expectedDirection,
                $expectedPurpose,
            );
            $this->assertMappingTypes(
                $mapping,
                $property,
                $mapping['operations'],
            );
        }

        foreach ($binding->version['event_mappings'] as $mapping) {
            $this->assertChannel(
                $channels,
                (string) $mapping['channel'],
                'device_to_platform',
                'event',
            );
            $event = $events[strtolower((string) $mapping['target_event_uuid'])];
            $fields = $this->itemsByUuid($event['fields']);
            $mappedFields = [];

            foreach ($mapping['field_mappings'] as $fieldMapping) {
                $targetUuid = strtolower((string) $fieldMapping['target_event_field_uuid']);

                if (! isset($fields[$targetUuid])) {
                    throw new DomainInvariantViolation(
                        "Binding Event mapping targets a field outside Event {$event['uuid']}.",
                    );
                }

                if (isset($mappedFields[$targetUuid])) {
                    throw new DomainInvariantViolation(
                        "Binding Event mapping duplicates target field {$targetUuid}.",
                    );
                }

                $mappedFields[$targetUuid] = true;
                $this->assertMappingTypes($fieldMapping, $fields[$targetUuid], $fieldMapping['operations']);
            }
        }

        foreach ($binding->version['command_mappings'] as $mapping) {
            $this->assertChannel(
                $channels,
                (string) $mapping['request_channel'],
                'platform_to_device',
                'command_request',
            );
            $command = $commands[strtolower((string) $mapping['target_command_uuid'])];
            $hasResponseChannel = isset($mapping['response_channel']);
            $hasResponse = array_key_exists('response', $mapping);

            if ($hasResponseChannel) {
                $this->assertChannel(
                    $channels,
                    (string) $mapping['response_channel'],
                    'device_to_platform',
                    'command_response',
                );
            }

            if ($command['mode'] === 'two_way' && (! $hasResponseChannel || ! $hasResponse)) {
                throw new DomainInvariantViolation(
                    "Binding two-way Command {$command['uuid']} requires response Channel and mapping.",
                );
            }

            if ($command['mode'] === 'one_way' && ($hasResponseChannel || $hasResponse)) {
                throw new DomainInvariantViolation(
                    "Binding one-way Command {$command['uuid']} cannot define a response mapping.",
                );
            }

            $fields = $this->itemsByUuid($command['fields']);
            $mappedFields = [];

            foreach ($mapping['field_mappings'] as $fieldMapping) {
                $targetUuid = strtolower((string) $fieldMapping['target_command_field_uuid']);
                $target = $fields[$targetUuid] ?? null;

                if ($target === null) {
                    throw new DomainInvariantViolation(
                        "Binding Command mapping targets a field outside Command {$command['uuid']}.",
                    );
                }

                if (isset($mappedFields[$targetUuid])) {
                    throw new DomainInvariantViolation(
                        "Binding Command mapping duplicates target field {$targetUuid}.",
                    );
                }

                if ($target['direction'] !== $fieldMapping['direction']) {
                    throw new DomainInvariantViolation(
                        "Binding Command field {$targetUuid} direction does not match its Profile definition.",
                    );
                }

                $mappedFields[$targetUuid] = true;
                $this->assertMappingTypes($fieldMapping, $target, $fieldMapping['operations']);
            }

            foreach ($fields as $fieldUuid => $field) {
                if ($field['required'] && ! isset($mappedFields[$fieldUuid])) {
                    throw new DomainInvariantViolation(
                        "Binding Command mapping must cover required field {$fieldUuid}.",
                    );
                }
            }
        }
    }

    /**
     * @param  array<string, array<string, mixed>>  $channels
     */
    private function assertChannel(
        array $channels,
        string $key,
        string $expectedDirection,
        ?string $expectedPurpose = null,
    ): void {
        $channel = $channels[$key] ?? null;

        if ($channel === null) {
            throw new DomainInvariantViolation("Binding mapping references unknown Channel {$key}.");
        }

        if ($channel['direction'] !== $expectedDirection) {
            throw new DomainInvariantViolation("Binding Channel {$key} has an incompatible direction.");
        }

        if ($expectedPurpose !== null && $channel['purpose'] !== $expectedPurpose) {
            throw new DomainInvariantViolation("Binding Channel {$key} has an incompatible purpose.");
        }
    }

    /**
     * @param  array<string, mixed>  $mapping
     * @param  array<string, mixed>  $target
     * @param  list<mixed>  $operations
     */
    private function assertMappingTypes(array $mapping, array $target, array $operations): void
    {
        $wireType = (string) $mapping['wire_data_type'];
        $targetType = (string) $target['value_schema']['data_type'];
        $numericTypes = ['float64', 'int64', 'uint64'];
        $wireIsNumeric = in_array($wireType, $numericTypes, true);
        $targetIsNumeric = in_array($targetType, $numericTypes, true);

        if ($operations !== [] && (! $wireIsNumeric || ! $targetIsNumeric)) {
            throw new DomainInvariantViolation(
                "Binding numeric operations cannot map {$wireType} to {$targetType}.",
            );
        }

        if (
            $operations === []
            && $wireType !== $targetType
            && ! ($targetType === 'float64' && $wireIsNumeric)
        ) {
            throw new DomainInvariantViolation("Binding cannot map {$wireType} to {$targetType}.");
        }
    }

    /**
     * @param  list<array<string, mixed>>  $items
     * @return array<string, array<string, mixed>>
     */
    private function itemsByUuid(array $items): array
    {
        $byUuid = [];

        foreach ($items as $item) {
            $byUuid[strtolower((string) $item['uuid'])] = $item;
        }

        return $byUuid;
    }
}
