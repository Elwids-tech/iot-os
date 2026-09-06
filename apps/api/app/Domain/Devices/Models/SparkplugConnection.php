<?php

declare(strict_types=1);

namespace App\Domain\Devices\Models;

use Illuminate\Database\Eloquent\Relations\HasMany;

final class SparkplugConnection extends DeviceModel
{
    protected $table = 'sparkplug_connections';

    protected $hidden = ['password', 'username'];

    protected function casts(): array
    {
        return ['password' => 'encrypted'];
    }

    public function gateways(): HasMany
    {
        return $this->hasMany(SparkplugGateway::class);
    }
}
