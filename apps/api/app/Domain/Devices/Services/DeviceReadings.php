<?php

declare(strict_types=1);

namespace App\Domain\Devices\Services;

use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Services\Moves\EarlierReadings;
use App\Domain\Devices\Services\Moves\JoinedReadings;
use App\Domain\Shared\Models\Organization;
use Carbon\CarbonImmutable;
use Illuminate\Validation\ValidationException;

/**
 * Reading a device's measurements from the runtime, shared by the portal's device
 * endpoints, agent tools (spec 004) and applications (spec 030), so all ask the runtime
 * the same way. Callers validate input and check access.
 *
 * Every history read here also serves a moved device's readings from before its move
 * when the mover shared them (spec 031 US6): Laravel asks the runtime once for the
 * device and once for its predecessor under the source, and joins the answers. Each
 * reading carries `recorded_in`: `self`, or `source` for the predecessor's.
 */
final class DeviceReadings
{
    /** How a records cursor marks the predecessor's pages: `earlier.<own records consumed>.<runtime cursor>`. */
    private const EARLIER_CURSOR = 'earlier.';

    public function __construct(private readonly RuntimeClient $runtime, private readonly RetentionService $retention) {}

    /** The latest reading of every parameter, with its quality. */
    public function latest(Organization $organization, Device $device): array
    {
        return self::forOwner($device, $this->runtime->request('GET', '/internal/measurements/latest', ['organization_uuid' => $organization->uuid, 'device_uuid' => $device->uuid, 'configuration_uuid' => $device->applied_configuration_uuid ?? $device->last_applied_configuration_uuid]));
    }

    /**
     * A runtime answer as the device's organization may see it: a hosted device's readings
     * keep their installation and serial but not the pipe owner's adapter revision (spec
     * 031, ADR-039).
     */
    public static function forOwner(Device $device, array $response): array
    {
        if (! (app(Pipes::class)->for($device)?->hosted ?? false)) {
            return $response;
        }
        $strip = function (mixed $value) use (&$strip): mixed {
            if (! is_array($value)) {
                return $value;
            }
            if (array_key_exists('adapter_revision_uuid', $value)) {
                $value['adapter_revision_uuid'] = null;
            }

            return array_map($strip, $value);
        };

        return $strip($response);
    }

    /**
     * Aggregated history: at observed time joining configuration revisions, or, for
     * applications, at receipt time with a series per configuration.
     *
     * @param  array{from: string, to: string, parameter_uuid: string, max_points?: int}  $values
     */
    public function history(Organization $organization, Device $device, array $values, bool $observed = true): array
    {
        // Portal charts place readings at observed time and join configuration
        // revisions; the integration SDK keeps its receipt-time, per-configuration contract.
        $basis = $observed ? ['time_basis' => 'observed', 'merge_configurations' => 1] : [];
        $days = $this->retention->effective($organization)['days'];
        $query = [...$values, ...$basis, 'organization_uuid' => $organization->uuid, 'device_uuid' => $device->uuid, 'retention_days' => $days];
        $earlier = $this->earlier($device, $values);
        if (! $earlier) {
            $own = $this->runtime->request('GET', '/internal/measurements/history', $query, RuntimeClient::RANGE_TIMEOUT);

            return [...$own, 'data' => JoinedReadings::series([], $own['data'] ?? [], $observed)];
        }
        // One bucket width for both answers, so their buckets meet at the same edges.
        $width = $earlier->bucketSeconds($values, $days);
        $own = $this->runtime->request('GET', '/internal/measurements/history', [...$query, 'bucket_seconds' => $width], RuntimeClient::RANGE_TIMEOUT);
        $before = $this->runtime->request('GET', '/internal/measurements/history', [...$earlier->query($values), ...$basis, 'bucket_seconds' => $width], RuntimeClient::RANGE_TIMEOUT);
        $series = JoinedReadings::series($before['data'] ?? [], $own['data'] ?? [], $observed, $width);
        // The runtime's own limit, over both answers.
        if (array_sum(array_map(fn (array $one): int => count($one['points']), $series)) > 2000) {
            throw ValidationException::withMessages(['runtime' => 'This range contains too many values or configuration changes. Choose a shorter range.']);
        }

        return [...$own, 'from' => self::earliest($before['from'] ?? null, $own['from'] ?? null), 'data' => $series];
    }

