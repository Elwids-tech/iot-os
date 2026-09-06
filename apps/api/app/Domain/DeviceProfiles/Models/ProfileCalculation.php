<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Str;

final class ProfileCalculation extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return ['expression' => 'array'];
    }

    protected static function booted(): void
    {
        self::creating(function (self $calculation): void {
            $calculation->uuid ??= (string) Str::uuid();
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

    public function target(): BelongsTo
    {
        return $this->belongsTo(ProfileParameter::class, 'target_profile_parameter_id');
    }

    public function inputs(): HasMany
    {
        return $this->hasMany(ProfileCalculationInput::class);
    }
}
