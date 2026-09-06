<?php

declare(strict_types=1);

namespace App\Domain\Devices\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;

final class DiscoveryCandidate extends DeviceModel
{
    protected $table = 'device_discovery_candidates';

    protected function casts(): array
    {
        return ['metrics' => 'array', 'birth_revision' => 'integer', 'last_seen_at' => 'immutable_datetime'];
    }

    public function gateway(): BelongsTo
    {
        return $this->belongsTo(SparkplugGateway::class, 'sparkplug_gateway_id');
    }
}
