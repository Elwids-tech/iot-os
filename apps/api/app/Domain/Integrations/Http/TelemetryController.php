<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Http;

use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Services\DeviceView;
use App\Domain\Devices\Services\RetentionService;
use App\Domain\Devices\Services\RuntimeClient;
use App\Domain\Shared\Models\Organization;
use Carbon\CarbonImmutable;
use Dedoc\Scramble\Attributes\QueryParameter;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Validation\ValidationException;

final class TelemetryController
{
    /**
     * The fields of a retained reading the latest reads pass through (`telemetry-latest.v1`).
     */
    private const READING_FIELDS = [
        'parameter_uuid', 'key', 'label', 'data_type', 'unit', 'value', 'quality',
        'observed_at', 'received_at', 'last_valid_received_at', 'timestamp_source', 'historical',
    ];

    private function device(Request $request, Organization $organization, string $uuid): Device
    {
        return Device::where('organization_id', $organization->id)
            ->whereIn('uuid', $request->attributes->get('integration_application')->device_uuids)
            ->where('uuid', $uuid)->firstOrFail();
    }

    public function latest(Request $request, Organization $organization, string $uuid): array
    {
        $device = $this->device($request, $organization, $uuid);
        $configuration = $device->applied_configuration_uuid ?? $device->last_applied_configuration_uuid;
        $result = app(RuntimeClient::class)->request('GET', '/internal/measurements/latest', [
            'organization_uuid' => $organization->uuid, 'device_uuid' => $device->uuid,
            'configuration_uuid' => $configuration,
        ]);

        return ['schema_version' => 'telemetry-latest.v1', 'device_uuid' => $device->uuid,
            'configuration_uuid' => $result['configuration_uuid'] ?? $configuration,
            'presence' => $result['presence'] ?? 'unknown',
            'data' => array_map(fn (array $reading) => Arr::only($reading, self::READING_FIELDS), $result['data'] ?? [])];
    }

    /**
     * One snapshot of a plant: the latest values of up to 100 granted devices from one
     * runtime request, each with the device read's presence and last-seen time
     * (spec 030, `telemetry-latest-batch.v1`).
     */
    public function latestBatch(Request $request, Organization $organization): array
    {
        $values = $request->validate([
            'device_uuids' => ['required', 'array', 'min:1', 'max:100'],
            'device_uuids.*' => ['uuid', 'distinct'],
        ]);
        $uuids = array_values($values['device_uuids']);
        // PR 030-1 replaces this inline grant check with the ApplicationGrant resolver.
        $devices = Device::where('organization_id', $organization->id)
            ->whereIn('uuid', $request->attributes->get('integration_application')->device_uuids)
            ->whereIn('uuid', $uuids)->get()->keyBy('uuid');
        // A device outside the grant refuses the whole request and reveals nothing (FR-002).
        abort_if($devices->count() !== count($uuids), 404);
        $result = app(RuntimeClient::class)->request('GET', '/internal/measurements/latest-batch', [
            'organization_uuid' => $organization->uuid, 'devices' => implode(',', $uuids),
        ]);

        return ['schema_version' => 'telemetry-latest-batch.v1', 'data' => array_map(function (string $uuid) use ($devices, $result): array {
            $device = $devices[$uuid];
            $entry = $result['data'][$uuid] ?? [];

            return ['device_uuid' => $uuid,
                'configuration_uuid' => $entry['configuration_uuid'] ?? $device->applied_configuration_uuid ?? $device->last_applied_configuration_uuid,
                'presence' => DeviceView::presence($device), 'last_seen_at' => $device->last_seen_at,
                'readings' => array_map(fn (array $reading) => Arr::only($reading, self::READING_FIELDS), $entry['data'] ?? [])];
        }, $uuids)];
    }

