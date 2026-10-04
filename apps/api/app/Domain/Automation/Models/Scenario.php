<?php

namespace App\Domain\Automation\Models;

use App\Domain\Devices\Models\DeviceModel;

final class Scenario extends DeviceModel
{
    protected $table = 'automation_scenarios';

    protected function casts(): array
    {
        return ['definition' => 'array', 'revision' => 'integer', 'draft_revision' => 'integer'];
    }
}
