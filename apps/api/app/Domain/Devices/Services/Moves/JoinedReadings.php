<?php

declare(strict_types=1);

namespace App\Domain\Devices\Services\Moves;

use Carbon\CarbonImmutable;
use Illuminate\Support\Arr;
use Illuminate\Validation\ValidationException;

/**
 * Joins a moved device's history with its predecessor's (spec 031 US6, research R18).
 * Every reading says where it was recorded: `source` for the predecessor's, `self` for
 * the device's own. These are pure functions of the two runtime answers.
 */
final class JoinedReadings
{
    public const SELF = 'self';

    public const SOURCE = 'source';

    /**
     * @param  list<array<string, mixed>>  $readings
     * @return list<array<string, mixed>>
     */
    public static function mark(array $readings, string $recordedIn): array
    {
        return array_map(fn (array $reading): array => [...$reading, 'recorded_in' => $recordedIn], $readings);
    }

    /**
     * History series, the predecessor's first. With merged configurations, its series of
     * a data type and unit joins the device's own of the same: buckets at one time
     * recombine from their counts, and pauses are found again across the cutover.
     * Otherwise every configuration keeps its own series.
     *
     * @param  list<array<string, mixed>>  $before
     * @param  list<array<string, mixed>>  $own
     * @return list<array<string, mixed>>
     */
    public static function series(array $before, array $own, bool $merged = true, int $bucketSeconds = 1): array
    {
        $before = array_map(fn (array $series): array => self::markSeries($series, self::SOURCE), $before);
        $own = array_map(fn (array $series): array => self::markSeries($series, self::SELF), $own);
        if (! $merged || $before === []) {
            return [...$before, ...$own];
        }
        $key = fn (array $series): string => $series['data_type'].':'.($series['unit'] ?? '');
        $joined = [];
        foreach ($before as $series) {
            $joined[$key($series)] = $series;
        }
        foreach ($own as $series) {
            $joined[$key($series)] = isset($joined[$key($series)]) ? self::join($joined[$key($series)], $series, $bucketSeconds) : $series;
        }

        return array_values($joined);
    }

    /**
     * The predecessor's records as the device's own parameter, without the source's
     * installation and adapter revision.
     *
     * @param  list<array<string, mixed>>  $records
     * @return list<array<string, mixed>>
     */
    public static function earlierRecords(array $records, string $parameterUuid): array
    {
        return self::mark(array_map(fn (array $record): array => [...Arr::except($record, ['installation_uuid', 'adapter_revision_uuid']), 'parameter_uuid' => $parameterUuid], $records), self::SOURCE);
    }

    /**
     * State history across the cutover: the predecessor's timeline up to it, then the
     * device's own, with durations summed over both ranges.
     *
     * @param  array<string, mixed>  $before
     * @param  ?array<string, mixed>  $own  null when the range ends before the cutover
     * @return array<string, mixed>
     */
    public static function stateHistory(array $before, ?array $own): array
    {
        $before = [...$before, 'timeline' => self::mark($before['timeline'] ?? [], self::SOURCE)];
        if ($own === null) {
            return $before;
        }
        $total = self::ms($before['to']) - self::ms($before['from']) + self::ms($own['to']) - self::ms($own['from']);
        $durations = [];
        foreach ([...$before['durations'] ?? [], ...$own['durations'] ?? []] as $duration) {
            $key = json_encode([$duration['value'] ?? null, $duration['known'] ?? false, $duration['data_type'] ?? null]);
            $sum = ($durations[$key]['duration_ms'] ?? 0) + $duration['duration_ms'];
            $durations[$key] = [...$duration, 'duration_ms' => $sum, 'percentage' => $total > 0 ? $sum / $total * 100 : 0.0];
        }
        usort($durations, fn (array $a, array $b): int => $b['duration_ms'] <=> $a['duration_ms']);

        return ['from' => $before['from'], 'to' => $own['to'], 'durations' => $durations,
            'timeline' => [...$before['timeline'], ...self::mark($own['timeline'] ?? [], self::SELF)],
            'sampled' => ($before['sampled'] ?? false) || ($own['sampled'] ?? false)];
    }

    /**
     * Counter consumption across the cutover: the calendar buckets of both answers, summed
     * where they meet, and partial again only at the joined range's ends.
     *
     * @param  array<string, mixed>  $before
     * @param  array<string, mixed>  $own
     * @return array<string, mixed>
     */
    public static function increase(array $before, array $own): array
    {
        if (($before['points'] ?? []) !== [] && ($own['points'] ?? []) !== [] && ($before['unit'] ?? null) !== ($own['unit'] ?? null)) {
            throw ValidationException::withMessages(['runtime' => 'The counter’s unit changed in this range. Choose a range on one side of the change.']);
        }
        $from = self::ms($before['from']) < self::ms($own['from']) ? $before['from'] : $own['from'];
        $buckets = [];
        foreach ([...self::mark($before['points'] ?? [], self::SOURCE), ...self::mark($own['points'] ?? [], self::SELF)] as $point) {
            $at = self::ms($point['at']);
            $buckets[$at] = isset($buckets[$at]) ? [...$buckets[$at],
                'increase' => $buckets[$at]['increase'] + $point['increase'], 'samples' => $buckets[$at]['samples'] + $point['samples'],
                'resets' => $buckets[$at]['resets'] + $point['resets'], 'recorded_in' => self::SOURCE,
            ] : $point;
        }
        ksort($buckets);
        $timezone = $own['timezone'] ?? 'UTC';
        $points = array_map(function (array $point) use ($from, $own, $timezone): array {
            $start = CarbonImmutable::parse($point['at'])->setTimezone($timezone);
            $end = self::bucketEnd($start, (string) $own['bucket']);

            return [...$point, 'partial' => $start->getTimestampMs() < self::ms($from) || $end->getTimestampMs() > self::ms($own['to'])];
        }, array_values($buckets));

        return [...$own, 'from' => $from, 'unit' => $own['unit'] ?? $before['unit'] ?? null, 'points' => $points];
    }

