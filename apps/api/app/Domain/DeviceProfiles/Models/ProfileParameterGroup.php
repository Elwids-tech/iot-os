<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Str;

final class ProfileParameterGroup extends Model
{
    protected $guarded = [];

    protected static function booted(): void
    {
        self::creating(function (self $group): void {
            $group->uuid ??= (string) Str::uuid();
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

    public function parameters(): HasMany
    {
        return $this->hasMany(ProfileParameter::class, 'parameter_group_id');
    }
}
