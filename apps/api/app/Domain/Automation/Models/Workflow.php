<?php

declare(strict_types=1);

namespace App\Domain\Automation\Models;

use App\Domain\Devices\Models\DeviceModel;

final class Workflow extends DeviceModel
{
    protected $table = 'automation_workflows';

    protected function casts(): array
    {
        return ['layout' => 'array', 'layout_revision' => 'integer', 'workflow' => 'array', 'definition' => 'array', 'draft_revision' => 'integer', 'deployment_generation' => 'integer', 'notification_settings' => 'array', 'notification_revision' => 'integer'];
    }

    /** DAG automations are schema v2; geofence workflows are v1. */
    public function kind(): string
    {
        return ($this->workflow['schema_version'] ?? '') === 'automation-workflow.v2' ? 'automation' : 'geofence';
    }
}
