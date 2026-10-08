<?php

declare(strict_types=1);

namespace App\Domain\Devices\Models;

use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

final class DeviceOnboarding extends DeviceModel
{
    protected function casts(): array
    {
        return ['provisioned_at' => 'immutable_datetime'];
    }

    public function device(): BelongsTo
    {
        return $this->belongsTo(Device::class);
    }

    public function gateway(): BelongsTo
    {
        return $this->belongsTo(SparkplugGateway::class, 'sparkplug_gateway_id');
    }

    public function artifact(): BelongsTo
    {
        return $this->belongsTo(DeviceProfileArtifact::class, 'device_profile_artifact_id');
    }
}
