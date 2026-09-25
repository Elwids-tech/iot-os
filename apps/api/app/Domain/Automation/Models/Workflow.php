<?php

declare(strict_types=1);

namespace App\Domain\Automation\Models;

use App\Domain\Devices\Models\DeviceModel;

final class Workflow extends DeviceModel
{
    protected $table = 'automation_workflows';

    protected function casts(): array
    {
        return ['workflow' => 'array', 'definition' => 'array', 'draft_revision' => 'integer', 'deployment_generation' => 'integer'];
    }
}
