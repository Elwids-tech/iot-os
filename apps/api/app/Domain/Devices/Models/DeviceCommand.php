<?php

declare(strict_types=1);

namespace App\Domain\Devices\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;

final class DeviceCommand extends DeviceModel
{
    protected $table = 'device_commands';

    protected function casts(): array
    {
        return ['value' => 'json', 'confirmed_at' => 'immutable_datetime', 'expires_at' => 'immutable_datetime', 'sent_at' => 'immutable_datetime', 'completed_at' => 'immutable_datetime'];
    }

    public function device(): BelongsTo
    {
        return $this->belongsTo(Device::class);
    }

    public function configuration(): BelongsTo
    {
        return $this->belongsTo(DeviceConfiguration::class, 'device_configuration_id');
    }
}
