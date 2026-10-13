<?php

declare(strict_types=1);

namespace App\Domain\Devices\Services;

use App\Domain\DeviceAdapters\Models\AdapterRevision;
use App\Domain\DeviceAdapters\Models\DeviceAdapter;
use App\Domain\DeviceAdapters\Models\DeviceInstallation;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceConfiguration;

/**
 * Why a device is or is not delivering data, from facts the platform already holds
 * (spec 004 FR-022). It never starts captures, validates or tests. A fact it cannot
 * establish is "unknown", never "ok" (constitution VI).
 */
final class IngestionDiagnostics
{
    /** Diagnostic texts the runtime writes when a source must be reviewed before control resumes. */
    private const REVIEW_TEXTS = ['Source changed', 'A source birth changed approved metrics'];

    /**
     * @param  array{data?: list<array<string, mixed>>}|null  $latest  the runtime's latest readings, or null when unavailable
     * @return list<array{check: string, status: 'ok'|'problem'|'unknown', detail: string}>
     */
    public function device(Device $device, ?array $latest, ?string $latestError = null): array
    {
        $device->loadMissing(['candidate.gateway', 'appliedConfiguration', 'lastAppliedConfiguration']);
        $configuration = $device->appliedConfiguration ?? $device->lastAppliedConfiguration;
        $checks = [
            $this->lifecycle($device),
            $this->deployment($device),
            $this->source($device),
            $this->lastReading($device),
            $this->review($device, $configuration),
            $this->unmapped($device, $configuration),
            $this->readings($latest, $latestError),
        ];
        $adapter = $this->adapterFor($device);
        if ($adapter !== null) {
            array_push($checks, ...$this->adapter($adapter));
        }

        return $checks;
    }

    /** @return list<array{check: string, status: string, detail: string}> */
    public function adapter(DeviceAdapter $adapter): array
    {
        $health = is_array($adapter->health) ? $adapter->health : [];
        $applied = $adapter->applied_revision_uuid ? AdapterRevision::where('uuid', $adapter->applied_revision_uuid)->first() : null;
        $test = $applied?->test_result;

        return [
            $this->check('adapter_status', match ($adapter->status) {
                'running' => 'ok',
                'failed' => 'problem',
                default => 'unknown',
            }, "Adapter \"{$adapter->name}\" is {$adapter->status}".($adapter->diagnostic ? ": {$adapter->diagnostic}" : '.')),
            $this->check('adapter_connectivity', match (true) {
                ! array_key_exists('source_connected', $health) => 'unknown',
                $health['source_connected'] === true && ($health['upstream_connected'] ?? true) === true => 'ok',
                default => 'problem',
            }, 'Source broker '.$this->flag($health['source_connected'] ?? null).', platform '.$this->flag($health['upstream_connected'] ?? null)
                .(isset($health['last_message_at']) ? ", last message {$health['last_message_at']}." : ', no message recorded.')),
            $this->check('decoder_tests', match (true) {
                $applied === null => 'unknown',
                ! is_array($test) => 'unknown',
                ($test['valid'] ?? null) === true => 'ok',
                default => 'problem',
            }, $applied === null ? 'No decoder revision is deployed.' : 'Decoder revision '.$applied->revision.' fixture tests: '.(is_array($test) ? (($test['valid'] ?? false) ? 'passed.' : 'failed.') : 'not run.')),
        ];
    }

    private function lifecycle(Device $device): array
    {
        return match ($device->lifecycle) {
            'active' => $this->check('lifecycle', 'ok', 'The device is active.'),
            'registered' => $this->check('lifecycle', 'problem', 'The device is registered but was never activated. Finish its configuration and activate it in the portal.'),
            'deactivated' => $this->check('lifecycle', 'problem', 'The device is deactivated, so nothing it sends is stored.'),
            default => $this->check('lifecycle', 'problem', "The device is {$device->lifecycle}."),
        };
    }

    private function deployment(Device $device): array
    {
        return match ($device->deployment_status) {
            'applied' => $this->check('configuration', 'ok', 'The runtime applied the current configuration.'),
            'pending' => $this->check('configuration', 'unknown', 'The runtime has not yet confirmed the requested configuration.'),
            'failed' => $this->check('configuration', 'problem', 'The runtime rejected the configuration'.($device->diagnostic ? ": {$device->diagnostic}" : '.').' The previous configuration stays applied.'),
            default => $this->check('configuration', $device->lifecycle === 'active' ? 'unknown' : 'problem', "Configuration state: {$device->deployment_status}."),
        };
    }

