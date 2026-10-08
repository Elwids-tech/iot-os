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
}
