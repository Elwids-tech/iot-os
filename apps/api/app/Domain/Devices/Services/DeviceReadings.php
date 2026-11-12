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
 * (spec 031 US6, ADR-040, ADR-041): its predecessor's whole history when the mover
 * shared it, earlier moves included, and those of any earlier predecessor in its own
 * organization, each under the organization it was recorded in. Laravel asks the runtime
 * once for the device and once for each earlier part, and joins the answers, oldest
 * first. Each reading carries `recorded_in`: `self`, or `source` for readings recorded
 * in another organization.
 */
final class DeviceReadings
{
    /**
     * How a records cursor marks the pages from before the move:
     * `earlier.<records consumed before the part>.<the part's hops>.<runtime cursor>`.
     */
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
        $parts = $this->earlier($device, $values);
        if ($parts === []) {
            $own = $this->runtime->request('GET', '/internal/measurements/history', $query, RuntimeClient::RANGE_TIMEOUT);

            return [...$own, 'data' => JoinedReadings::series([], $own['data'] ?? [], $observed)];
        }
        // One bucket width for every answer, so their buckets meet at the same edges.
        $width = EarlierReadings::bucketSeconds($parts, $values, $days);
        $own = $this->runtime->request('GET', '/internal/measurements/history', [...$query, 'bucket_seconds' => $width], RuntimeClient::RANGE_TIMEOUT);
        $before = array_map(fn (EarlierReadings $part): array => ['recorded_in' => $part->recordedIn,
            'answer' => $this->runtime->request('GET', '/internal/measurements/history', [...$part->query($values), ...$basis, 'bucket_seconds' => $width], RuntimeClient::RANGE_TIMEOUT)], $parts);
        $series = JoinedReadings::series(array_map(fn (array $part): array => ['recorded_in' => $part['recorded_in'], 'data' => $part['answer']['data'] ?? []], $before), $own['data'] ?? [], $observed, $width);
        // The runtime's own limit, over every answer.
        if (array_sum(array_map(fn (array $one): int => count($one['points']), $series)) > 2000) {
            throw ValidationException::withMessages(['runtime' => 'This range contains too many values or configuration changes. Choose a shorter range.']);
        }
        $from = $own['from'] ?? null;
        foreach ($before as $part) {
            $from = self::earliest($part['answer']['from'] ?? null, $from);
        }

