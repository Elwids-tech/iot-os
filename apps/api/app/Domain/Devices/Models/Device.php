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

    /*
     * Deployment pointers. They say where a device stands between what Laravel asked
     * for and what the runtime confirmed, and they change only here:
     *
     * - desired_configuration_uuid: the configuration that should run, or null.
     * - applied_configuration_uuid and applied_generation: what the runtime last
     *   confirmed, which telemetry and automation bindings carry (ADR-027).
     * - deployment_generation: counts requests; the runtime's answers name it.
     *
     * deployment_status is what people see: pending, applied, failed or inactive.
     */

    /**
     * A change was requested: a configuration to run, or null to deactivate. The
     * request is pending under the next generation. $also carries what else the
     * caller changes in the same write (draft revision, diagnostic, who asked).
     *
     * @param  array<string, mixed>  $also
     */
    public function deploymentRequested(?string $configurationUuid, array $also = []): void
    {
        $this->forceFill([
            'desired_configuration_uuid' => $configurationUuid, 'deployment_status' => 'pending',
            'deployment_generation' => $this->deployment_generation + 1,
            'state_revision' => $this->state_revision + 1,
        ] + $also)->save();
    }

    /** The runtime applied the desired configuration under the current generation. */
    public function configurationApplied(string $configurationUuid, string $presence): void
    {
        $this->update([
            'applied_configuration_uuid' => $configurationUuid, 'last_applied_configuration_uuid' => $configurationUuid,
            'applied_generation' => $this->deployment_generation, 'deployment_status' => 'applied', 'lifecycle' => 'active',
            'presence' => $presence, 'diagnostic' => null, 'runtime_seen_at' => now(),
        ]);
    }

    /** The runtime stopped the device. The last applied configuration is remembered for a later resume. */
    public function deactivationApplied(): void
    {
        $this->update([
            'applied_configuration_uuid' => null, 'applied_generation' => null, 'deployment_status' => 'inactive',
            'lifecycle' => 'deactivated', 'presence' => 'offline', 'diagnostic' => null,
        ]);
    }

    /** The runtime refused the request. The applied configuration and its generation stay, and so do their bindings (ADR-027). */
    public function deploymentFailed(string $diagnostic): void
    {
        $this->update(['deployment_status' => 'failed', 'diagnostic' => $diagnostic]);
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
