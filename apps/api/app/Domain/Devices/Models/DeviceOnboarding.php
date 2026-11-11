<?php

declare(strict_types=1);

namespace App\Domain\Devices\Models;

use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

final class DeviceOnboarding extends DeviceModel
{
    protected function casts(): array
    {
        return ['provisioned_at' => 'immutable_datetime', 'released_at' => 'immutable_datetime'];
    }

    /**
     * Releases the device's setup when it is archived or moved (spec 031, research R7), so
     * its gateway source can be onboarded again once no device holds it.
     */
    public static function release(Device $device): void
    {
        self::where('device_id', $device->id)->whereNull('released_at')->update(['released_at' => now()]);
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
