<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Actions;

use App\Domain\Audit\Services\ActivityLog;
use App\Domain\DeviceAdapters\Models\DeviceAdapter;
use App\Domain\DeviceProfiles\Enums\DeviceProfileStatus;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\DeviceProfiles\Services\DeviceProfileAuthoring;
use App\Domain\Devices\Enums\BulkOnboardingStatus;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceBulkOnboarding;
use App\Domain\Shared\Models\User;
use Illuminate\Database\Eloquent\Builder;

/**
 * Archives a profile nothing uses, so it leaves profile pickers, or restores one.
 * An archived profile keeps its versions; it cannot be edited, published or chosen
 * for a new device, onboarding or adapter until it is restored.
 */
final class ArchiveDeviceProfile
{
    public function __construct(private readonly DeviceProfileAuthoring $authoring) {}

    public function archive(DeviceProfile $profile, User $actor, int $expectedDraftRevision): DeviceProfile
    {
        return $this->authoring->snapshot($profile, $expectedDraftRevision, function (DeviceProfile $locked) use ($actor): DeviceProfile {
            abort_if($locked->status === DeviceProfileStatus::ARCHIVED, 422, 'This profile is already archived.');
            // The status is what marks unpublished changes, so archiving them would lose that mark.
            abort_if($locked->status === DeviceProfileStatus::DRAFT && $locked->revision > 0, 422,
                'Publish or undo the unpublished changes before archiving this profile.');
            $uses = $this->uses($locked);
            abort_if($uses !== [], 422, 'This profile is still used by '.implode(', ', $uses).'.');

            return $this->transition($locked, $actor, DeviceProfileStatus::ARCHIVED, 'device_profile.archived');
        });
    }

    public function restore(DeviceProfile $profile, User $actor, int $expectedDraftRevision): DeviceProfile
    {
        return $this->authoring->snapshot($profile, $expectedDraftRevision, function (DeviceProfile $locked) use ($actor): DeviceProfile {
            abort_unless($locked->status === DeviceProfileStatus::ARCHIVED, 422, 'This profile is not archived.');

            return $this->transition($locked, $actor,
                $locked->revision > 0 ? DeviceProfileStatus::PUBLISHED : DeviceProfileStatus::DRAFT,
                'device_profile.restored');
        });
    }

    /**
     * What still depends on the profile, as phrases for the refusal: devices that are
     * not archived (configured, or with a draft on one of its versions), adapters, and
     * bulk onboardings that have not finished.
     *
     * @return list<string>
     */
    public function uses(DeviceProfile $profile): array
    {
        $artifacts = DeviceProfileArtifact::query()->where('device_profile_id', $profile->getKey());
        $ids = $artifacts->pluck('id');
        $uuids = $artifacts->pluck('uuid');
        if ($ids->isEmpty()) {
            return [];
        }
        $devices = Device::query()
            ->where('organization_id', $profile->organization_id)
            ->where('lifecycle', '!=', 'archived')
            ->where(fn (Builder $query) => $query
                ->whereExists(fn ($configured) => $configured->selectRaw('1')->from('device_configurations')
                    ->whereColumn('device_configurations.device_id', 'devices.id')
                    ->whereIn('device_configurations.device_profile_artifact_id', $ids))
                ->orWhereIn('draft->artifact_uuid', $uuids))
            ->count();
        $adapters = DeviceAdapter::query()->whereIn('device_profile_artifact_id', $ids)->count();
        $onboardings = DeviceBulkOnboarding::query()->whereIn('device_profile_artifact_id', $ids)
            ->whereIn('status', [BulkOnboardingStatus::Queued, BulkOnboardingStatus::Running])->count();

        return array_values(array_filter([
            $devices ? $this->count($devices, 'device') : null,
            $adapters ? $this->count($adapters, 'device adapter') : null,
            $onboardings ? $this->count($onboardings, 'bulk onboarding').' in progress' : null,
        ]));
    }

    private function transition(DeviceProfile $locked, User $actor, DeviceProfileStatus $status, string $event): DeviceProfile
    {
        $locked->forceFill([
            'status' => $status,
            'draft_revision' => $locked->draft_revision + 1,
            'updated_by' => $actor->getKey(),
        ])->save();
        ActivityLog::record($event, $locked->organization_id, $actor, $locked, ['code' => $locked->code]);

        return $locked->fresh();
    }

    private function count(int $count, string $noun): string
    {
        return $count.' '.$noun.($count === 1 ? '' : 's');
    }
}
