<?php

declare(strict_types=1);

namespace App\Domain\DeviceManagement\Services;

use App\Domain\DeviceManagement\Data\DeviceDraftData;
use App\Domain\DeviceManagement\Enums\DeviceLifecycleState;
use App\Domain\DeviceManagement\Models\Device;
use App\Domain\DeviceManagement\Models\DeviceDefinitionAssignment;
use App\Domain\DeviceManagement\Models\GatewayRoute;
use App\Domain\DeviceProfile\Models\DeviceProfileVersion;
use App\Domain\DeviceProfile\Models\TransportBindingVersion;
use App\Domain\Shared\Concurrency\StaleEntityTag;
use App\Domain\Shared\Exceptions\DomainInvariantViolation;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Support\Facades\DB;

final class DeviceRegistrationManager
{
    public function createDraft(
        Organization $organization,
        DeviceDraftData $data,
        ?User $actor = null,
    ): Device {
        return Device::query()->create([
            'organization_id' => $organization->getKey(),
            ...$data->toArray(),
            'lifecycle_state' => DeviceLifecycleState::DRAFT,
            'created_by_id' => $actor?->getKey(),
        ]);
    }

    public function replaceDraft(Device $device, DeviceDraftData $data, ?string $expectedEntityTag): Device
    {
        $device->assertExpectedEntityTag($expectedEntityTag);

        if (! $device->isDraft()) {
            throw new DomainInvariantViolation('Only a Device draft can be edited.');
        }

        $attributes = $data->toArray();
        unset($attributes['uuid']);

        $revision = $device->revision;
        $updated = Device::query()
            ->whereKey($device->getKey())
            ->where('revision', $revision)
            ->update([
                ...$attributes,
                'revision' => $revision + 1,
                'updated_at' => now(),
            ]);

        if ($updated !== 1) {
            throw new StaleEntityTag(Device::query()->findOrFail($device->getKey())->etag());
        }

        return $device->refresh();
    }

    public function deleteDraft(Device $device, ?string $expectedEntityTag): void
    {
        $device->assertExpectedEntityTag($expectedEntityTag);

        DB::transaction(function () use ($device, $expectedEntityTag): void {
            $locked = Device::query()->lockForUpdate()->findOrFail($device->getKey());
            $locked->assertExpectedEntityTag($expectedEntityTag);

            if (! $locked->isDraft()) {
                throw new DomainInvariantViolation('Only an unregistered Device draft can be deleted.');
            }

            if ($locked->definitionAssignment()->exists()) {
                throw new DomainInvariantViolation('A Device draft with a definition assignment cannot be deleted.');
            }

            $locked->delete();
        });
    }

