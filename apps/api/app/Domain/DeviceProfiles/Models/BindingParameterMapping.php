<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

final class BindingParameterMapping extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'transport_locator' => 'array',
            'codec_config' => 'array',
            'transform_config' => 'array',
        ];
    }

    protected static function booted(): void
    {
        self::creating(function (self $mapping): void {
            $mapping->uuid ??= (string) Str::uuid();
        });
    }

    public function getRouteKeyName(): string
    {
        return 'uuid';
    }

    public function binding(): BelongsTo
    {
        return $this->belongsTo(TransportBinding::class, 'transport_binding_id');
    }

    public function parameter(): BelongsTo
    {
        return $this->belongsTo(ProfileParameter::class, 'profile_parameter_id');
    }
}
