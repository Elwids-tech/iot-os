<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Services;

use App\Domain\DeviceProfile\Data\DeviceProfileAuthoringData;
use App\Domain\DeviceProfile\Data\NativeMqttBindingAuthoringData;
use App\Domain\DeviceProfile\Enums\DefinitionState;
use App\Domain\DeviceProfile\Models\DeviceProfile;
use App\Domain\DeviceProfile\Models\DeviceProfileVersion;
use App\Domain\DeviceProfile\Models\TransportBinding;
use App\Domain\DeviceProfile\Models\TransportBindingVersion;
use App\Domain\Shared\Concurrency\StaleEntityTag;
use App\Domain\Shared\Exceptions\DomainInvariantViolation;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Support\Facades\DB;

final class DefinitionAuthoringManager
{
    public function updateProfileMetadata(
        DeviceProfile $profile,
        string $name,
        ?string $description,
        ?string $expectedEntityTag,
    ): DeviceProfile {
        $profile->assertExpectedEntityTag($expectedEntityTag);

        if ($profile->isArchived()) {
            throw new DomainInvariantViolation('An archived Device Profile is immutable.');
        }

        return $this->optimisticProfileUpdate($profile, [
            'name' => $name,
            'description' => $description,
        ]);
    }

    public function archiveProfile(DeviceProfile $profile, ?string $expectedEntityTag): DeviceProfile
    {
        $profile->assertExpectedEntityTag($expectedEntityTag);

        if ($profile->isArchived()) {
            throw new DomainInvariantViolation('The Device Profile is already archived.');
        }

        return $this->optimisticProfileUpdate($profile, ['archived_at' => now()]);
    }

    public function updateBindingMetadata(
        TransportBinding $binding,
        string $name,
        ?string $description,
        ?string $expectedEntityTag,
    ): TransportBinding {
        $binding->assertExpectedEntityTag($expectedEntityTag);

        if ($binding->isArchived()) {
            throw new DomainInvariantViolation('An archived Transport Binding is immutable.');
        }

        return $this->optimisticBindingUpdate($binding, [
            'name' => $name,
            'description' => $description,
        ]);
    }

    public function archiveBinding(TransportBinding $binding, ?string $expectedEntityTag): TransportBinding
    {
        $binding->assertExpectedEntityTag($expectedEntityTag);

        if ($binding->isArchived()) {
            throw new DomainInvariantViolation('The Transport Binding is already archived.');
        }

        return $this->optimisticBindingUpdate($binding, ['archived_at' => now()]);
    }

    public function createProfileDraft(
        Organization $organization,
        DeviceProfileAuthoringData $data,
        ?User $actor = null,
    ): DeviceProfileVersion {
        return DB::transaction(function () use ($organization, $data, $actor): DeviceProfileVersion {
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

            return $version->setRelation('profile', $profile);
        });
    }

    public function createBindingDraft(
        DeviceProfile $profile,
        DeviceProfileVersion $profileVersion,
        NativeMqttBindingAuthoringData $data,
        ?User $actor = null,
    ): TransportBindingVersion {
        return DB::transaction(function () use ($profile, $profileVersion, $data, $actor): TransportBindingVersion {
            $lockedProfileVersion = DeviceProfileVersion::query()
                ->lockForUpdate()
                ->findOrFail($profileVersion->getKey());
            $lockedProfile = DeviceProfile::query()->lockForUpdate()->findOrFail($profile->getKey());

            if ($lockedProfile->isArchived()) {
                throw new DomainInvariantViolation('An archived Device Profile cannot receive a new Transport Binding.');
            }

            $this->assertProfileReferences($lockedProfile, $lockedProfileVersion, $data);

            $binding = TransportBinding::query()->create([
                'uuid' => $data->bindingUuid(),
                'organization_id' => $lockedProfile->organization_id,
                'device_profile_id' => $lockedProfile->getKey(),
                'key' => $data->bindingKey(),
                'name' => $data->bindingName(),
                'description' => $data->bindingDescription(),
                'transport' => 'native_mqtt_json',
            ]);

            $version = $binding->versions()->create([
                'uuid' => $data->versionUuid(),
                'organization_id' => $lockedProfile->organization_id,
                'device_profile_version_id' => $lockedProfileVersion->getKey(),
                'version' => $data->versionNumber(),
                'state' => DefinitionState::DRAFT,
                'definition' => $data->versionDefinition(),
                'created_by_id' => $actor?->getKey(),
            ]);

            return $version->setRelation('binding', $binding)->setRelation('profileVersion', $lockedProfileVersion);
        });
    }

