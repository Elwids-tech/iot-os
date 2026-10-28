<?php

declare(strict_types=1);

namespace App\Domain\DeviceAdapters\Models;

use App\Domain\Devices\Models\DeviceModel;

final class AdapterProposal extends DeviceModel
{
    protected $table = 'device_adapter_proposals';

    protected function casts(): array
    {
        return ['evidence' => 'array', 'draft_revision' => 'integer', 'source' => 'array', 'fixtures' => 'array'];
    }
}
