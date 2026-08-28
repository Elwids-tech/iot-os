<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Services;

use App\Domain\DeviceProfile\Data\DefinitionTestResultData;
use App\Domain\DeviceProfile\Enums\DefinitionState;
use App\Domain\DeviceProfile\Models\DefinitionTestRun;
use App\Domain\DeviceProfile\Models\DeviceProfileVersion;
use App\Domain\DeviceProfile\Models\TransportBindingVersion;
use App\Domain\Shared\Exceptions\DomainInvariantViolation;
use App\Domain\Shared\Models\User;
use Illuminate\Support\Facades\DB;

final class DefinitionLifecycleManager
{
    public function recordTestRun(
        DeviceProfileVersion $profileVersion,
        TransportBindingVersion $bindingVersion,
        DefinitionTestResultData $result,
        ?User $actor = null,
    ): DefinitionTestRun {
        $this->assertCoordinatedVersions($profileVersion, $bindingVersion);

        return DefinitionTestRun::query()->create([
            'organization_id' => $profileVersion->organization_id,
            'device_profile_version_id' => $profileVersion->getKey(),
            'transport_binding_version_id' => $bindingVersion->getKey(),
            'profile_revision' => $profileVersion->revision,
            'binding_revision' => $bindingVersion->revision,
            'input_hash' => $result->inputHash,
            'valid' => $result->valid,
            'compiler' => $result->compiler,
            'diagnostics' => $result->diagnostics,
            'previews' => $result->previews,
            'profile_artifact' => $result->profileArtifact,
            'binding_artifact' => $result->bindingArtifact,
            'profile_artifact_hash' => $result->profileArtifactHash,
            'binding_artifact_hash' => $result->bindingArtifactHash,
            'completed_at' => now(),
            'created_by_id' => $actor?->getKey(),
        ]);
    }

    public function publish(
        DeviceProfileVersion $profileVersion,
        TransportBindingVersion $bindingVersion,
        DefinitionTestRun $testRun,
        ?string $expectedProfileEntityTag,
        ?string $expectedBindingEntityTag,
    ): void {
        $profileVersion->assertExpectedEntityTag($expectedProfileEntityTag);
        $bindingVersion->assertExpectedEntityTag($expectedBindingEntityTag);

        DB::transaction(function () use (
            $profileVersion,
            $bindingVersion,
            $testRun,
            $expectedProfileEntityTag,
            $expectedBindingEntityTag,
        ): void {
            $lockedProfile = DeviceProfileVersion::query()->lockForUpdate()->findOrFail($profileVersion->getKey());
            $lockedBinding = TransportBindingVersion::query()->lockForUpdate()->findOrFail($bindingVersion->getKey());
            $lockedRun = DefinitionTestRun::query()->lockForUpdate()->findOrFail($testRun->getKey());

            $lockedProfile->assertExpectedEntityTag($expectedProfileEntityTag);
            $lockedBinding->assertExpectedEntityTag($expectedBindingEntityTag);

            $this->assertCoordinatedVersions($lockedProfile, $lockedBinding, lockCatalogs: true);

            if (! $lockedProfile->isDraft() || ! $lockedBinding->isDraft()) {
                throw new DomainInvariantViolation('Only coordinated draft Versions can be published.');
            }

            if (
                ! $lockedRun->valid
                || $lockedRun->device_profile_version_id !== $lockedProfile->getKey()
                || $lockedRun->transport_binding_version_id !== $lockedBinding->getKey()
                || $lockedRun->profile_revision !== $lockedProfile->revision
                || $lockedRun->binding_revision !== $lockedBinding->revision
            ) {
                throw new DomainInvariantViolation('Publication requires a valid test run for the current draft revisions.');
            }

            if (
                $lockedRun->profile_artifact === null
                || $lockedRun->binding_artifact === null
                || $lockedRun->profile_artifact_hash === null
                || $lockedRun->binding_artifact_hash === null
            ) {
                throw new DomainInvariantViolation('Publication requires complete immutable artifacts and hashes.');
            }

            $lockedProfile->forceFill([
                'state' => DefinitionState::PUBLISHED,
                'artifact' => $lockedRun->profile_artifact,
                'artifact_hash' => $lockedRun->profile_artifact_hash,
                'source_hash' => $lockedRun->input_hash,
                'compiler' => $lockedRun->compiler,
                'published_at' => now(),
                'revision' => $lockedProfile->revision + 1,
            ])->save();

            $lockedBinding->forceFill([
                'state' => DefinitionState::PUBLISHED,
                'artifact' => $lockedRun->binding_artifact,
                'artifact_hash' => $lockedRun->binding_artifact_hash,
                'source_hash' => $lockedRun->input_hash,
                'compiler' => $lockedRun->compiler,
                'published_at' => now(),
                'revision' => $lockedBinding->revision + 1,
            ])->save();
        });

        $profileVersion->refresh();
        $bindingVersion->refresh();
    }

    public function retireProfileVersion(DeviceProfileVersion $version, ?string $expectedEntityTag): DeviceProfileVersion
    {
        $version->assertExpectedEntityTag($expectedEntityTag);

        DB::transaction(function () use ($version, $expectedEntityTag): void {
            $locked = DeviceProfileVersion::query()->lockForUpdate()->findOrFail($version->getKey());
            $locked->assertExpectedEntityTag($expectedEntityTag);

            if (! $locked->isPublished()) {
                throw new DomainInvariantViolation('Only a published Profile Version can be retired.');
            }

            $locked->forceFill([
                'state' => DefinitionState::RETIRED,
                'retired_at' => now(),
                'revision' => $locked->revision + 1,
            ])->save();
        });

        return $version->refresh();
    }

    public function retireBindingVersion(TransportBindingVersion $version, ?string $expectedEntityTag): TransportBindingVersion
    {
        $version->assertExpectedEntityTag($expectedEntityTag);

        DB::transaction(function () use ($version, $expectedEntityTag): void {
            $locked = TransportBindingVersion::query()->lockForUpdate()->findOrFail($version->getKey());
            $locked->assertExpectedEntityTag($expectedEntityTag);

            if (! $locked->isPublished()) {
                throw new DomainInvariantViolation('Only a published Binding Version can be retired.');
            }

            $locked->forceFill([
                'state' => DefinitionState::RETIRED,
                'retired_at' => now(),
                'revision' => $locked->revision + 1,
            ])->save();
        });

        return $version->refresh();
    }

    private function assertCoordinatedVersions(
        DeviceProfileVersion $profileVersion,
        TransportBindingVersion $bindingVersion,
        bool $lockCatalogs = false,
    ): void {
        $profileQuery = $profileVersion->profile();
        $bindingQuery = $bindingVersion->binding();

        if ($lockCatalogs) {
            $profileQuery->lockForUpdate();
            $bindingQuery->lockForUpdate();
        }

        $profile = $profileQuery->firstOrFail();
        $binding = $bindingQuery->firstOrFail();

        if (
            $profileVersion->organization_id !== $bindingVersion->organization_id
            || $bindingVersion->device_profile_version_id !== $profileVersion->getKey()
            || $binding->device_profile_id !== $profileVersion->device_profile_id
        ) {
            throw new DomainInvariantViolation('Profile and Binding Versions are not a coordinated definition.');
        }

        if ($profile->isArchived() || $binding->isArchived()) {
            throw new DomainInvariantViolation('Archived definition catalogs cannot be validated or published.');
        }
    }
}
