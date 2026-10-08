<?php

declare(strict_types=1);

namespace App\Domain\DeviceAdapters\Models;

use App\Domain\Devices\Models\DeviceModel;

final class AdapterRevision extends DeviceModel
{
    protected $table = 'device_adapter_revisions';

    protected $hidden = ['secret_snapshot'];

    protected function casts(): array
    {
        return ['definition' => 'array', 'secret_snapshot' => 'encrypted:array', 'test_result' => 'array', 'tested_at' => 'immutable_datetime', 'revision' => 'integer'];
    }

    public function adapter()
    {
        return $this->belongsTo(DeviceAdapter::class, 'device_adapter_id');
    }
}