    public function replaceDefinitionAssignment(
        Device $device,
        DeviceProfileVersion $profileVersion,
        TransportBindingVersion $bindingVersion,
        ?string $expectedEntityTag,
        ?User $actor = null,
    ): DeviceDefinitionAssignment {
        return DB::transaction(function () use (
            $device,
            $profileVersion,
            $bindingVersion,
            $expectedEntityTag,
            $actor,
        ): DeviceDefinitionAssignment {
            $lockedDevice = Device::query()->lockForUpdate()->findOrFail($device->getKey());
            $assignment = $lockedDevice->definitionAssignment()->lockForUpdate()->first();
            ($assignment ?? $lockedDevice)->assertExpectedEntityTag($expectedEntityTag);

            if (! $lockedDevice->isDraft()) {
                throw new DomainInvariantViolation('A registered or archived Device definition assignment is immutable.');
            }

            if ($assignment?->isLocked()) {
                throw new DomainInvariantViolation('A locked definition assignment is immutable.');
            }

            $lockedProfileVersion = DeviceProfileVersion::query()
                ->lockForUpdate()
                ->findOrFail($profileVersion->getKey());
            $lockedBindingVersion = TransportBindingVersion::query()
                ->lockForUpdate()
                ->findOrFail($bindingVersion->getKey());

            $this->assertAssignable($lockedDevice, $lockedProfileVersion, $lockedBindingVersion);

            if (
                $assignment?->gateway_route_id !== null
                && (
                    $assignment->device_profile_version_id !== $lockedProfileVersion->getKey()
                    || $assignment->transport_binding_version_id !== $lockedBindingVersion->getKey()
                )
            ) {
                throw new DomainInvariantViolation('Delete the current Gateway Route before replacing routed definitions.');
            }

            if ($assignment === null) {
                return DeviceDefinitionAssignment::query()->create([
                    'organization_id' => $lockedDevice->organization_id,
                    'device_id' => $lockedDevice->getKey(),
                    'device_profile_version_id' => $lockedProfileVersion->getKey(),
                    'transport_binding_version_id' => $lockedBindingVersion->getKey(),
                    'created_by_id' => $actor?->getKey(),
                    'updated_by_id' => $actor?->getKey(),
                ]);
            }

            $revision = $assignment->revision;
            $attributes = [
                'device_profile_version_id' => $lockedProfileVersion->getKey(),
                'transport_binding_version_id' => $lockedBindingVersion->getKey(),
                'updated_by_id' => $actor?->getKey(),
                'revision' => $revision + 1,
                'updated_at' => now(),
            ];

            if ($assignment->gateway_route_id === null) {
                $attributes = [
                    ...$attributes,
                    'profile_artifact_hash' => null,
                    'binding_artifact_hash' => null,
                    'route_source_hash' => null,
                    'runtime_bundle_hash' => null,
                    'runtime_bundle' => null,
                    'runtime_compiled_at' => null,
                ];
            }

            $updated = DeviceDefinitionAssignment::query()
                ->whereKey($assignment->getKey())
                ->where('revision', $revision)
                ->update($attributes);

            if ($updated !== 1) {
                throw new StaleEntityTag(
                    DeviceDefinitionAssignment::query()->findOrFail($assignment->getKey())->etag(),
                );
            }

            return $assignment->refresh();
        });
    }

    public function register(Device $device, ?string $expectedEntityTag): Device
    {
        $device->assertExpectedEntityTag($expectedEntityTag);

        return DB::transaction(function () use ($device, $expectedEntityTag): Device {
            $lockedDevice = Device::query()->lockForUpdate()->findOrFail($device->getKey());
            $lockedDevice->assertExpectedEntityTag($expectedEntityTag);

            if (! $lockedDevice->isDraft()) {
                throw new DomainInvariantViolation('Only a Device draft can be registered.');
            }

            $assignment = $lockedDevice->definitionAssignment()->lockForUpdate()->first();

            if ($assignment === null) {
                throw new DomainInvariantViolation('A Device requires a definition assignment before registration.');
            }

            if ($assignment->isLocked()) {
                throw new DomainInvariantViolation('A locked definition assignment cannot be registered again.');
            }

            $profileVersion = $assignment->profileVersion()->lockForUpdate()->firstOrFail();
            $bindingVersion = $assignment->bindingVersion()->lockForUpdate()->firstOrFail();

            $this->assertAssignable($lockedDevice, $profileVersion, $bindingVersion);
            $this->assertRouteAwareRegistrationReady($assignment, $profileVersion, $bindingVersion);

            $assignment->forceFill([
                'locked_at' => now(),
                'revision' => $assignment->revision + 1,
            ])->save();

            $lockedDevice->forceFill([
                'lifecycle_state' => DeviceLifecycleState::REGISTERED,
                'registered_at' => now(),
                'revision' => $lockedDevice->revision + 1,
            ])->save();

            return $lockedDevice->refresh();
        });
    }