    /**
     * @param  array<string, mixed>  $series
     * @return array<string, mixed>
     */
    private static function markSeries(array $series, string $recordedIn): array
    {
        $series['points'] = self::mark($series['points'] ?? [], $recordedIn);
        if (isset($series['configurations'])) {
            $series['configurations'] = self::mark($series['configurations'], $recordedIn);
        }

        return $series;
    }

    /**
     * @param  array<string, mixed>  $earlier
     * @param  array<string, mixed>  $later
     * @return array<string, mixed>
     */
    private static function join(array $earlier, array $later, int $bucketSeconds): array
    {
        $points = [...$earlier['points'], ...$later['points']];
        if (in_array($later['data_type'], ['number', 'integer'], true)) {
            $buckets = [];
            foreach ($points as $point) {
                // The runtime's pause markers are placed again below, across both.
                if (($point['count'] ?? 0) === 0) {
                    continue;
                }
                $at = self::ms($point['at']);
                $buckets[$at] = isset($buckets[$at]) ? self::combine($buckets[$at], $point) : $point;
            }
            ksort($buckets);
            $points = self::withGaps(array_values($buckets), $bucketSeconds);
        } else {
            // Raw readings: in time order, the predecessor's first at an equal time.
            $points = collect($points)->sortBy(fn (array $point): int => self::ms($point['at']))->values()->all();
        }
        $spans = [...$earlier['configurations'] ?? [], ...$later['configurations'] ?? []];

        return [...$later, 'points' => $points, ...($spans === [] ? [] : ['configurations' => $spans])];
    }

    /**
     * One bucket from two that start together: its average weighted by their counts.
     *
     * @param  array<string, mixed>  $a
     * @param  array<string, mixed>  $b
     * @return array<string, mixed>
     */
    private static function combine(array $a, array $b): array
    {
        $count = $a['count'] + $b['count'];
        $value = is_numeric($a['value']) && is_numeric($b['value']) ? ($a['value'] * $a['count'] + $b['value'] * $b['count']) / $count : ($b['value'] ?? $a['value']);
        $min = array_filter([$a['min'] ?? null, $b['min'] ?? null], fn (mixed $v): bool => $v !== null);
        $max = array_filter([$a['max'] ?? null, $b['max'] ?? null], fn (mixed $v): bool => $v !== null);

        return ['at' => $b['at'], 'value' => $value, ...($min === [] ? [] : ['min' => min($min)]), ...($max === [] ? [] : ['max' => max($max)]), 'count' => $count,
            'recorded_in' => in_array(self::SOURCE, [$a['recorded_in'] ?? null, $b['recorded_in'] ?? null], true) ? self::SOURCE : self::SELF];
    }

    /**
     * The runtime's rule for pauses (`withGaps`): a valueless point where the series
     * stops for longer than three times its usual spacing and longer than a bucket.
     *
     * @param  list<array<string, mixed>>  $points
     * @return list<array<string, mixed>>
     */
    private static function withGaps(array $points, int $bucketSeconds): array
    {
        if (count($points) < 2) {
            return $points;
        }
        $times = array_map(fn (array $point): int => self::ms($point['at']), $points);
        $spacing = [];
        for ($i = 1; $i < count($times); $i++) {
            $spacing[] = $times[$i] - $times[$i - 1];
        }
        sort($spacing);
        $limit = max($bucketSeconds * 1000, 3 * $spacing[intdiv(count($spacing), 2)]);
        $result = [];
        foreach ($points as $i => $point) {
            if ($i > 0 && $limit < $times[$i] - $times[$i - 1]) {
                $result[] = ['at' => CarbonImmutable::createFromTimestampMsUTC($times[$i - 1] + $bucketSeconds * 1000)->format('Y-m-d\TH:i:s\Z'),
                    'value' => null, 'count' => 0, 'recorded_in' => $points[$i - 1]['recorded_in']];
            }
            $result[] = $point;
        }

        return $result;
    }

    /** The start of the next calendar bucket, as the runtime's `BucketEnd`. */
    private static function bucketEnd(CarbonImmutable $start, string $bucket): CarbonImmutable
    {
        return match ($bucket) {
            '15m' => $start->addMinutes(15),
            '1h' => $start->addHour(),
            '1d' => $start->addDay(),
            '1w' => $start->addWeek(),
            '1mo' => $start->addMonthNoOverflow(),
            default => $start->addYear(),
        };
    }

    private static function ms(string $at): int
    {
        return CarbonImmutable::parse($at)->getTimestampMs();
    }
}
