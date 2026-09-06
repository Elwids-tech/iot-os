<?php

declare(strict_types=1);

namespace App\Domain\Devices\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

final class SparkplugGateway extends DeviceModel
{
    protected $table = 'sparkplug_gateways';

    protected $hidden = ['password', 'username'];

    protected function casts(): array
    {
        return ['password' => 'encrypted', 'last_seen_at' => 'immutable_datetime', 'runtime_seen_at' => 'immutable_datetime'];
    }

    public function connection(): BelongsTo
    {
        return $this->belongsTo(SparkplugConnection::class, 'sparkplug_connection_id');
    }

    public function candidates(): HasMany
    {
        return $this->hasMany(DiscoveryCandidate::class);
    }
}