    // Scramble does not read the rules in window(); these describe them in the public
    // contract (contracts/openapi). Keep them in step with window().
    #[QueryParameter('parameter_uuid', description: 'The parameter to read.', required: true, type: 'string', format: 'uuid')]
    #[QueryParameter('from', description: 'Start of the window: RFC 3339 with seconds and `Z` or a `±hh:mm` offset.', required: true, type: 'string', format: 'date-time')]
    #[QueryParameter('to', description: 'End of the window, after `from` and at most 31 days later: RFC 3339 with seconds and `Z` or a `±hh:mm` offset.', required: true, type: 'string', format: 'date-time')]
    public function records(Request $request, Organization $organization, string $uuid): array
    {
        $device = $this->device($request, $organization, $uuid);
        $values = $this->window($request);
        $values += $request->validate([
            'limit' => ['sometimes', 'integer', 'min:1', 'max:5000'],
            'page_size' => ['sometimes', 'integer', 'min:1', 'max:100'],
            'cursor' => ['sometimes', 'string', 'max:512'],
        ]);
        $result = app(RuntimeClient::class)->request('GET', '/internal/measurements/records', [
            ...$values, 'limit' => $values['limit'] ?? 500, 'page_size' => $values['page_size'] ?? 50,
            'organization_uuid' => $organization->uuid, 'device_uuid' => $device->uuid,
            'retention_days' => app(RetentionService::class)->effective($organization)['days'],
        ]);

        return ['schema_version' => 'telemetry-records.v1', 'device_uuid' => $device->uuid,
            'parameter_uuid' => $values['parameter_uuid'],
            'data' => array_map(fn (array $row) => Arr::only($row, [
                'event_uuid', 'configuration_uuid', 'parameter_uuid', 'received_at', 'observed_at',
                'data_type', 'unit', 'value', 'quality', 'timestamp_source', 'historical',
            ]), $result['data']),
            'meta' => Arr::only($result['meta'], ['from', 'to', 'limit', 'page_size', 'returned', 'consumed', 'next_cursor', 'has_more', 'limit_reached'])];
    }

    private function window(Request $request): array
    {
        $values = $request->validate([
            'parameter_uuid' => ['required', 'uuid'],
            'from' => ['required', 'date', 'regex:/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/'],
            'to' => ['required', 'date', 'regex:/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/', 'after:from'],
        ]);
        if (CarbonImmutable::parse($values['from'])->diffInSeconds(CarbonImmutable::parse($values['to'])) > 31 * 86400) {
            throw ValidationException::withMessages(['to' => 'Use a history window of at most 31 days.']);
        }

        return $values;
    }

    // Scramble does not read the rules in window(); these describe them in the public
    // contract (contracts/openapi). Keep them in step with window().
    #[QueryParameter('parameter_uuid', description: 'The parameter to read.', required: true, type: 'string', format: 'uuid')]
    #[QueryParameter('from', description: 'Start of the window: RFC 3339 with seconds and `Z` or a `±hh:mm` offset.', required: true, type: 'string', format: 'date-time')]
    #[QueryParameter('to', description: 'End of the window, after `from` and at most 31 days later: RFC 3339 with seconds and `Z` or a `±hh:mm` offset.', required: true, type: 'string', format: 'date-time')]
    public function history(Request $request, Organization $organization, string $uuid): array
    {
        $device = $this->device($request, $organization, $uuid);
        $values = $this->window($request) + $request->validate(['max_points' => ['sometimes', 'integer', 'min:10', 'max:1000']]);
        $retention = app(RetentionService::class)->effective($organization)['days'];
        $result = app(RuntimeClient::class)->request('GET', '/internal/measurements/history', [
            ...$values, 'max_points' => $values['max_points'] ?? 500,
            'organization_uuid' => $organization->uuid, 'device_uuid' => $device->uuid, 'retention_days' => $retention,
        ], RuntimeClient::RANGE_TIMEOUT);

        return ['schema_version' => 'telemetry-history.v1', 'device_uuid' => $device->uuid,
            'parameter_uuid' => $values['parameter_uuid'], 'retention_days' => $retention,
            'from' => $result['from'] ?? null, 'to' => $result['to'] ?? null,
            'data' => array_map(fn (array $series) => [
                ...Arr::only($series, ['configuration_uuid', 'unit', 'data_type']),
                'points' => array_map(fn (array $point) => Arr::only($point, ['at', 'value', 'min', 'max', 'count']), $series['points']),
            ], $result['data'] ?? [])];
    }
}
