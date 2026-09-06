<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Actions;

use App\Domain\DeviceProfiles\Enums\DeviceProfileArtifactStatus;
use App\Domain\DeviceProfiles\Enums\DeviceProfileStatus;
use App\Domain\DeviceProfiles\Exceptions\ProfileDraftConflictException;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Models\DeviceProfileActivationOutbox;
use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\DeviceProfiles\Services\ProfileArtifactCache;
use App\Domain\Shared\Models\User;
use Illuminate\Support\Facades\DB;

final class PublishDeviceProfile
{
    public function __construct(
        private readonly CompileDeviceProfile $compile,
        private readonly ProfileArtifactCache $cache,
    ) {}

    public function handle(DeviceProfile $profile, User $actor, ?int $expectedDraftRevision): DeviceProfileArtifact
    {
        /** @var DeviceProfileArtifact $artifact */
        $artifact = DB::transaction(function () use ($profile, $actor, $expectedDraftRevision): DeviceProfileArtifact {
            /** @var DeviceProfile $locked */
            $locked = DeviceProfile::query()->lockForUpdate()->findOrFail($profile->getKey());

            if ($expectedDraftRevision !== null && $locked->draft_revision !== $expectedDraftRevision) {
                throw new ProfileDraftConflictException;
            }

            abort_if($locked->status === DeviceProfileStatus::ARCHIVED, 422, 'Archived profiles cannot be published.');
            abort_if($locked->status === DeviceProfileStatus::PUBLISHED, 422, 'There are no unpublished changes.');
            $nextRevision = $locked->revision + 1;
            $compiled = $this->compile->handle($locked, $nextRevision);

            DeviceProfileArtifact::query()
                ->where('device_profile_id', $locked->getKey())
                ->where('status', DeviceProfileArtifactStatus::ACTIVE->value)
                ->update(['status' => DeviceProfileArtifactStatus::RETIRED->value]);

            $artifact = DeviceProfileArtifact::query()->create([
                'device_profile_id' => $locked->getKey(),
                'revision' => $nextRevision,
                'definition_hash' => $compiled->hash,
                'definition' => $compiled->definition,
                'status' => DeviceProfileArtifactStatus::ACTIVE,
                'compiled_at' => now(),
                'compiled_by' => $actor->getKey(),
            ]);

            $locked->forceFill([
                'status' => DeviceProfileStatus::PUBLISHED,
                'revision' => $nextRevision,
                'definition_hash' => $compiled->hash,
                'published_at' => now(),
                'updated_by' => $actor->getKey(),
            ])->save();

            DeviceProfileActivationOutbox::query()->create([
                'device_profile_artifact_id' => $artifact->getKey(),
                'event_type' => 'definition.activated.v1',
                'payload' => [
                    'activated_at' => now()->toIso8601String(),
                    'artifact_hash' => 'sha256:'.$compiled->hash,
                    'definition_id' => $locked->uuid,
                    'definition_type' => 'device_profile',
                    'event_version' => 'definition.activated.v1',
                    'organization_id' => $locked->organization?->uuid,
                    'version_id' => $artifact->uuid,
                ],
            ]);

            return $artifact->load('profile');
        });

        // This runs only after the publication transaction commits. A cache
        // miss always remains recoverable from the immutable artifact table.
        $this->cache->cache($artifact);

        return $artifact;
    }
}
