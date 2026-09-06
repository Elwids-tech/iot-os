<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Str;

final class TransportBinding extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return ['adapter_config' => 'array'];
    }

    protected static function booted(): void
    {
        self::creating(function (self $binding): void {
            $binding->uuid ??= (string) Str::uuid();
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

    public function parameterMappings(): HasMany
    {
        return $this->hasMany(BindingParameterMapping::class);
    }
}