        return [...$own, 'from' => $from, 'data' => $series];
    }

    /**
     * Stored readings, newest first, a page at a time. A moved device's pages continue
     * into the readings from before its move once its own run out, newest part first,
     * under the same limit.
     *
     * @param  array{from: string, to: string, parameter_uuid: string, limit: int, page_size: int, cursor?: string}  $values
     */
    public function records(Organization $organization, Device $device, array $values): array
    {
        $values = [...$values, 'limit' => (int) $values['limit'], 'page_size' => (int) $values['page_size']];
        $query = [...$values, 'organization_uuid' => $organization->uuid, 'device_uuid' => $device->uuid, 'retention_days' => $this->retention->effective($organization)['days']];
        $parts = array_reverse($this->earlier($device, $values));
        $cursor = $values['cursor'] ?? '';
        if (str_starts_with($cursor, self::EARLIER_CURSOR)) {
            [, $consumed, $hops, $next] = array_pad(explode('.', $cursor, 4), 4, '');
            if (! ctype_digit($consumed) || (int) $consumed >= $values['limit'] || ! ctype_digit($hops)) {
                throw ValidationException::withMessages(['cursor' => 'This cursor is not valid. Load the records again.']);
            }
            // The part the cursor reads and the older ones. Sharing stopped between two pages
            // ends the predecessor's readings there; the device's own organization's go on.
            $rest = array_values(array_filter($parts, fn (EarlierReadings $part): bool => $part->hops >= (int) $hops));
            if ($rest === []) {
                return ['data' => [], 'meta' => ['from' => $values['from'], 'to' => $values['to'], 'limit' => $values['limit'], 'page_size' => $values['page_size'],
                    'returned' => 0, 'consumed' => (int) $consumed, 'next_cursor' => null, 'has_more' => false, 'limit_reached' => false]];
            }

            return $this->earlierRecords($rest, $values, (int) $consumed, $values['page_size'], $rest[0]->hops === (int) $hops ? $next : '');
        }
        $own = self::forOwner($device, $this->runtime->request('GET', '/internal/measurements/records', $query));
        $own['data'] = JoinedReadings::mark($own['data'] ?? [], JoinedReadings::SELF);
        $meta = $own['meta'] ?? [];
        $consumed = (int) ($meta['consumed'] ?? 0);
        if ($parts === [] || ($meta['next_cursor'] ?? null) !== null || ($meta['limit_reached'] ?? false) || $consumed >= $values['limit']) {
            return $own;
        }
        $room = $values['page_size'] - count($own['data']);
        if ($room < 1) {
            // This page is full: the readings from before start on the next one, if there are any.
            $first = $this->firstEarlier($parts, $values, $consumed);

            return [...$own, 'meta' => [...$meta, 'from' => $first['meta']['from'] ?? $meta['from'] ?? $values['from'],
                'next_cursor' => $first ? self::EARLIER_CURSOR.$consumed.'.'.$parts[0]->hops.'.' : null, 'has_more' => $first !== null]];
        }
        $before = $this->earlierRecords($parts, $values, $consumed, $room, '');

        return ['data' => [...$own['data'], ...$before['data']], 'meta' => [...$before['meta'], 'to' => $meta['to'] ?? $values['to'], 'returned' => count($own['data']) + count($before['data'])]];
    }

    /**
     * A page of the readings from before the move, after `$consumed` records: each part in
     * turn, newest first, from `$cursor` in the first, with a cursor that continues them.
     *
     * @param  non-empty-list<EarlierReadings>  $parts  newest first
     * @param  array<string, mixed>  $values
     */
    private function earlierRecords(array $parts, array $values, int $consumed, int $pageSize, string $cursor): array
    {
        $data = [];
        $meta = [];
        foreach ($parts as $i => $part) {
            if (count($data) >= $pageSize) {
                // This page is full: the next one starts with this part, if any part left has readings.
                $first = $this->firstEarlier(array_slice($parts, $i), $values, $consumed);
                $meta = [...$meta, 'next_cursor' => $first ? self::EARLIER_CURSOR.$consumed.'.'.$part->hops.'.' : null, 'has_more' => $first !== null];
                break;
            }
            $result = $this->runtime->request('GET', '/internal/measurements/records', [...$part->query(array_diff_key($values, ['cursor' => true])),
                'limit' => $values['limit'] - $consumed, 'page_size' => $pageSize - count($data), ...($cursor === '' ? [] : ['cursor' => $cursor])]);
            $cursor = '';
            $meta = $result['meta'] ?? [];
            $data = [...$data, ...JoinedReadings::earlierRecords($result['data'] ?? [], $values['parameter_uuid'], $part->recordedIn)];
            $next = $meta['next_cursor'] ?? null;
            if ($next !== null) {
                $meta['next_cursor'] = self::EARLIER_CURSOR.$consumed.'.'.$part->hops.'.'.$next;
            }
            // The runtime counts from the part's first record, its cursor's included.
            $consumed += (int) ($meta['consumed'] ?? 0);
            if ($next !== null || ($meta['limit_reached'] ?? false) || $consumed >= $values['limit']) {
                break;
            }
        }

        return ['data' => $data, 'meta' => [...$meta, 'limit' => $values['limit'], 'page_size' => $values['page_size'], 'returned' => count($data), 'consumed' => $consumed]];
    }

    /**
     * A one-record page from the first part that has any record, or null.
     *
     * @param  list<EarlierReadings>  $parts  newest first
     * @param  array<string, mixed>  $values
     */
    private function firstEarlier(array $parts, array $values, int $consumed): ?array
    {
        foreach ($parts as $part) {
            $result = $this->runtime->request('GET', '/internal/measurements/records', [...$part->query(array_diff_key($values, ['cursor' => true])),
                'limit' => $values['limit'] - $consumed, 'page_size' => 1]);
            if (($result['data'] ?? []) !== []) {
                return $result;
            }
        }

        return null;
    }

    /**
     * The earlier parts of a moved device's history that the requested range reaches
     * within their retention, oldest first.
     *
     * @param  array{from: string, to: string, parameter_uuid: string}  $values
     * @return list<EarlierReadings>
     */
    private function earlier(Device $device, array $values): array
    {
        return array_values(array_filter(EarlierReadings::for($device, $values['parameter_uuid']), fn (EarlierReadings $part): bool => $part->window($values) !== null));
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
        $parts = $this->earlier($device, $values);
        if ($parts === []) {
            $own = $this->runtime->request('GET', '/internal/measurements/state-history', $query, RuntimeClient::RANGE_TIMEOUT);

            return [...$own, 'data' => [...$own['data'], 'timeline' => JoinedReadings::mark($own['data']['timeline'] ?? [], JoinedReadings::SELF)]];
        }
        // Each part's timeline runs from the cutover before it, or the start of the range, to
        // its own cutover, and the device's own from the last one; the segments are shared
        // between them by the time each covers.
        $values['max_points'] = (int) $values['max_points'];
        $to = CarbonImmutable::parse($values['to'])->min(CarbonImmutable::now());
        $start = CarbonImmutable::parse($values['from']);
        $ranges = [];
        foreach ($parts as $part) {
            $window = $part->window($values);
            $from = $window['from']->max($start);
            if ($window['to']->greaterThan($from)) {
                $ranges[] = [$part, $from, $window['to']];
            }
            $start = $start->max($part->cutover);
        }
        $ownFrom = CarbonImmutable::parse($values['from'])->max($start);
        if ($ownFrom->lessThan($to)) {
            $ranges[] = [null, $ownFrom, $to];
        }
        $total = max(1.0, array_sum(array_map(fn (array $range): float => $range[2]->diffInMilliseconds($range[1], true), $ranges)));
        $before = [];
        $own = null;
        foreach ($ranges as [$part, $from, $until]) {
            $points = count($ranges) === 1 ? $values['max_points'] : max(10, (int) round($values['max_points'] * $until->diffInMilliseconds($from, true) / $total));
            $answer = $this->runtime->request('GET', '/internal/measurements/state-history', [...($part ? $part->query($values) : $query),
                'from' => $from->toJSON(), 'to' => $until->toJSON(), 'max_points' => $points], RuntimeClient::RANGE_TIMEOUT)['data'];
            if ($part) {
                $before[] = ['recorded_in' => $part->recordedIn, 'data' => $answer];
            } else {
                $own = $answer;
            }
        }

        return ['data' => JoinedReadings::stateHistory($before, $own)];
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
        $parts = $this->earlier($device, $values);
        if ($parts === []) {
            return [...$own, 'data' => [...$own['data'], 'points' => JoinedReadings::mark($own['data']['points'] ?? [], JoinedReadings::SELF)]];
        }
        // The copied profiles keep the counter's settings, so the predecessors roll over alike.
        $before = array_map(fn (EarlierReadings $part): array => ['recorded_in' => $part->recordedIn,
            'data' => $this->runtime->request('GET', '/internal/measurements/increase', [...$part->query($values), 'rollover_at' => $query['rollover_at']], RuntimeClient::RANGE_TIMEOUT)['data']], $parts);

        return ['data' => JoinedReadings::increase($before, $own['data'])];
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