    /**
     * Stored readings, newest first, a page at a time. A moved device's pages continue
     * into its predecessor's readings once its own run out, under the same limit.
     *
     * @param  array{from: string, to: string, parameter_uuid: string, limit: int, page_size: int, cursor?: string}  $values
     */
    public function records(Organization $organization, Device $device, array $values): array
    {
        $values = [...$values, 'limit' => (int) $values['limit'], 'page_size' => (int) $values['page_size']];
        $query = [...$values, 'organization_uuid' => $organization->uuid, 'device_uuid' => $device->uuid, 'retention_days' => $this->retention->effective($organization)['days']];
        $earlier = $this->earlier($device, $values);
        $cursor = $values['cursor'] ?? '';
        if (str_starts_with($cursor, self::EARLIER_CURSOR)) {
            [, $consumed, $next] = array_pad(explode('.', $cursor, 3), 3, '');
            if (! ctype_digit($consumed) || (int) $consumed >= $values['limit']) {
                throw ValidationException::withMessages(['cursor' => 'This cursor is not valid. Load the records again.']);
            }
            // Sharing stopped between two pages: the predecessor's readings end here.
            if (! $earlier) {
                return ['data' => [], 'meta' => ['from' => $values['from'], 'to' => $values['to'], 'limit' => $values['limit'], 'page_size' => $values['page_size'],
                    'returned' => 0, 'consumed' => (int) $consumed, 'next_cursor' => null, 'has_more' => false, 'limit_reached' => false]];
            }

            return $this->earlierRecords($earlier, $values, (int) $consumed, $values['page_size'], $next);
        }
        $own = self::forOwner($device, $this->runtime->request('GET', '/internal/measurements/records', $query));
        $own['data'] = JoinedReadings::mark($own['data'] ?? [], JoinedReadings::SELF);
        $meta = $own['meta'] ?? [];
        $consumed = (int) ($meta['consumed'] ?? 0);
        if (! $earlier || ($meta['next_cursor'] ?? null) !== null || ($meta['limit_reached'] ?? false) || $consumed >= $values['limit']) {
            return $own;
        }
        $room = $values['page_size'] - count($own['data']);
        $before = $this->earlierRecords($earlier, $values, $consumed, max(1, $room), '');
        if ($room < 1) {
            // This page is full: the predecessor's readings start on the next one, if it has any.
            $more = $before['data'] !== [];

            return [...$own, 'meta' => [...$meta, 'from' => $before['meta']['from'], 'next_cursor' => $more ? self::EARLIER_CURSOR.$consumed.'.' : null, 'has_more' => $more]];
        }

        return ['data' => [...$own['data'], ...$before['data']], 'meta' => [...$before['meta'], 'to' => $meta['to'] ?? $values['to'], 'returned' => count($own['data']) + count($before['data'])]];
    }

    /**
     * A page of the predecessor's records, after `$consumed` of the device's own, with a
     * cursor that continues them.
     *
     * @param  array<string, mixed>  $values
     */
    private function earlierRecords(EarlierReadings $earlier, array $values, int $consumed, int $pageSize, string $cursor): array
    {
        $result = $this->runtime->request('GET', '/internal/measurements/records', [...$earlier->query(array_diff_key($values, ['cursor' => true])),
            'limit' => $values['limit'] - $consumed, 'page_size' => $pageSize, ...($cursor === '' ? [] : ['cursor' => $cursor])]);
        $meta = $result['meta'] ?? [];
        $next = $meta['next_cursor'] ?? null;

        return ['data' => JoinedReadings::earlierRecords($result['data'] ?? [], $values['parameter_uuid']), 'meta' => [...$meta,
            'limit' => $values['limit'], 'page_size' => $values['page_size'], 'consumed' => $consumed + (int) ($meta['consumed'] ?? 0),
            'next_cursor' => $next === null ? null : self::EARLIER_CURSOR.$consumed.'.'.$next]];
    }

