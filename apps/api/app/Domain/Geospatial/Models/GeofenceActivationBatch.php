<?php

declare(strict_types=1);

namespace App\Domain\Geospatial\Models;

use App\Domain\Devices\Models\DeviceModel;

final class GeofenceActivationBatch extends DeviceModel
{
    protected function casts(): array
    {
        return ['geofence_revision' => 'integer'];
    }
}
