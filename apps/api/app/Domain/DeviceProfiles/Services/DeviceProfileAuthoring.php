<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Services;

use App\Domain\DeviceProfiles\Enums\DeviceProfileStatus;
use App\Domain\DeviceProfiles\Exceptions\ProfileDraftConflictException;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\Shared\Models\User;
use Closure;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

final class DeviceProfileAuthoring
{
    /**
     * @template T
     *
     * @param  Closure(DeviceProfile): T  $mutation
     * @return array{profile: DeviceProfile, result: T}
     */
    public function mutate(DeviceProfile $profile, User $actor, ?int $expectedDraftRevision, Closure $mutation): array
    {
        try {
            return DB::transaction(function () use ($profile, $actor, $expectedDraftRevision, $mutation): array {
                /** @var DeviceProfile $locked */
                $locked = DeviceProfile::query()->lockForUpdate()->findOrFail($profile->getKey());

                if ($expectedDraftRevision !== null && $locked->draft_revision !== $expectedDraftRevision) {
                    throw new ProfileDraftConflictException;
                }

                abort_if($locked->status === DeviceProfileStatus::ARCHIVED, 422, 'Archived profiles cannot be edited.');
                $locked->beginDraft($actor);
                $result = $mutation($locked);
                $locked->save();

                return ['profile' => $locked->fresh(), 'result' => $result];
            });
        } catch (UniqueConstraintViolationException $exception) {
            $field = str_contains($exception->getSql(), 'profile_parameters') ? 'key' : 'code';
            throw ValidationException::withMessages([$field => 'This '.$field.' is already in use. Choose a unique value.']);
        }
    }

    /** Hold the aggregate lock so a preview and its revision describe the same snapshot. */
    public function snapshot(DeviceProfile $profile, ?int $revision, Closure $read): mixed
    {
        return DB::transaction(function () use ($profile, $revision, $read): mixed {
            $locked = DeviceProfile::query()->lockForUpdate()->findOrFail($profile->getKey());
            if ($revision !== null && $locked->draft_revision !== $revision) {
                throw new ProfileDraftConflictException;
            }

            return $read($locked);
        });
    }
}
