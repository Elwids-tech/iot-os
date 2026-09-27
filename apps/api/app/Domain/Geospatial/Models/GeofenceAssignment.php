<?php

declare(strict_types=1);

namespace App\Domain\Geospatial\Models;

use App\Domain\Automation\Models\Workflow;
use App\Domain\Devices\Models\DeviceModel;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

final class GeofenceAssignment extends DeviceModel
{
    protected function casts(): array
    {
        return ['policy' => 'array', 'desired_geofence_revision' => 'integer', 'applied_geofence_revision' => 'integer'];
    }

    public function workflow(): BelongsTo
    {
        return $this->belongsTo(Workflow::class, 'automation_workflow_id');
    }
}
