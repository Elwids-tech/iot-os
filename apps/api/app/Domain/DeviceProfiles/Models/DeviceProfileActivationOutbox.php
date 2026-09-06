<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

final class DeviceProfileActivationOutbox extends Model
{
    protected $table = 'device_profile_activation_outbox';

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'payload' => 'array',
            'published_at' => 'immutable_datetime',
        ];
    }

    protected static function booted(): void
    {
        self::creating(function (self $event): void {
            $event->uuid ??= (string) Str::uuid();
        });
    }

    public function artifact(): BelongsTo
    {
        return $this->belongsTo(DeviceProfileArtifact::class, 'device_profile_artifact_id');
    }
}
