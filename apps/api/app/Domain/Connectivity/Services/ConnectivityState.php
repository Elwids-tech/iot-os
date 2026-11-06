<?php

declare(strict_types=1);

namespace App\Domain\Connectivity\Services;

use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Services\RuntimeClient;
use App\Domain\Shared\Models\Organization;
use Carbon\CarbonImmutable;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * What the runtime's connectivity tracker knows about a device (spec 018, D14), read
 * from its internal GET /internal/connectivity on demand.
 */
final class ConnectivityState
{
    /** The fields the runtime reports per device, besides its state. */
    public const FIELDS = ['monitoring_since', 'last_heard_at', 'last_observed_at', 'anchor_at', 'reporting_interval_seconds', 'readings_counted', 'poll_interval_seconds', 'offline_after_seconds', 'offline_after_automatic', 'suppressed_by_gateway', 'interruption'];

    public const STATES = ['waiting', 'learning', 'monitored', 'pending', 'offline', 'recovering', 'interrupted', 'disabled'];

    public function __construct(private readonly RuntimeClient $runtime) {}

    /**
     * The tracker's state of the device: `inactive` without asking the runtime when the
     * device is not active, `unknown` when the runtime cannot say. `before_monitoring`
     * marks a device last heard before its monitoring began (FR-030).
     *
     * @return array{state: string, monitoring_since: ?string, last_heard_at: ?string, last_observed_at: ?string, anchor_at: ?string, reporting_interval_seconds: ?int, readings_counted: ?int, poll_interval_seconds: ?int, offline_after_seconds: ?int, offline_after_automatic: ?bool, suppressed_by_gateway: ?bool, interruption: ?string, before_monitoring: bool}
     */
    public function of(Organization $organization, Device $device): array
    {
        $empty = array_fill_keys(self::FIELDS, null);
        if ($device->lifecycle !== 'active' || ! $device->applied_configuration_uuid) {
            return ['state' => 'inactive', ...$empty, 'before_monitoring' => false];
        }
        try {
            $reported = collect($this->runtime->request('GET', '/internal/connectivity', ['organization' => $organization->uuid, 'devices' => $device->uuid])['devices'] ?? [])
                ->first(fn ($entry) => is_array($entry) && ($entry['device_uuid'] ?? null) === $device->uuid);
        } catch (HttpException|ValidationException) {
            $reported = null;
        }
        if (! $reported || ! in_array($reported['state'] ?? null, self::STATES, true)) {
            return ['state' => 'unknown', ...$empty, 'before_monitoring' => false];
        }
        $state = ['state' => $reported['state'], ...array_intersect_key(array_replace($empty, $reported), $empty)];
        $since = $state['monitoring_since'] ? CarbonImmutable::parse($state['monitoring_since']) : null;
        $state['before_monitoring'] = $state['state'] === 'waiting' && $since !== null && $device->last_seen_at !== null && $device->last_seen_at->lt($since);

        return $state;
    }
}
