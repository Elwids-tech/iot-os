<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Str;

final class ProfileAlarmTemplate extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'condition_config' => 'array',
            'enabled_by_default' => 'boolean',
        ];
    }

    protected static function booted(): void
    {
        self::creating(function (self $template): void {
            $template->uuid ??= (string) Str::uuid();
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

    public function parameterReferences(): HasMany
    {
        return $this->hasMany(ProfileAlarmTemplateParameter::class);
    }
}
