<?php

declare(strict_types=1);

namespace App\Domain\Devices\Models;

use App\Domain\Automation\Models\Alert;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasManyThrough;
use Illuminate\Database\Eloquent\Relations\HasOne;

final class SparkplugGateway extends DeviceModel
{
    protected $table = 'sparkplug_gateways';

    protected $hidden = ['password', 'username'];

    protected function casts(): array
    {
        return ['password' => 'encrypted', 'last_seen_at' => 'immutable_datetime', 'runtime_seen_at' => 'immutable_datetime', 'firmware_selection' => 'array'];
    }

    public function connection(): BelongsTo
    {
        return $this->belongsTo(SparkplugConnection::class, 'sparkplug_connection_id');
    }

    public function candidates(): HasMany
    {
        return $this->hasMany(DiscoveryCandidate::class);
    }

    /** Devices configured from a source behind this gateway, in every lifecycle. */
    public function devices(): HasManyThrough
    {
        return $this->hasManyThrough(Device::class, DiscoveryCandidate::class, 'sparkplug_gateway_id', 'device_discovery_candidate_id');
    }

    /** The open Gateway offline alert of this gateway (spec 018), if any. */
    public function offlineAlert(): HasOne
    {
        return $this->hasOne(Alert::class, 'subject_gateway_id')->ofMany(['id' => 'max'], fn ($query) => $query->where('automation_alerts.kind', Alert::GATEWAY_OFFLINE)->whereNull('automation_alerts.cleared_at'));
    }
}
