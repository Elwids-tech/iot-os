<?php

declare(strict_types=1);

namespace App\Domain\Devices\Services;

use App\Domain\Devices\Models\Device;
use App\Domain\Shared\Models\Organization;
use Illuminate\Validation\ValidationException;

/**
 * Reading a device's measurements from the runtime, shared by the portal's device
 * endpoints and agent tools (spec 004), so both ask the runtime the same way. Callers
 * validate input and check Device.view.
 */
final class DeviceReadings
{
    public function __construct(private readonly RuntimeClient $runtime, private readonly RetentionService $retention) {}

    /** The latest reading of every parameter, with its quality. */
    public function latest(Organization $organization, Device $device): array
    {
        return $this->runtime->request('GET', '/internal/measurements/latest', ['organization_uuid' => $organization->uuid, 'device_uuid' => $device->uuid, 'configuration_uuid' => $device->applied_configuration_uuid ?? $device->last_applied_configuration_uuid]);
    }

    /**
     * History at observed time, joining configuration revisions.
     *
     * @param  array{from: string, to: string, parameter_uuid: string, max_points?: int}  $values
     */
    public function history(Organization $organization, Device $device, array $values): array
    {
        // Portal charts place readings at observed time and join configuration
        // revisions; the integration SDK keeps its receipt-time, per-configuration contract.
        return $this->runtime->request('GET', '/internal/measurements/history', [...$values, 'time_basis' => 'observed', 'merge_configurations' => 1, 'organization_uuid' => $organization->uuid, 'device_uuid' => $device->uuid, 'retention_days' => $this->retention->effective($organization)['days']], RuntimeClient::RANGE_TIMEOUT);
    }

    /**
     * Durations and transitions of a boolean, enum or colour parameter.
     *
     * @param  array{from: string, to: string, parameter_uuid: string, max_points: int}  $values
     */
    public function stateHistory(Organization $organization, Device $device, array $values): array
    {
        if (! $this->supportsStateHistory($device, $values['parameter_uuid'])) {
            throw ValidationException::withMessages([
                'parameter_uuid' => 'Choose a boolean, enum, or colour-compatible string parameter from a device configuration.',
            ]);
        }

        return $this->runtime->request('GET', '/internal/measurements/state-history', [...$values, 'organization_uuid' => $organization->uuid, 'device_uuid' => $device->uuid, 'retention_days' => $this->retention->effective($organization)['days']], RuntimeClient::RANGE_TIMEOUT);
    }

    /**
     * A counter's increase per calendar bucket, cut in the given (or the device's reporting) time zone.
     *
     * @param  array{from: string, to: string, parameter_uuid: string, bucket: string, timezone?: string}  $values
     */
    public function increase(Organization $organization, Device $device, array $values): array
    {
        $values['timezone'] ??= $device->reportingTimezone();
        $counter = $this->counterParameter($device, $values['parameter_uuid']);
        if ($counter === null) {
            throw ValidationException::withMessages([
                'parameter_uuid' => 'Choose a counter parameter from a device configuration.',
            ]);
        }

        return $this->runtime->request('GET', '/internal/measurements/increase', [...$values,
            'organization_uuid' => $organization->uuid, 'device_uuid' => $device->uuid,
            'rollover_at' => $counter['rollover_at'] ?? null,
            'retention_days' => $this->retention->effective($organization)['days']], RuntimeClient::RANGE_TIMEOUT);
    }

    /** The counter settings from the newest configuration that defines the parameter as a counter. */
    private function counterParameter(Device $device, string $parameterUuid): ?array
    {
        foreach ($device->configurations()->latest('id')->get() as $configuration) {
            $canonical = $configuration->definition['profile_canonical_json'] ?? [];
            $profile = is_string($canonical) ? json_decode($canonical, true) : $canonical;
            $parameter = collect(is_array($profile) ? ($profile['parameters'] ?? []) : [])->firstWhere('uuid', $parameterUuid);
            if ($parameter && ($parameter['kind'] ?? null) === 'counter' && in_array($parameter['data_type'] ?? null, ['integer', 'number'], true)) {
                return is_array($parameter['counter'] ?? null) ? $parameter['counter'] : [];
            }
        }

        return null;
    }

    private function supportsStateHistory(Device $device, string $parameterUuid): bool
    {
        return $device->configurations()->get()->contains(function ($configuration) use ($parameterUuid): bool {
            $canonical = $configuration->definition['profile_canonical_json'] ?? [];
            $profile = is_string($canonical) ? json_decode($canonical, true) : $canonical;
            $parameter = collect(is_array($profile) ? ($profile['parameters'] ?? []) : [])->firstWhere('uuid', $parameterUuid);
            if (! $parameter) {
                return false;
            }
            if (in_array($parameter['data_type'] ?? null, ['boolean', 'enum'], true)) {
                return true;
            }

            return ($parameter['data_type'] ?? null) === 'string'
                && (($parameter['format'] ?? null) === 'hex_color' || data_get($parameter, 'display.widget') === 'color');
        });
    }
}
