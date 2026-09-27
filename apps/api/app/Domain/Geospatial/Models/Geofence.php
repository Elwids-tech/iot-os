<?php

declare(strict_types=1);

namespace App\Domain\Geospatial\Models;

use App\Domain\Devices\Models\DeviceModel;

final class Geofence extends DeviceModel
{
    protected function casts(): array
    {
        return ['geometry' => 'array', 'revision' => 'integer'];
    }
}