    public function archive(Device $device, ?string $expectedEntityTag): Device
    {
        $device->assertExpectedEntityTag($expectedEntityTag);

        if ($device->isArchived()) {
            throw new DomainInvariantViolation('The Device is already archived.');
        }

        $revision = $device->revision;
        $updated = Device::query()
            ->whereKey($device->getKey())
            ->where('revision', $revision)
            ->update([
                'lifecycle_state' => DeviceLifecycleState::ARCHIVED,
                'archived_at' => now(),
                'revision' => $revision + 1,
                'updated_at' => now(),
            ]);

        if ($updated !== 1) {
            throw new StaleEntityTag(Device::query()->findOrFail($device->getKey())->etag());
        }

        return $device->refresh();
    }

    /** @param array<string, mixed> $runtimeBundle */
    public function pinRuntimeBundle(
        DeviceDefinitionAssignment $assignment,
        array $runtimeBundle,
        ?string $expectedEntityTag,
        ?User $actor = null,
    ): DeviceDefinitionAssignment {
        $assignment->assertExpectedEntityTag($expectedEntityTag);

        return DB::transaction(function () use ($assignment, $runtimeBundle, $expectedEntityTag, $actor): DeviceDefinitionAssignment {
            $device = $assignment->device()->lockForUpdate()->firstOrFail();
            $lockedAssignment = DeviceDefinitionAssignment::query()
                ->lockForUpdate()
                ->findOrFail($assignment->getKey());
            $lockedAssignment->assertExpectedEntityTag($expectedEntityTag);

            $profileVersion = $lockedAssignment->profileVersion()->lockForUpdate()->firstOrFail();
            $bindingVersion = $lockedAssignment->bindingVersion()->lockForUpdate()->firstOrFail();
            $route = $lockedAssignment->gatewayRoute()->lockForUpdate()->first();

            if (
                ! $device->isDraft()
                || ! $lockedAssignment->isRouteAware()
                || $route === null
                || ! $route->enabled
            ) {
                throw new DomainInvariantViolation(
                    'A mutable enabled route-aware assignment is required before pinning a Runtime Bundle.',
                );
            }

            $this->assertRuntimeBundleIdentity(
                $runtimeBundle,
                $lockedAssignment,
                $route,
                $profileVersion,
                $bindingVersion,
            );

            $lockedAssignment->forceFill([
                'profile_artifact_hash' => $profileVersion->artifact_hash,
                'binding_artifact_hash' => $bindingVersion->artifact_hash,
                'route_source_hash' => $runtimeBundle['route_source_hash'],
                'runtime_bundle_hash' => $runtimeBundle['runtime_bundle_hash'],
                'runtime_bundle' => $runtimeBundle,
                'runtime_compiled_at' => now(),
                'updated_by_id' => $actor?->getKey(),
                'revision' => $lockedAssignment->revision + 1,
            ])->save();

            return $lockedAssignment->refresh();
        });
    }

    private function assertAssignable(
        Device $device,
        DeviceProfileVersion $profileVersion,
        TransportBindingVersion $bindingVersion,
    ): void {
        $profile = $profileVersion->profile()->lockForUpdate()->firstOrFail();
        $binding = $bindingVersion->binding()->lockForUpdate()->firstOrFail();

        if (
            $device->organization_id !== $profileVersion->organization_id
            || $device->organization_id !== $bindingVersion->organization_id
            || ! $profileVersion->isPublished()
            || ! $bindingVersion->isPublished()
            || $profile->isArchived()
            || $binding->isArchived()
            || $bindingVersion->device_profile_version_id !== $profileVersion->getKey()
            || $binding->device_profile_id !== $profileVersion->device_profile_id
        ) {
            throw new DomainInvariantViolation(
                'A Device assignment requires coordinated published definitions from the same Organization.',
            );
        }
    }

