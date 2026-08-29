<?php

declare(strict_types=1);

namespace App\Domain\DeviceManagement\Services;

use App\Domain\DeviceManagement\Data\DeviceDraftData;
use App\Domain\DeviceManagement\Enums\DeviceLifecycleState;
use App\Domain\DeviceManagement\Models\Device;
use App\Domain\DeviceManagement\Models\DeviceDefinitionAssignment;
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
            $updated = DeviceDefinitionAssignment::query()
                ->whereKey($assignment->getKey())
                ->where('revision', $revision)
                ->update([
                    'device_profile_version_id' => $lockedProfileVersion->getKey(),
                    'transport_binding_version_id' => $lockedBindingVersion->getKey(),
                    'updated_by_id' => $actor?->getKey(),
                    'revision' => $revision + 1,
                    'updated_at' => now(),
                ]);

            if ($updated !== 1) {
                throw new StaleEntityTag(DeviceDefinitionAssignment::query()->findOrFail($assignment->getKey())->etag());
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
            throw new DomainInvariantViolation('A Device assignment requires a coordinated published definition from the same Organization.');
        }
    }
}
