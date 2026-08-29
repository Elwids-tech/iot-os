<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Services;

use App\Domain\DeviceManagement\Data\GatewayAuthoringData;
use App\Domain\DeviceManagement\Data\GatewayRouteAuthoringData;
use App\Domain\DeviceProfile\Data\DefinitionCompileResultData;
use App\Domain\DeviceProfile\Data\DeviceProfileAuthoringData;
use App\Domain\DeviceProfile\Data\NativeMqttBindingAuthoringData;
use App\Domain\DeviceProfile\Enums\DefinitionState;
use App\Domain\DeviceProfile\Models\DeviceProfile;
use App\Domain\DeviceProfile\Models\DeviceProfileVersion;
use App\Domain\DeviceProfile\Models\TransportBinding;
use App\Domain\DeviceProfile\Models\TransportBindingVersion;
use App\Domain\Shared\Exceptions\DomainInvariantViolation;
use App\Domain\Shared\Models\Organization;
use Illuminate\Support\Facades\DB;

final readonly class DefinitionPublicationManager
{
    public function __construct(
        private DefinitionCompilerClient $compiler,
        private DefinitionDocumentFactory $documents,
    ) {}

    /** @param list<array<string, mixed>> $fixtures */
    public function preview(
        Organization $organization,
        DeviceProfile $profile,
        DeviceProfileVersion $profileVersion,
        TransportBinding $binding,
        TransportBindingVersion $bindingVersion,
        DeviceProfileAuthoringData $profileData,
        NativeMqttBindingAuthoringData $bindingData,
        GatewayAuthoringData $gatewayData,
        GatewayRouteAuthoringData $routeData,
        array $fixtures,
    ): DefinitionCompileResultData {
        $this->assertCurrentDocuments(
            $organization,
            $profile,
            $profileVersion,
            $binding,
            $bindingVersion,
            $profileData,
            $bindingData,
            $gatewayData,
            $routeData,
        );

        return $this->compiler->compile(
            $organization->uuid,
            $profileData,
            $bindingData,
            $gatewayData,
            $routeData,
            $fixtures,
        );
    }

    /**
     * @param  list<array<string, mixed>>  $fixtures
     * @return array{DefinitionCompileResultData, DeviceProfile, TransportBinding}
     */
    public function publish(
        Organization $organization,
        DeviceProfile $profile,
        DeviceProfileVersion $profileVersion,
        TransportBinding $binding,
        TransportBindingVersion $bindingVersion,
        DeviceProfileAuthoringData $profileData,
        NativeMqttBindingAuthoringData $bindingData,
        GatewayAuthoringData $gatewayData,
        GatewayRouteAuthoringData $routeData,
        array $fixtures,
        ?string $expectedProfileEntityTag,
        ?string $expectedBindingEntityTag,
    ): array {
        $profile->assertExpectedEntityTag($expectedProfileEntityTag);
        $binding->assertExpectedEntityTag($expectedBindingEntityTag);

        $result = $this->preview(
            $organization,
            $profile,
            $profileVersion,
            $binding,
            $bindingVersion,
            $profileData,
            $bindingData,
            $gatewayData,
            $routeData,
            $fixtures,
        );

        if (! $result->valid) {
            return [$result, $profile, $binding];
        }

        if (
            $result->profileArtifact === null
            || $result->bindingArtifact === null
            || $result->artifactHashes['profile'] === null
            || $result->artifactHashes['binding'] === null
        ) {
            throw new DomainInvariantViolation('A valid compile result must contain Profile and Binding artifacts.');
        }

        [$publishedProfile, $publishedBinding] = DB::transaction(function () use (
            $organization,
            $profile,
            $profileVersion,
            $binding,
            $bindingVersion,
            $profileData,
            $bindingData,
            $result,
            $expectedProfileEntityTag,
            $expectedBindingEntityTag,
        ): array {
            $lockedProfile = DeviceProfile::query()->lockForUpdate()->findOrFail($profile->getKey());
            $lockedBinding = TransportBinding::query()->lockForUpdate()->findOrFail($binding->getKey());
            $lockedProfile->assertExpectedEntityTag($expectedProfileEntityTag);
            $lockedBinding->assertExpectedEntityTag($expectedBindingEntityTag);

            $lockedProfileVersion = DeviceProfileVersion::query()
                ->lockForUpdate()
                ->findOrFail($profileVersion->getKey());
            $lockedBindingVersion = TransportBindingVersion::query()
                ->lockForUpdate()
                ->findOrFail($bindingVersion->getKey());

            $this->assertCurrentDocuments(
                $organization,
                $lockedProfile,
                $lockedProfileVersion,
                $lockedBinding,
                $lockedBindingVersion,
                $profileData,
                $bindingData,
            );
            $this->assertPublishableArtifacts(
                $lockedProfile,
                $lockedProfileVersion,
                $lockedBinding,
                $lockedBindingVersion,
                $result,
            );

            $lockedProfileVersion->forceFill([
                'state' => DefinitionState::PUBLISHED,
                'artifact' => $result->profileArtifact,
                'artifact_hash' => $result->artifactHashes['profile'],
                'source_hash' => $result->profileArtifact['source_hash'],
                'compiler' => $result->compiler,
                'published_at' => now(),
                'revision' => $lockedProfileVersion->revision + 1,
            ])->save();
            $lockedBindingVersion->forceFill([
                'state' => DefinitionState::PUBLISHED,
                'artifact' => $result->bindingArtifact,
                'artifact_hash' => $result->artifactHashes['binding'],
                'source_hash' => $result->bindingArtifact['source_hash'],
                'compiler' => $result->compiler,
                'published_at' => now(),
                'revision' => $lockedBindingVersion->revision + 1,
            ])->save();
            $lockedProfile->forceFill(['revision' => $lockedProfile->revision + 1])->save();
            $lockedBinding->forceFill(['revision' => $lockedBinding->revision + 1])->save();

            return [
                $lockedProfile->refresh()->setRelation(
                    'versions',
                    $lockedProfile->newCollection([$lockedProfileVersion->refresh()]),
                ),
                $lockedBinding->refresh()
                    ->setRelation('profile', $lockedProfile)
                    ->setRelation(
                        'versions',
                        $lockedBinding->newCollection([$lockedBindingVersion->refresh()]),
                    ),
            ];
        });

        return [$result, $publishedProfile, $publishedBinding];
    }

    private function assertCurrentDocuments(
        Organization $organization,
        DeviceProfile $profile,
        DeviceProfileVersion $profileVersion,
        TransportBinding $binding,
        TransportBindingVersion $bindingVersion,
        DeviceProfileAuthoringData $profileData,
        NativeMqttBindingAuthoringData $bindingData,
        ?GatewayAuthoringData $gatewayData = null,
        ?GatewayRouteAuthoringData $routeData = null,
    ): void {
        if (
            $profile->organization_id !== $organization->getKey()
            || $binding->organization_id !== $organization->getKey()
            || $profileVersion->organization_id !== $organization->getKey()
            || $bindingVersion->organization_id !== $organization->getKey()
            || $profileVersion->device_profile_id !== $profile->getKey()
            || $bindingVersion->transport_binding_id !== $binding->getKey()
            || $bindingVersion->device_profile_version_id !== $profileVersion->getKey()
            || $binding->device_profile_id !== $profile->getKey()
        ) {
            throw new DomainInvariantViolation('Definition compilation requires one coordinated same-tenant Profile and Binding pair.');
        }

        if (
            $this->documents->profile($profile, $profileVersion)->toArray() != $profileData->toArray()
            || $this->documents->binding($binding, $bindingVersion)->toArray() != $bindingData->toArray()
        ) {
            throw new DomainInvariantViolation('Compile input must exactly match the saved Profile and Binding drafts.');
        }

        if ($gatewayData !== null && $routeData !== null && (
            $routeData->gatewayUuid !== $gatewayData->uuid
            || $routeData->profileVersionUuid !== $profileVersion->uuid
            || $routeData->bindingVersionUuid !== $bindingVersion->uuid
        )) {
            throw new DomainInvariantViolation('Compile route identities must match the selected Gateway, Profile, and Binding Versions.');
        }
    }

    private function assertPublishableArtifacts(
        DeviceProfile $profile,
        DeviceProfileVersion $profileVersion,
        TransportBinding $binding,
        TransportBindingVersion $bindingVersion,
        DefinitionCompileResultData $result,
    ): void {
        if (
            $profile->isArchived()
            || $binding->isArchived()
            || ! $profileVersion->isDraft()
            || ! $bindingVersion->isDraft()
        ) {
            throw new DomainInvariantViolation('Only active draft Profile and Binding Versions can be published.');
        }

        $profileArtifact = $result->profileArtifact;
        $bindingArtifact = $result->bindingArtifact;
        $profileHash = $result->artifactHashes['profile'];

        if (
            ($profileArtifact['profile_uuid'] ?? null) !== $profile->uuid
            || ($profileArtifact['profile_version_uuid'] ?? null) !== $profileVersion->uuid
            || ($bindingArtifact['binding_uuid'] ?? null) !== $binding->uuid
            || ($bindingArtifact['binding_version_uuid'] ?? null) !== $bindingVersion->uuid
            || ($bindingArtifact['profile_uuid'] ?? null) !== $profile->uuid
            || ($bindingArtifact['profile_version_uuid'] ?? null) !== $profileVersion->uuid
            || ($bindingArtifact['profile_artifact_hash'] ?? null) !== $profileHash
        ) {
            throw new DomainInvariantViolation('Compiled artifacts do not match the saved definition identities.');
        }
    }
}
