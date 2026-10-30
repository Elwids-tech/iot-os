<?php

declare(strict_types=1);

namespace App\Domain\Devices\Models;

use App\Domain\Shared\Models\Organization;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

final class Device extends DeviceModel
{
    protected $table = 'devices';

    protected function casts(): array
    {
        return ['state_revision' => 'integer', 'draft' => 'array', 'draft_revision' => 'integer', 'deployment_generation' => 'integer', 'applied_generation' => 'integer', 'last_seen_at' => 'immutable_datetime', 'runtime_seen_at' => 'immutable_datetime', 'tags' => 'array', 'custom_attributes' => 'array'];
    }

    public function site(): BelongsTo
    {
        return $this->belongsTo(Site::class);
    }

    /** The IANA zone for calendar periods: the site's, else the organization's, else UTC. */
    public function reportingTimezone(): string
    {
        return $this->site?->timezone ?? $this->organization?->timezone ?? 'UTC';
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

    public function appliedConfiguration(): BelongsTo
    {
        return $this->belongsTo(DeviceConfiguration::class, 'applied_configuration_uuid', 'uuid');
    }

    public function lastAppliedConfiguration(): BelongsTo
    {
        return $this->belongsTo(DeviceConfiguration::class, 'last_applied_configuration_uuid', 'uuid');
    }

    public function latestOperation(): HasOne
    {
        return $this->hasOne(DeviceOperation::class)->latestOfMany('generation');
    }

    public function commands(): HasMany
    {
        return $this->hasMany(DeviceCommand::class);
    }
}
