<?php

declare(strict_types=1);

namespace App\Domain\Devices\Models;

final class DeviceOperation extends DeviceModel
{
    protected $table = 'device_operations';

    public $timestamps = false;

    protected function casts(): array
    {
        return ['generation' => 'integer', 'expected_generation' => 'integer', 'created_at' => 'immutable_datetime', 'completed_at' => 'immutable_datetime'];
    }
}