    /**
     * The predecessor's side of a moved device's history, when the requested range reaches
     * before the cutover within the source's retention.
     *
     * @param  array{from: string, to: string, parameter_uuid: string}  $values
     */
    private function earlier(Device $device, array $values): ?EarlierReadings
    {
        $earlier = EarlierReadings::for($device, $values['parameter_uuid']);

        return $earlier?->window($values) ? $earlier : null;
    }

    private static function earliest(?string $first, ?string $second): ?string
    {
        if ($first === null || $second === null) {
            return $first ?? $second;
        }

        return CarbonImmutable::parse($first)->lessThan(CarbonImmutable::parse($second)) ? $first : $second;
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

        $query = [...$values, 'organization_uuid' => $organization->uuid, 'device_uuid' => $device->uuid, 'retention_days' => $this->retention->effective($organization)['days']];
        $earlier = $this->earlier($device, $values);
        if (! $earlier) {
            $own = $this->runtime->request('GET', '/internal/measurements/state-history', $query, RuntimeClient::RANGE_TIMEOUT);

            return [...$own, 'data' => [...$own['data'], 'timeline' => JoinedReadings::mark($own['data']['timeline'] ?? [], JoinedReadings::SELF)]];
        }
        // The device's own timeline starts at the cutover, the predecessor's ends there; the
        // segments are shared between them by the time each covers.
        $values['max_points'] = (int) $values['max_points'];
        $window = $earlier->window($values);
        $to = CarbonImmutable::parse($values['to'])->min(CarbonImmutable::now());
        $from = CarbonImmutable::parse($values['from'])->max($earlier->cutover);
        $share = $window['to']->diffInMilliseconds($window['from'], true) / max(1, $to->diffInMilliseconds($window['from'], true));
        $points = $from->lessThan($to) ? max(10, min($values['max_points'] - 10, (int) round($values['max_points'] * $share))) : $values['max_points'];
        $before = $this->runtime->request('GET', '/internal/measurements/state-history', [...$earlier->query($values), 'max_points' => $points], RuntimeClient::RANGE_TIMEOUT);
        $own = $from->lessThan($to) ? $this->runtime->request('GET', '/internal/measurements/state-history', [...$query, 'from' => $from->toJSON(), 'max_points' => max(10, $values['max_points'] - $points)], RuntimeClient::RANGE_TIMEOUT) : null;

        return ['data' => JoinedReadings::stateHistory($before['data'], $own['data'] ?? null)];
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

        $query = [...$values, 'organization_uuid' => $organization->uuid, 'device_uuid' => $device->uuid,
            'rollover_at' => $counter['rollover_at'] ?? null,
            'retention_days' => $this->retention->effective($organization)['days']];
        $own = $this->runtime->request('GET', '/internal/measurements/increase', $query, RuntimeClient::RANGE_TIMEOUT);
        $earlier = $this->earlier($device, $values);
        if (! $earlier) {
            return [...$own, 'data' => [...$own['data'], 'points' => JoinedReadings::mark($own['data']['points'] ?? [], JoinedReadings::SELF)]];
        }
        // The copied profile keeps the counter's settings, so the predecessor rolls over alike.
        $before = $this->runtime->request('GET', '/internal/measurements/increase', [...$earlier->query($values), 'rollover_at' => $query['rollover_at']], RuntimeClient::RANGE_TIMEOUT);

        return ['data' => JoinedReadings::increase($before['data'], $own['data'])];
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
