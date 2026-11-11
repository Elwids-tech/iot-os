<?php

declare(strict_types=1);

namespace App\Domain\DeviceAdapters\Models;

use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceModel;

final class DeviceInstallation extends DeviceModel
{
    protected function casts(): array
    {
        return ['started_at' => 'immutable_datetime', 'ended_at' => 'immutable_datetime'];
    }

    public function device()
    {
        return $this->belongsTo(Device::class);
    }

    public function candidate()
    {
        return $this->belongsTo(AdapterCandidate::class, 'device_adapter_candidate_id');
    }

    /**
     * Ends the device's open installation, if it has one, so its source can serve another
     * device (spec 031, research R3): `archived` or `moved`. Returns the ended installation.
     */
    public static function end(Device $device, string $reason): ?self
    {
        $installation = self::where('device_id', $device->id)->whereNull('ended_at')->lockForUpdate()->first();
        $installation?->update(['ended_at' => now(), 'ended_reason' => $reason]);

        return $installation;
    }
}
