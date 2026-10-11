<?php
declare(strict_types=1);

namespace App\Domain\Integrations\Http;

use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Services\{RuntimeClient, RetentionService};
use App\Domain\Shared\Models\Organization;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Validation\ValidationException;

final class TelemetryController
{
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
            'data' => array_map(fn (array $reading) => Arr::only($reading, [
                'parameter_uuid', 'key', 'label', 'data_type', 'unit', 'value', 'quality',
                'observed_at', 'received_at', 'last_valid_received_at', 'timestamp_source', 'historical',
            ]), $result['data'] ?? [])];
    }

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
