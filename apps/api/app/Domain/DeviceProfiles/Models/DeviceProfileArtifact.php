<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Models;

use App\Domain\DeviceProfiles\Enums\DeviceProfileArtifactStatus;
use App\Domain\DeviceProfiles\Enums\DeviceProfileStatus;
use App\Domain\Shared\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

final class DeviceProfileArtifact extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'definition' => 'array',
            'status' => DeviceProfileArtifactStatus::class,
            'compiled_at' => 'immutable_datetime',
        ];
    }

    protected static function booted(): void
    {
        self::creating(function (self $artifact): void {
            $artifact->uuid ??= (string) Str::uuid();
        });
    }

    public function getRouteKeyName(): string
    {
        return 'uuid';
    }

    public function profile(): BelongsTo
    {
        return $this->belongsTo(DeviceProfile::class, 'device_profile_id');
    }

    /** Refuses a version of an archived profile for a new device, onboarding or adapter. */
    public function ensureNotArchived(): self
    {
        abort_if($this->profile->status === DeviceProfileStatus::ARCHIVED, 422, 'This profile is archived. Restore it before using it.');

        return $this;
    }

    public function compiledBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'compiled_by');
    }
}
