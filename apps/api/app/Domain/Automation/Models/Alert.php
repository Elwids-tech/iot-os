<?php

declare(strict_types=1);

namespace App\Domain\Automation\Models;

use App\Domain\Devices\Models\DeviceModel;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

final class Alert extends DeviceModel
{
    protected $table = 'automation_alerts';

    protected function casts(): array
    {
        return ['episode' => 'integer', 'activated_at' => 'immutable_datetime', 'cleared_at' => 'immutable_datetime', 'acknowledged_at' => 'immutable_datetime'];
    }

    public function workflow(): BelongsTo
    {
        return $this->belongsTo(Workflow::class, 'automation_workflow_id');
    }

    public function deployment(): BelongsTo
    {
        return $this->belongsTo(Deployment::class, 'automation_deployment_id');
    }
}
