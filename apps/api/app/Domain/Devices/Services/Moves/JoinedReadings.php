<?php

declare(strict_types=1);

namespace App\Domain\Devices\Services\Moves;

use Carbon\CarbonImmutable;
use Illuminate\Support\Arr;
use Illuminate\Validation\ValidationException;

/**
 * Joins a moved device's history with the earlier parts of it (spec 031 US6, research
 * R18, ADR-040, ADR-041). Every reading says where it was recorded: `self` in the
 * device's own organization, `source` in another. These are pure functions of the runtime answers, each earlier part
 * given oldest first as `{recorded_in, data}`.
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
     * History series, the earliest part's first. With merged configurations, a part's
     * series of a data type and unit joins the later ones' of the same: buckets at one
     * time recombine from their counts, and pauses are found again across the cutovers.
     * Otherwise every configuration keeps its own series.
     *
     * @param  list<array{recorded_in: string, data: list<array<string, mixed>>}>  $earlier  oldest first
     * @param  list<array<string, mixed>>  $own
     * @return list<array<string, mixed>>
     */
    public static function series(array $earlier, array $own, bool $merged = true, int $bucketSeconds = 1): array
    {
        $parts = [...array_map(fn (array $part): array => array_map(fn (array $series): array => self::markSeries($series, $part['recorded_in']), $part['data']), $earlier),
            array_map(fn (array $series): array => self::markSeries($series, self::SELF), $own)];
        if (! $merged || array_merge(...array_slice($parts, 0, -1)) === []) {
            return array_merge(...$parts);
        }
        $key = fn (array $series): string => $series['data_type'].':'.($series['unit'] ?? '');
        $joined = [];
        foreach ($parts as $part) {
            foreach ($part as $series) {
                $joined[$key($series)] = isset($joined[$key($series)]) ? self::join($joined[$key($series)], $series, $bucketSeconds) : $series;
            }
        }

        return array_values($joined);
    }

    /**
     * A predecessor's records as the device's own parameter, without the predecessor's
     * installation and adapter revision.
     *
     * @param  list<array<string, mixed>>  $records
     * @return list<array<string, mixed>>
     */
    public static function earlierRecords(array $records, string $parameterUuid, string $recordedIn = self::SOURCE): array
    {
        return self::mark(array_map(fn (array $record): array => [...Arr::except($record, ['installation_uuid', 'adapter_revision_uuid']), 'parameter_uuid' => $parameterUuid], $records), $recordedIn);
    }

    /**
     * State history across the cutovers: each earlier part's timeline up to its cutover,
     * then the device's own, with durations summed over every range.
     *
     * @param  list<array{recorded_in: string, data: array<string, mixed>}>  $earlier  oldest first, ranges in order
     * @param  ?array<string, mixed>  $own  null when the range ends before the last cutover
     * @return array<string, mixed>
     */
    public static function stateHistory(array $earlier, ?array $own): array
    {
        $parts = [...array_map(fn (array $part): array => [...$part['data'], 'timeline' => self::mark($part['data']['timeline'] ?? [], $part['recorded_in'])], $earlier),
            ...($own === null ? [] : [[...$own, 'timeline' => self::mark($own['timeline'] ?? [], self::SELF)]])];
        if (count($parts) === 1) {
            return $parts[0];
        }
        $total = array_sum(array_map(fn (array $part): int => self::ms($part['to']) - self::ms($part['from']), $parts));
        $durations = [];
        foreach ($parts as $part) {
            foreach ($part['durations'] ?? [] as $duration) {
                $key = json_encode([$duration['value'] ?? null, $duration['known'] ?? false, $duration['data_type'] ?? null]);
                $sum = ($durations[$key]['duration_ms'] ?? 0) + $duration['duration_ms'];
                $durations[$key] = [...$duration, 'duration_ms' => $sum, 'percentage' => $total > 0 ? $sum / $total * 100 : 0.0];
            }
        }
        usort($durations, fn (array $a, array $b): int => $b['duration_ms'] <=> $a['duration_ms']);

        return ['from' => $parts[0]['from'], 'to' => $parts[count($parts) - 1]['to'], 'durations' => $durations,
            'timeline' => array_merge(...array_column($parts, 'timeline')),
            'sampled' => in_array(true, array_map(fn (array $part): bool => (bool) ($part['sampled'] ?? false), $parts), true)];
    }

    /**
     * Counter consumption across the cutovers: the calendar buckets of every answer,
     * summed where they meet, and partial again only at the joined range's ends.
     *
     * @param  list<array{recorded_in: string, data: array<string, mixed>}>  $earlier  oldest first
     * @param  array<string, mixed>  $own
     * @return array<string, mixed>
     */
    public static function increase(array $earlier, array $own): array
    {
        $answers = [...$earlier, ['recorded_in' => self::SELF, 'data' => $own]];
        $units = array_unique(array_map(fn (array $answer): string => json_encode($answer['data']['unit'] ?? null), array_filter($answers, fn (array $answer): bool => ($answer['data']['points'] ?? []) !== [])));
        if (count($units) > 1) {
            throw ValidationException::withMessages(['runtime' => 'The counter’s unit changed in this range. Choose a range on one side of the change.']);
        }
        $from = $own['from'];
        $buckets = [];
        foreach ($answers as $answer) {
            $from = self::ms($answer['data']['from']) < self::ms($from) ? $answer['data']['from'] : $from;
            foreach (self::mark($answer['data']['points'] ?? [], $answer['recorded_in']) as $point) {
                $at = self::ms($point['at']);
                $buckets[$at] = isset($buckets[$at]) ? [...$buckets[$at],
                    'increase' => $buckets[$at]['increase'] + $point['increase'], 'samples' => $buckets[$at]['samples'] + $point['samples'],
                    'resets' => $buckets[$at]['resets'] + $point['resets'], 'recorded_in' => self::either($buckets[$at], $point),
                ] : $point;
            }
        }
        ksort($buckets);
        $timezone = $own['timezone'] ?? 'UTC';
        $points = array_map(function (array $point) use ($from, $own, $timezone): array {
            $start = CarbonImmutable::parse($point['at'])->setTimezone($timezone);
            $end = self::bucketEnd($start, (string) $own['bucket']);

            return [...$point, 'partial' => $start->getTimestampMs() < self::ms($from) || $end->getTimestampMs() > self::ms($own['to'])];
        }, array_values($buckets));
        $unit = $own['unit'] ?? null;
        foreach (array_reverse($earlier) as $answer) {
            $unit ??= $answer['data']['unit'] ?? null;
        }

        return [...$own, 'from' => $from, 'unit' => $unit, 'points' => $points];
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
            'recorded_in' => self::either($a, $b)];
    }

    /**
     * Where a bucket holding two readings was recorded: `source` when either was.
     *
     * @param  array<string, mixed>  $a
     * @param  array<string, mixed>  $b
     */
    private static function either(array $a, array $b): string
    {
        return in_array(self::SOURCE, [$a['recorded_in'] ?? null, $b['recorded_in'] ?? null], true) ? self::SOURCE : self::SELF;
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
