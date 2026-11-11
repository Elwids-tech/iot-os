<?php

declare(strict_types=1);

namespace App\Domain\Devices\Models;

use App\Domain\Automation\Models\Alert;
use App\Domain\DeviceAdapters\Models\DeviceInstallation;
use App\Domain\Shared\Models\Organization;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

final class Device extends DeviceModel
{
    protected $table = 'devices';

    protected function casts(): array
    {
        return ['state_revision' => 'integer', 'draft' => 'array', 'draft_revision' => 'integer', 'deployment_generation' => 'integer', 'applied_generation' => 'integer', 'last_seen_at' => 'immutable_datetime', 'runtime_seen_at' => 'immutable_datetime', 'limit_place_at' => 'immutable_datetime', 'tags' => 'array', 'custom_attributes' => 'array'];
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

    /** Open offline alerts (spec 018) that list the device, its own or its gateway's, newest first. */
    public function openConnectivityAlerts(): BelongsToMany
    {
        return $this->belongsToMany(Alert::class, 'automation_alert_devices', 'device_id', 'automation_alert_id')
            ->where('automation_alerts.kind', '!=', Alert::WORKFLOW)->whereNull('automation_alerts.cleared_at')->orderByDesc('automation_alerts.id');
    }

    /** The adapter installation feeding the device, if one does. */
    public function openInstallation(): HasOne
    {
        return $this->hasOne(DeviceInstallation::class)->whereNull('ended_at');
    }

    /** The link to the device this one became in another organization (spec 031). */
    public function movedTo(): HasOne
    {
        return $this->hasOne(DeviceLink::class, 'predecessor_device_id');
    }

    /** The link from the device this one was in another organization (spec 031). */
    public function movedFrom(): HasOne
    {
        return $this->hasOne(DeviceLink::class, 'successor_device_id');
    }
}
