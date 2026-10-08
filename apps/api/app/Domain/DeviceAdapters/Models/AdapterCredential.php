<?php

declare(strict_types=1);

namespace App\Domain\DeviceAdapters\Models;

use App\Domain\Devices\Models\DeviceModel;

final class AdapterCredential extends DeviceModel
{
    protected $table = 'device_adapter_credentials';

    protected $hidden = ['password'];

    protected function casts(): array
    {
        return ['password' => 'encrypted', 'revoked_at' => 'immutable_datetime'];
    }
}
