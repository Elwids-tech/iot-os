<?php

declare(strict_types=1);

namespace App\Domain\DeviceAdapters\Models;

use App\Domain\Devices\Models\DeviceModel;

final class AdapterCandidate extends DeviceModel
{
    protected $table = 'device_adapter_candidates';

    protected function casts(): array
    {
        return ['preview' => 'array', 'last_seen_at' => 'immutable_datetime'];
    }

    public function installation()
    {
        return $this->hasOne(DeviceInstallation::class, 'device_adapter_candidate_id');
    }

    public function adapter()
    {
        return $this->belongsTo(DeviceAdapter::class, 'device_adapter_id');
    }
}
