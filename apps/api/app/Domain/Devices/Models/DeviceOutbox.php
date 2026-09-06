<?php

declare(strict_types=1);

namespace App\Domain\Devices\Models;

final class DeviceOutbox extends DeviceModel
{
    protected $table = 'device_outbox';

    public $timestamps = false;

    protected function casts(): array
    {
        return ['payload' => 'array', 'leased_until' => 'immutable_datetime', 'published_at' => 'immutable_datetime'];
    }
}
