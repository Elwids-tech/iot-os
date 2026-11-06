<?php

declare(strict_types=1);

namespace App\Domain\Connectivity\Services;

use App\Domain\DeviceAdapters\Models\AdapterRevision;
use App\Domain\DeviceAdapters\Models\DeviceAdapter;
use App\Domain\Devices\Models\Device;
use Illuminate\Support\Facades\DB;

/**
 * A device's effective offline-alert settings (spec 018, D5, D6). Pull request 2 has
 * only the platform defaults: on, stays connected, an automatic Offline after, a
 * two-minute grace period and warning severity. A device fed by a device adapter
 * always connects to report and carries its adapter's running poll interval.
 */
final class ConnectivitySettings
{
    public const DEFAULTS = ['enabled' => true, 'style' => 'stays_connected', 'offline_after_seconds' => null, 'grace_seconds' => 120, 'severity' => 'warning'];

    /** Settings stay at generation 0 until pull request 3 lets people change them. */
    public const GENERATION = 0;

    /**
     * The adapter behind each device with an open installation, keyed by device id,
     * in three queries however many devices there are. Null lists every device.
     *
     * @param  list<int>|null  $devices
     * @return array<int, array{adapter_id: int, uuid: string, name: string, status: string, poll_interval_seconds: ?int}>
     */
    public function adapters(?array $devices = null): array
    {
        $installations = DB::table('device_installations')
            ->join('device_adapter_candidates', 'device_adapter_candidates.id', '=', 'device_installations.device_adapter_candidate_id')
            ->whereNull('device_installations.ended_at')
            ->when($devices !== null, fn ($query) => $query->whereIn('device_installations.device_id', $devices))
            ->get(['device_installations.device_id', 'device_adapter_candidates.device_adapter_id']);
        if ($installations->isEmpty()) {
            return [];
        }
        $adapters = DeviceAdapter::whereIn('id', $installations->pluck('device_adapter_id')->unique()->values())->get(['id', 'uuid', 'name', 'status', 'source', 'applied_revision_uuid'])->keyBy('id');
        $running = AdapterRevision::whereIn('uuid', $adapters->pluck('applied_revision_uuid')->filter()->unique()->values())->get(['uuid', 'definition'])->keyBy('uuid');
        $result = [];
        foreach ($installations as $installation) {
            $adapter = $adapters->get($installation->device_adapter_id);
            if (! $adapter) {
                continue;
            }
            $result[(int) $installation->device_id] = [
                'adapter_id' => (int) $adapter->id, 'uuid' => (string) $adapter->uuid, 'name' => (string) $adapter->name, 'status' => (string) $adapter->status,
                'poll_interval_seconds' => DeviceAdapter::pollInterval($running->get($adapter->applied_revision_uuid)?->definition, $adapter->source),
            ];
        }

        return $result;
    }

    /** The adapter behind one device, or null when no adapter feeds it. */
    public function adapter(Device $device): ?array
    {
        return $this->adapters([$device->id])[$device->id] ?? null;
    }

    /**
     * Effective settings, with the poll interval the runtime needs.
     *
     * @param  ?array{poll_interval_seconds: ?int}  $adapter  from adapters()
     * @return array{enabled: bool, style: string, offline_after_seconds: ?int, grace_seconds: int, severity: string, poll_interval_seconds: ?int}
     */
    public function effective(?array $adapter): array
    {
        return [...self::DEFAULTS, 'style' => $adapter ? 'connects_to_report' : self::DEFAULTS['style'], 'poll_interval_seconds' => $adapter['poll_interval_seconds'] ?? null];
    }

    /** Where each effective value comes from: the defaults, automatic, or the adapter lock. */
    public function inheritedFrom(?array $adapter): array
    {
        return ['enabled' => 'default', 'style' => $adapter ? 'adapter' : 'default', 'offline_after_seconds' => 'automatic', 'grace_seconds' => 'default', 'severity' => 'default'];
    }

    /**
     * What the runtime applies: the snapshot's `connectivity` (internal.control-state.v1),
     * without severity, which stays in the control plane.
     *
     * @return array{generation: int, enabled: bool, style: string, offline_after_seconds: ?int, poll_interval_seconds: ?int, grace_seconds: int}
     */
    public function runtime(?array $adapter): array
    {
        $effective = $this->effective($adapter);

        return ['generation' => self::GENERATION, 'enabled' => $effective['enabled'], 'style' => $effective['style'], 'offline_after_seconds' => $effective['offline_after_seconds'],
            'poll_interval_seconds' => $effective['poll_interval_seconds'], 'grace_seconds' => $effective['grace_seconds']];
    }

    /**
     * The device.connectivity-settings.v1 payload for a device. Pull request 3 writes it to
     * the outbox whenever the effective settings change.
     */
    public function message(Device $device): array
    {
        $device->loadMissing('organization:id,uuid');

        return ['organization_uuid' => (string) $device->organization->uuid, 'device_uuid' => (string) $device->uuid, ...$this->runtime($this->adapter($device))];
    }

    /** The severity offline alerts of the device carry. */
    public function severity(?Device $device): string
    {
        return self::DEFAULTS['severity'];
    }
}
