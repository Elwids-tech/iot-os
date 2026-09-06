<?php

declare(strict_types=1);

namespace App\Domain\Devices\Models;

use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

final class DeviceConfiguration extends DeviceModel
{
    protected $table = 'device_configurations';

    public $timestamps = false;

    protected function casts(): array
    {
        return ['definition' => 'array', 'revision' => 'integer', 'created_at' => 'immutable_datetime'];
    }

    public function device(): BelongsTo
    {
        return $this->belongsTo(Device::class);
    }

    public function artifact(): BelongsTo
    {
        return $this->belongsTo(DeviceProfileArtifact::class, 'device_profile_artifact_id');
    }

    protected static function booted(): void
    {
        parent::booted();
        self::updating(static fn () => throw new \LogicException('Device configuration snapshots are immutable.'));
        self::deleting(static fn () => throw new \LogicException('Device configuration history cannot be deleted.'));
    }
}
