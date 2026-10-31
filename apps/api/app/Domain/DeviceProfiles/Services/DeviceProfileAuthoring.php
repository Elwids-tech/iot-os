<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Services;

use App\Domain\Audit\Services\ActivityChanges;
use App\Domain\Audit\Services\ActivityLog;
use App\Domain\DeviceProfiles\Enums\DeviceProfileStatus;
use App\Domain\DeviceProfiles\Exceptions\ProfileDraftConflictException;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\Shared\Models\User;
use Closure;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

final class DeviceProfileAuthoring
{
    /** Profile fields an edit records with their values (spec 024); `extensions` is only named. */
    private const DIFFED = ['code', 'name', 'description', 'category'];

    /**
     * Applies one draft change and records it in the activity log: `$change` names it
     * (`updated` for the profile's own fields, else for example `parameter.created`),
     * and `$item` is what it changed when the mutation returns nothing to name.
     *
     * @template T
     *
     * @param  Closure(DeviceProfile): T  $mutation
     * @return array{profile: DeviceProfile, result: T}
     */
    public function mutate(DeviceProfile $profile, User $actor, ?int $expectedDraftRevision, Closure $mutation, string $change = 'updated', ?Model $item = null): array
    {
        try {
            return DB::transaction(function () use ($profile, $actor, $expectedDraftRevision, $mutation, $change, $item): array {
                /** @var DeviceProfile $locked */
                $locked = DeviceProfile::query()->lockForUpdate()->findOrFail($profile->getKey());

                if ($expectedDraftRevision !== null && $locked->draft_revision !== $expectedDraftRevision) {
                    throw new ProfileDraftConflictException;
                }

                abort_if($locked->status === DeviceProfileStatus::ARCHIVED, 422, 'Archived profiles cannot be edited.');
                $locked->beginDraft($actor);
                $before = $locked->only([...self::DIFFED, 'extensions']);
                $result = $mutation($locked);
                $locked->save();
                // What the mutation returns names the item best, unless it is something else (a mapping of a binding).
                $named = $result instanceof Model && ($item === null || $result instanceof $item) ? $result : $item;
                $this->record($locked, $actor, $change, $named, $before);

                return ['profile' => $locked->fresh(), 'result' => $result];
            });
        } catch (UniqueConstraintViolationException $exception) {
            $field = str_contains($exception->getSql(), 'profile_parameters') ? 'key' : 'code';
            throw ValidationException::withMessages([$field => 'This '.$field.' is already in use. Choose a unique value.']);
        }
    }

    /**
     * @param  array<string, mixed>  $before
     */
    private function record(DeviceProfile $profile, User $actor, string $change, ?Model $item, array $before): void
    {
        if ($change === 'updated') {
            $after = $profile->only([...self::DIFFED, 'extensions']);
            ActivityLog::record('device_profile.updated', $profile->organization_id, $actor, $profile, array_filter([
                'draft_revision' => $profile->draft_revision,
                'changed' => $before['extensions'] != $after['extensions'] ? ['extensions'] : [],
            ]), ActivityChanges::between($before, $after, self::DIFFED));

            return;
        }

        ActivityLog::record('device_profile.draft_changed', $profile->organization_id, $actor, $profile, array_filter([
            'change' => $change,
            'item' => $item === null ? null : self::label($item),
            'draft_revision' => $profile->draft_revision,
        ], fn (mixed $value): bool => $value !== null));
    }

    /** A parameter's key, an alarm's code, a group's or binding's name. */
    private static function label(Model $item): ?string
    {
        foreach (['key', 'code', 'name', 'label', 'protocol'] as $attribute) {
            $value = $item->getAttribute($attribute);
            if (is_string($value) && $value !== '') {
                return $value;
            }
        }

        return null;
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