    public function replaceProfileVersionDraft(
        DeviceProfileVersion $version,
        DeviceProfileAuthoringData $data,
        ?string $expectedEntityTag,
    ): DeviceProfileVersion {
        $version->assertExpectedEntityTag($expectedEntityTag);

        DB::transaction(function () use ($version, $data, $expectedEntityTag): void {
            $lockedVersion = DeviceProfileVersion::query()->lockForUpdate()->findOrFail($version->getKey());
            $profile = $lockedVersion->profile()->lockForUpdate()->firstOrFail();

            $lockedVersion->assertExpectedEntityTag($expectedEntityTag);

            if (! $lockedVersion->isDraft()) {
                throw new DomainInvariantViolation('Published or retired Profile Versions are immutable.');
            }

            if ($profile->isArchived()) {
                throw new DomainInvariantViolation('A draft Version under an archived Device Profile is immutable.');
            }

            if (
                $data->profileUuid() !== $profile->uuid
                || $data->profileKey() !== $profile->key
                || $data->versionUuid() !== $lockedVersion->uuid
                || $data->versionNumber() !== $lockedVersion->version
            ) {
                throw new DomainInvariantViolation('A Profile Version replacement cannot change aggregate identity.');
            }

            $this->optimisticVersionUpdate($lockedVersion, [
                'definition' => $data->versionDefinition(),
            ]);
        });

        return $version->refresh();
    }

    public function replaceBindingVersionDraft(
        TransportBindingVersion $version,
        NativeMqttBindingAuthoringData $data,
        ?string $expectedEntityTag,
    ): TransportBindingVersion {
        $version->assertExpectedEntityTag($expectedEntityTag);

        DB::transaction(function () use ($version, $data, $expectedEntityTag): void {
            $profileVersion = DeviceProfileVersion::query()
                ->lockForUpdate()
                ->findOrFail($version->device_profile_version_id);
            $lockedVersion = TransportBindingVersion::query()->lockForUpdate()->findOrFail($version->getKey());
            $profile = $profileVersion->profile()->lockForUpdate()->firstOrFail();
            $binding = $lockedVersion->binding()->lockForUpdate()->firstOrFail();

            $lockedVersion->assertExpectedEntityTag($expectedEntityTag);

            if (! $lockedVersion->isDraft()) {
                throw new DomainInvariantViolation('Published or retired Binding Versions are immutable.');
            }

            if ($binding->isArchived() || $profile->isArchived()) {
                throw new DomainInvariantViolation('A draft Version under an archived definition catalog is immutable.');
            }

            $this->assertProfileReferences($profile, $profileVersion, $data);

            if (
                $lockedVersion->device_profile_version_id !== $profileVersion->getKey()
                || $data->bindingUuid() !== $binding->uuid
                || $data->bindingKey() !== $binding->key
                || $data->versionUuid() !== $lockedVersion->uuid
                || $data->versionNumber() !== $lockedVersion->version
            ) {
                throw new DomainInvariantViolation('A Binding Version replacement cannot change aggregate identity.');
            }

            $this->optimisticBindingVersionUpdate($lockedVersion, [
                'definition' => $data->versionDefinition(),
            ]);
        });

        return $version->refresh();
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    private function optimisticVersionUpdate(DeviceProfileVersion $version, array $attributes): DeviceProfileVersion
    {
        $revision = $version->revision;
        $updated = DeviceProfileVersion::query()
            ->whereKey($version->getKey())
            ->where('revision', $revision)
            ->update([
                ...$attributes,
                'revision' => $revision + 1,
                'updated_at' => now(),
            ]);

        if ($updated !== 1) {
            throw new StaleEntityTag(DeviceProfileVersion::query()->findOrFail($version->getKey())->etag());
        }

        return $version->refresh();
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    private function optimisticProfileUpdate(DeviceProfile $profile, array $attributes): DeviceProfile
    {
        $revision = $profile->revision;
        $updated = DeviceProfile::query()
            ->whereKey($profile->getKey())
            ->where('revision', $revision)
            ->update([
                ...$attributes,
                'revision' => $revision + 1,
                'updated_at' => now(),
            ]);

        if ($updated !== 1) {
            throw new StaleEntityTag(DeviceProfile::query()->findOrFail($profile->getKey())->etag());
        }

        return $profile->refresh();
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    private function optimisticBindingUpdate(TransportBinding $binding, array $attributes): TransportBinding
    {
        $revision = $binding->revision;
        $updated = TransportBinding::query()
            ->whereKey($binding->getKey())
            ->where('revision', $revision)
            ->update([
                ...$attributes,
                'revision' => $revision + 1,
                'updated_at' => now(),
            ]);

        if ($updated !== 1) {
            throw new StaleEntityTag(TransportBinding::query()->findOrFail($binding->getKey())->etag());
        }

        return $binding->refresh();
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    private function optimisticBindingVersionUpdate(TransportBindingVersion $version, array $attributes): TransportBindingVersion
    {
        $revision = $version->revision;
        $updated = TransportBindingVersion::query()
            ->whereKey($version->getKey())
            ->where('revision', $revision)
            ->update([
                ...$attributes,
                'revision' => $revision + 1,
                'updated_at' => now(),
            ]);

        if ($updated !== 1) {
            throw new StaleEntityTag(TransportBindingVersion::query()->findOrFail($version->getKey())->etag());
        }

        return $version->refresh();
    }

    private function assertProfileReferences(
        DeviceProfile $profile,
        DeviceProfileVersion $profileVersion,
        NativeMqttBindingAuthoringData $data,
    ): void {
        if (
            $profile->organization_id !== $profileVersion->organization_id
            || $profile->getKey() !== $profileVersion->device_profile_id
            || $profile->uuid !== $data->profileUuid()
            || $profileVersion->uuid !== $data->profileVersionUuid()
        ) {
            throw new DomainInvariantViolation('A Binding must target an exact Profile Version in the same Organization.');
        }
    }
}
