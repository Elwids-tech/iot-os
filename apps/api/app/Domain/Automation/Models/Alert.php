<?php

declare(strict_types=1);

namespace App\Domain\Automation\Models;

use App\Domain\DeviceAdapters\Models\DeviceAdapter;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceModel;
use App\Domain\Devices\Models\SparkplugGateway;
use App\Domain\Shared\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Support\Collection;

/**
 * One alert episode. Workflow alerts belong to a workflow and its deployment; device
 * connectivity alerts (spec 018) name a device, gateway or adapter instead.
 */
final class Alert extends DeviceModel
{
    public const WORKFLOW = 'workflow';

    public const DEVICE_OFFLINE = 'device_offline';

    public const GATEWAY_OFFLINE = 'gateway_offline';

    public const CONNECTION_LOST = 'connection_lost';

    public const KINDS = [self::WORKFLOW, self::DEVICE_OFFLINE, self::GATEWAY_OFFLINE, self::CONNECTION_LOST];

    /**
     * The stop reason Laravel sets on a moved device's open alerts at cutover (spec 031,
     * research R7). Later runtime transitions for such an alert are ignored.
     */
    public const STOPPED_DEVICE_MOVED = 'device_moved';

    protected $table = 'automation_alerts';

    protected function casts(): array
    {
        return [
            'episode' => 'integer', 'activated_at' => 'immutable_datetime', 'cleared_at' => 'immutable_datetime', 'acknowledged_at' => 'immutable_datetime', 'assigned_at' => 'immutable_datetime',
            'offline_since' => 'immutable_datetime', 'last_seen_at' => 'immutable_datetime', 'last_observed_at' => 'immutable_datetime', 'suppressed_at' => 'immutable_datetime',
            'threshold_seconds' => 'integer', 'grace_seconds' => 'integer', 'reporting_interval_seconds' => 'integer', 'poll_interval_seconds' => 'integer',
            'threshold_automatic' => 'boolean', 'held' => 'boolean', 'held_count' => 'integer',
        ];
    }

    /**
     * The alerts that end when these devices move (spec 031, research R7): their own and
     * those that list them, except a gateway alert that still lists a device staying
     * behind the gateway, which stays open for it (R14).
     *
     * @param  Collection<int, int>  $ids
     */
    public function scopeEndingWithMoved(Builder $query, Collection $ids): void
    {
        $query->where(fn (Builder $theirs) => $theirs->whereIn('subject_device_id', $ids)->orWhere(fn (Builder $listing) => $listing
            ->whereHas('devices', fn (Builder $devices) => $devices->whereIn('devices.id', $ids))
            ->where(fn (Builder $kind) => $kind->where('kind', '!=', self::GATEWAY_OFFLINE)->orWhereDoesntHave('devices', fn (Builder $devices) => $devices->whereNotIn('devices.id', $ids)))));
    }

    public function isWorkflow(): bool
    {
        return ($this->kind ?? self::WORKFLOW) === self::WORKFLOW;
    }

    public function workflow(): BelongsTo
    {
        return $this->belongsTo(Workflow::class, 'automation_workflow_id');
    }

    public function deployment(): BelongsTo
    {
        return $this->belongsTo(Deployment::class, 'automation_deployment_id');
    }

    /** The devices the alert concerns: a workflow alert's bound device, or every device a connectivity alert covers. */
    public function devices(): BelongsToMany
    {
        return $this->belongsToMany(Device::class, 'automation_alert_devices', 'automation_alert_id', 'device_id');
    }

    public function subjectDevice(): BelongsTo
    {
        return $this->belongsTo(Device::class, 'subject_device_id');
    }

    public function subjectGateway(): BelongsTo
    {
        return $this->belongsTo(SparkplugGateway::class, 'subject_gateway_id');
    }

    public function subjectAdapter(): BelongsTo
    {
        return $this->belongsTo(DeviceAdapter::class, 'subject_adapter_id');
    }

    /**
     * The device, gateway or adapter a connectivity alert concerns, as its organization
     * sees it; null for workflow alerts. A gateway of another organization, whose pipe
     * serves the alert's hosted devices (spec 031, research R14), is named only. Load
     * `subjectGateway` with its `organization_id`.
     *
     * @return ?array{type: 'device'|'gateway'|'adapter', uuid: ?string, name: string}
     */
    public function subjectSummary(): ?array
    {
        return match (true) {
            $this->subjectDevice !== null => ['type' => 'device', 'uuid' => $this->subjectDevice->uuid, 'name' => $this->subjectDevice->name],
            $this->subjectGateway !== null => ['type' => 'gateway', 'uuid' => $this->subjectGateway->organization_id === $this->organization_id ? $this->subjectGateway->uuid : null, 'name' => $this->subjectGateway->name],
            $this->subjectAdapter !== null => ['type' => 'adapter', 'uuid' => $this->subjectAdapter->uuid, 'name' => $this->subjectAdapter->name],
            default => null,
        };
    }

    public function acknowledger(): BelongsTo
    {
        return $this->belongsTo(User::class, 'acknowledged_by');
    }

    public function assignee(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assigned_to');
    }
}
