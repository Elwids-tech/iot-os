<?php

declare(strict_types=1);

namespace App\Domain\Devices\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;

final class DiscoveryCandidate extends DeviceModel
{
    protected $table = 'device_discovery_candidates';

    protected function casts(): array
    {
        return ['metrics' => 'array', 'birth_revision' => 'integer', 'last_seen_at' => 'immutable_datetime'];
    }

    public function gateway(): BelongsTo
    {
        return $this->belongsTo(SparkplugGateway::class, 'sparkplug_gateway_id');
    }

    public function assignedDevice(): HasOne
    {
        return $this->hasOne(Device::class, 'reserved_source_uuid', 'uuid');
    }

    /**
     * The device whose guided setup targets this source but has not reserved it yet.
     * Setup claims a gateway + Device ID when it starts; the reservation follows when measurements are reviewed.
     */
    public function setupDevice(): ?Device
    {
        return DeviceOnboarding::where('sparkplug_gateway_id', $this->sparkplug_gateway_id)
            ->where('source_device_id', $this->source_device_id)
            ->whereHas('device', fn ($q) => $q->where('lifecycle', '!=', 'archived'))
            ->first()?->device;
    }
}
