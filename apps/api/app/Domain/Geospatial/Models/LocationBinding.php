<?php

declare(strict_types=1);

namespace App\Domain\Geospatial\Models;

use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceModel;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

final class LocationBinding extends DeviceModel
{
    protected $table = 'device_location_bindings';

    protected function casts(): array
    {
        return ['revision' => 'integer', 'generation' => 'integer', 'max_age_seconds' => 'integer',
            'max_future_skew_seconds' => 'integer', 'allow_unknown_accuracy' => 'boolean'];
    }

    public function device(): BelongsTo
    {
        return $this->belongsTo(Device::class);
    }
}
