<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Models;

use App\Domain\DeviceProfiles\Enums\DeviceProfileArtifactStatus;
use App\Domain\Shared\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
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

    public function compiledBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'compiled_by');
    }

    public function activationEvents(): HasMany
    {
        return $this->hasMany(DeviceProfileActivationOutbox::class, 'device_profile_artifact_id');
    }
}