    private function assertRouteAwareRegistrationReady(
        DeviceDefinitionAssignment $assignment,
        DeviceProfileVersion $profileVersion,
        TransportBindingVersion $bindingVersion,
    ): void {
        $route = $assignment->gatewayRoute()->lockForUpdate()->first();

        if (
            ! $assignment->isRouteAware()
            || $route === null
            || ! $route->enabled
            || $route->device_id !== $assignment->device_id
            || $route->device_profile_version_id !== $profileVersion->getKey()
            || $route->transport_binding_version_id !== $bindingVersion->getKey()
            || $assignment->profile_artifact_hash !== $profileVersion->artifact_hash
            || $assignment->binding_artifact_hash !== $bindingVersion->artifact_hash
            || $assignment->route_source_hash === null
            || $assignment->runtime_bundle_hash === null
            || $assignment->runtime_bundle === null
            || $assignment->runtime_compiled_at === null
        ) {
            throw new DomainInvariantViolation(
                'A Device requires an enabled matching Gateway Route and current compiled Runtime Bundle before registration.',
            );
        }

        $this->assertRuntimeBundleIdentity(
            $assignment->runtime_bundle,
            $assignment,
            $route,
            $profileVersion,
            $bindingVersion,
        );
    }

    /** @param array<string, mixed> $runtimeBundle */
    private function assertRuntimeBundleIdentity(
        array $runtimeBundle,
        DeviceDefinitionAssignment $assignment,
        GatewayRoute $route,
        DeviceProfileVersion $profileVersion,
        TransportBindingVersion $bindingVersion,
    ): void {
        $device = $assignment->device()->firstOrFail();
        $gateway = $route->gateway()->firstOrFail();
        $organization = $assignment->organization()->firstOrFail();
        $profile = $profileVersion->profile()->firstOrFail();
        $binding = $bindingVersion->binding()->firstOrFail();

        $hashFields = [
            'runtime_bundle_hash',
            'profile_artifact_hash',
            'binding_artifact_hash',
            'route_source_hash',
        ];

        foreach ($hashFields as $field) {
            if (
                ! is_string($runtimeBundle[$field] ?? null)
                || preg_match('/^[a-f0-9]{64}$/', $runtimeBundle[$field]) !== 1
            ) {
                throw new DomainInvariantViolation(
                    "Runtime Bundle {$field} must be a lowercase SHA-256 hash.",
                );
            }
        }

        if (
            ($runtimeBundle['schema'] ?? null) !== 'iot.runtime-bundle.v1'
            || ($runtimeBundle['organization_uuid'] ?? null) !== $organization->uuid
            || ($runtimeBundle['gateway_uuid'] ?? null) !== $gateway->uuid
            || ($runtimeBundle['gateway_route_uuid'] ?? null) !== $route->uuid
            || ($runtimeBundle['route_revision'] ?? null) !== $route->revision
            || ($runtimeBundle['route_path'] ?? null) !== $route->route_path
            || ($runtimeBundle['device_uuid'] ?? null) !== $device->uuid
            || ($runtimeBundle['profile_uuid'] ?? null) !== $profile->uuid
            || ($runtimeBundle['profile_version_uuid'] ?? null) !== $profileVersion->uuid
            || ($runtimeBundle['binding_uuid'] ?? null) !== $binding->uuid
            || ($runtimeBundle['binding_version_uuid'] ?? null) !== $bindingVersion->uuid
            || ($runtimeBundle['profile_artifact_hash'] ?? null) !== $profileVersion->artifact_hash
            || ($runtimeBundle['binding_artifact_hash'] ?? null) !== $bindingVersion->artifact_hash
            || (
                $assignment->runtime_bundle_hash !== null
                && ($runtimeBundle['runtime_bundle_hash'] ?? null) !== $assignment->runtime_bundle_hash
            )
            || (
                $assignment->route_source_hash !== null
                && ($runtimeBundle['route_source_hash'] ?? null) !== $assignment->route_source_hash
            )
        ) {
            throw new DomainInvariantViolation(
                'Runtime Bundle identities do not match the exact routed Device definition assignment.',
            );
        }
    }
}