    private function source(Device $device): array
    {
        $candidate = $device->candidate;
        if ($candidate === null) {
            return $this->check('source', $this->adapterFor($device) ? 'unknown' : 'problem', $this->adapterFor($device)
                ? 'The device receives data through an adapter; see the adapter checks.'
                : 'No source is assigned to the device.');
        }
        $gateway = $candidate->gateway;
        $status = match ($candidate->presence) {
            'online' => 'ok',
            'offline' => 'problem',
            default => 'unknown',
        };

        return $this->check('source', $status, "Source \"{$candidate->source_device_id}\" is {$candidate->presence}"
            .($candidate->last_seen_at ? ", last seen {$candidate->last_seen_at->toIso8601String()}" : ', never seen')
            .($gateway ? '; gateway "'.$gateway->name.'" is '.DeviceView::gateway($gateway)['presence'].'.' : '.'));
    }

    private function lastReading(Device $device): array
    {
        if ($device->last_seen_at === null) {
            return $this->check('last_reading', 'problem', 'No reading has ever arrived.');
        }
        $minutes = (int) $device->last_seen_at->diffInMinutes(now());

        return $minutes > 60
            ? $this->check('last_reading', 'problem', "The last reading arrived {$minutes} minutes ago ({$device->last_seen_at->toIso8601String()}).")
            : $this->check('last_reading', 'ok', "The last reading arrived {$minutes} minutes ago.");
    }

    private function review(Device $device, ?DeviceConfiguration $configuration): array
    {
        foreach (self::REVIEW_TEXTS as $text) {
            if (str_contains((string) $device->diagnostic, $text)) {
                return $this->check('review_required', 'problem', "The source changed and its mapping must be reviewed and activated again in the portal: {$device->diagnostic}");
            }
        }
        $applied = $configuration?->definition['birth_revision'] ?? null;
        $announced = $device->candidate?->birth_revision;
        if ($applied === null || $announced === null) {
            return $this->check('review_required', 'unknown', 'There is no applied Sparkplug mapping to compare with the source.');
        }

        return (int) $applied === (int) $announced
            ? $this->check('review_required', 'ok', 'The source announces the metrics the configuration was approved for.')
            : $this->check('review_required', 'problem', "The source now announces different metrics (birth revision {$announced}, configuration approved for {$applied}). Review the mapping in the portal.");
    }

    private function unmapped(Device $device, ?DeviceConfiguration $configuration): array
    {
        $announced = collect($device->candidate?->metrics ?? [])->pluck('name')->filter()->unique();
        if ($announced->isEmpty() || $configuration === null) {
            return $this->check('unmapped_metrics', 'unknown', 'There is no announced metric list and applied mapping to compare.');
        }
        $mapped = collect($configuration->definition['mappings'] ?? [])->flatMap(fn (array $mapping) => array_filter([$mapping['metric'] ?? null, $mapping['command_metric'] ?? null]));
        $missing = $announced->diff($mapped)->values();

        return $missing->isEmpty()
            ? $this->check('unmapped_metrics', 'ok', 'Every announced metric is mapped.')
            : $this->check('unmapped_metrics', 'problem', $missing->count().' announced metrics are not mapped, so they are not stored: '.$missing->take(20)->implode(', ').($missing->count() > 20 ? ', …' : '').'.');
    }

    /** @param array{data?: list<array<string, mixed>>}|null $latest */
    private function readings(?array $latest, ?string $error): array
    {
        if ($latest === null) {
            return $this->check('reading_quality', 'unknown', 'Live readings are unavailable'.($error ? ": {$error}" : '.'));
        }
        $readings = collect($latest['data'] ?? []);
        if ($readings->isEmpty()) {
            return $this->check('reading_quality', 'unknown', 'The runtime holds no readings for this device.');
        }
        $bad = $readings->reject(fn (array $reading) => ($reading['quality'] ?? null) === 'good');

        return $bad->isEmpty()
            ? $this->check('reading_quality', 'ok', 'All '.$readings->count().' parameters have good current readings.')
            : $this->check('reading_quality', 'problem', $bad->count().' of '.$readings->count().' parameters are not good: '
                .$bad->take(20)->map(fn (array $reading) => ($reading['label'] ?? $reading['key'] ?? 'parameter').' is '.($reading['quality'] ?? 'unknown').(isset($reading['diagnostic']) && $reading['diagnostic'] !== '' ? " ({$reading['diagnostic']})" : ''))->implode('; ').'.');
    }

    private function adapterFor(Device $device): ?DeviceAdapter
    {
        $installation = DeviceInstallation::where('device_id', $device->id)->whereNull('ended_at')->latest('started_at')->first();
        $revision = $installation?->adapter_revision_uuid ? AdapterRevision::where('uuid', $installation->adapter_revision_uuid)->first() : null;

        return $revision?->adapter;
    }

    private function flag(mixed $value): string
    {
        return match ($value) {
            true => 'connected',
            false => 'disconnected',
            default => 'unknown',
        };
    }

    /** @return array{check: string, status: string, detail: string} */
    private function check(string $check, string $status, string $detail): array
    {
        return ['check' => $check, 'status' => $status, 'detail' => $detail];
    }
}
