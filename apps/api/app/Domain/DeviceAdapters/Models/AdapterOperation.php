<?php

declare(strict_types=1);

namespace App\Domain\DeviceAdapters\Models;

use App\Domain\Devices\Models\DeviceModel;

final class AdapterOperation extends DeviceModel
{
    protected $table = 'device_adapter_operations';

    public function adapter()
    {
        return $this->belongsTo(DeviceAdapter::class, 'device_adapter_id');
    }
}
