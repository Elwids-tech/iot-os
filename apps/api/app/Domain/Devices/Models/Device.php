<?php

declare(strict_types=1);

namespace App\Domain\Devices\Models;

use App\Domain\Shared\Models\Organization;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

final class Device extends DeviceModel
{
    protected $table = 'devices';

    protected function casts(): array
    {
        return ['draft' => 'array', 'draft_revision' => 'integer', 'deployment_generation' => 'integer', 'last_seen_at' => 'immutable_datetime', 'runtime_seen_at' => 'immutable_datetime'];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function candidate(): BelongsTo
    {
        return $this->belongsTo(DiscoveryCandidate::class, 'device_discovery_candidate_id');
    }

    public function configurations(): HasMany
    {
        return $this->hasMany(DeviceConfiguration::class);
    }

    public function commands(): HasMany
    {
        return $this->hasMany(DeviceCommand::class);
    }
}
