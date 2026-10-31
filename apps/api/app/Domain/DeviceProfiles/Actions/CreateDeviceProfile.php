<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Actions;

use App\Domain\Audit\Services\ActivityLog;
use App\Domain\DeviceProfiles\Enums\DeviceProfileStatus;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

final class CreateDeviceProfile
{
    /**
     * @param  array{code: string, name: string, description?: string|null, category?: string|null, extensions?: array<string, mixed>|null}  $attributes
     */
    public function handle(Organization $organization, User $actor, array $attributes): DeviceProfile
    {
        try {
            // A savepoint when nested: on PostgreSQL a failed insert would otherwise abort the caller's transaction.
            return DB::transaction(function () use ($organization, $actor, $attributes): DeviceProfile {
                $profile = DeviceProfile::query()->create([
                    ...$attributes,
                    'organization_id' => $organization->getKey(),
                    'status' => DeviceProfileStatus::DRAFT,
                    'created_by' => $actor->getKey(),
                    'updated_by' => $actor->getKey(),
                ]);
                ActivityLog::record('device_profile.created', $organization, $actor, $profile, ['code' => $profile->code]);

                return $profile;
            });
        } catch (UniqueConstraintViolationException) {
            throw ValidationException::withMessages(['code' => 'This profile code is already in use in this organization.']);
        }
    }
}
