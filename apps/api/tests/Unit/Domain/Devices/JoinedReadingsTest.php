<?php

declare(strict_types=1);

namespace Tests\Unit\Domain\Devices;

use App\Domain\Devices\Services\Moves\JoinedReadings;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

/** Joining a moved device's readings with the earlier parts of its history (spec 031 US6, research R18, ADR-040). */
final class JoinedReadingsTest extends TestCase
{
    public function test_a_bucket_that_spans_the_cutover_recombines_from_its_counts(): void
    {
        $before = [$this->series('cfg-a', [['2026-11-10T11:40:00Z', 10.0, 9.0, 11.0, 3], ['2026-11-10T12:00:00Z', 12.0, 12.0, 12.0, 1]])];
        $own = [$this->series('cfg-b', [['2026-11-10T12:00:00Z', 20.0, 18.0, 22.0, 3], ['2026-11-10T12:20:00Z', 21.0, 21.0, 21.0, 2]])];

        $joined = JoinedReadings::series([$this->source($before)], $own, true, 1200);

        $this->assertCount(1, $joined);
        $this->assertSame('cfg-b', $joined[0]['configuration_uuid']);
        $this->assertSame([
            ['at' => '2026-11-10T11:40:00Z', 'value' => 10.0, 'min' => 9.0, 'max' => 11.0, 'count' => 3, 'recorded_in' => 'source'],
            ['at' => '2026-11-10T12:00:00Z', 'value' => 18.0, 'min' => 12.0, 'max' => 22.0, 'count' => 4, 'recorded_in' => 'source'],
            ['at' => '2026-11-10T12:20:00Z', 'value' => 21.0, 'min' => 21.0, 'max' => 21.0, 'count' => 2, 'recorded_in' => 'self'],
        ], $joined[0]['points']);
        $this->assertSame([['configuration_uuid' => 'cfg-a', 'from' => '2026-11-10T11:40:00Z', 'recorded_in' => 'source'], ['configuration_uuid' => 'cfg-b', 'from' => '2026-11-10T12:00:00Z', 'recorded_in' => 'self']], $joined[0]['configurations']);
    }

    public function test_pauses_are_found_again_across_the_join(): void
    {
        // Ten-minute readings before, a two-hour pause during the move, then ten-minute readings again.
        $before = [$this->series('cfg-a', [['2026-11-10T09:00:00Z', 1.0, 1.0, 1.0, 1], ['2026-11-10T09:10:00Z', 1.0, 1.0, 1.0, 1], ['2026-11-10T09:20:00Z', 1.0, 1.0, 1.0, 1]])];
        $own = [$this->series('cfg-b', [['2026-11-10T11:20:00Z', 2.0, 2.0, 2.0, 1], ['2026-11-10T11:30:00Z', 2.0, 2.0, 2.0, 1]])];

        $points = JoinedReadings::series([$this->source($before)], $own, true, 60)[0]['points'];

        $this->assertSame(['2026-11-10T09:21:00Z', null, 0, 'source'], [$points[3]['at'], $points[3]['value'], $points[3]['count'], $points[3]['recorded_in']]);
        $this->assertCount(6, $points);
    }

    public function test_series_of_another_unit_or_per_configuration_stay_apart(): void
    {
        $before = [$this->series('cfg-a', [['2026-11-10T11:40:00Z', 10.0, 10.0, 10.0, 1]], 'm3/h')];
        $own = [$this->series('cfg-b', [['2026-11-10T12:20:00Z', 20.0, 20.0, 20.0, 1]])];

        $this->assertSame(['cfg-a', 'cfg-b'], array_column(JoinedReadings::series([$this->source($before)], $own, true, 60), 'configuration_uuid'));
        $this->assertSame(['cfg-a', 'cfg-b'], array_column(JoinedReadings::series([$this->source([$this->series('cfg-a', [['2026-11-10T11:40:00Z', 10.0, 10.0, 10.0, 1]])])], $own, false), 'configuration_uuid'));
        $this->assertSame(['self'], array_column(JoinedReadings::series([], $own, true)[0]['points'], 'recorded_in'));
    }

    public function test_state_history_runs_up_to_the_cutover_then_on_with_durations_over_both(): void
    {
        $before = ['from' => '2026-11-10T10:00:00Z', 'to' => '2026-11-10T12:00:00Z', 'sampled' => false,
            'durations' => [['value' => true, 'known' => true, 'data_type' => 'boolean', 'duration_ms' => 3600000, 'percentage' => 50.0], ['value' => false, 'known' => true, 'data_type' => 'boolean', 'duration_ms' => 3600000, 'percentage' => 50.0]],
            'timeline' => [['from' => '2026-11-10T10:00:00Z', 'to' => '2026-11-10T11:00:00Z', 'value' => true, 'known' => true], ['from' => '2026-11-10T11:00:00Z', 'to' => '2026-11-10T12:00:00Z', 'value' => false, 'known' => true]]];
        $own = ['from' => '2026-11-10T12:00:00Z', 'to' => '2026-11-10T14:00:00Z', 'sampled' => false,
            'durations' => [['value' => true, 'known' => true, 'data_type' => 'boolean', 'duration_ms' => 6600000, 'percentage' => 91.6], ['value' => null, 'known' => false, 'duration_ms' => 600000, 'percentage' => 8.3]],
            'timeline' => [['from' => '2026-11-10T12:00:00Z', 'to' => '2026-11-10T12:10:00Z', 'value' => null, 'known' => false], ['from' => '2026-11-10T12:10:00Z', 'to' => '2026-11-10T14:00:00Z', 'value' => true, 'known' => true]]];

        $joined = JoinedReadings::stateHistory([$this->source($before)], $own);

        $this->assertSame(['2026-11-10T10:00:00Z', '2026-11-10T14:00:00Z', false], [$joined['from'], $joined['to'], $joined['sampled']]);
        $this->assertSame(['source', 'source', 'self', 'self'], array_column($joined['timeline'], 'recorded_in'));
        $this->assertSame([[true, 10200000, 70.83], [false, 3600000, 25.0], [null, 600000, 4.17]], array_map(fn (array $d): array => [$d['value'], $d['duration_ms'], round($d['percentage'], 2)], $joined['durations']));
        $this->assertSame(['source', 'source'], array_column(JoinedReadings::stateHistory([$this->source($before)], null)['timeline'], 'recorded_in'));
    }

    public function test_counter_buckets_sum_where_they_meet_and_are_partial_only_at_the_ends(): void
    {
        $before = ['from' => '2026-11-08T06:00:00Z', 'to' => '2026-11-10T12:00:00Z', 'bucket' => '1d', 'timezone' => 'Europe/Berlin', 'unit' => 'L', 'points' => [
            ['at' => '2026-11-08T00:00:00+01:00', 'increase' => 50.0, 'samples' => 10, 'resets' => 0, 'partial' => true],
            ['at' => '2026-11-09T00:00:00+01:00', 'increase' => 100.0, 'samples' => 24, 'resets' => 0, 'partial' => false],
            ['at' => '2026-11-10T00:00:00+01:00', 'increase' => 20.0, 'samples' => 5, 'resets' => 1, 'partial' => true],
        ]];
        $own = ['from' => '2026-11-08T06:00:00Z', 'to' => '2026-11-11T07:00:00Z', 'bucket' => '1d', 'timezone' => 'Europe/Berlin', 'unit' => 'L', 'points' => [
            ['at' => '2026-11-10T00:00:00+01:00', 'increase' => 30.0, 'samples' => 6, 'resets' => 0, 'partial' => false],
        ]];

        $joined = JoinedReadings::increase([$this->source($before)], $own);

        $this->assertSame([[50.0, 10, 0, true, 'source'], [100.0, 24, 0, false, 'source'], [50.0, 11, 1, false, 'source']],
            array_map(fn (array $p): array => [$p['increase'], $p['samples'], $p['resets'], $p['partial'], $p['recorded_in']], $joined['points']));
        $this->assertSame(['2026-11-08T06:00:00Z', 'L'], [$joined['from'], $joined['unit']]);

        $this->expectException(ValidationException::class);
        JoinedReadings::increase([$this->source([...$before, 'unit' => 'm3'])], $own);
    }

    public function test_the_own_organizations_earlier_readings_come_first_and_stay_its_own(): void
    {
        // Back in its first organization: its readings there, then the shared predecessor's, then its own.
        $first = [$this->series('cfg-p', [['2026-11-10T08:00:00Z', 5.0, 5.0, 5.0, 2], ['2026-11-10T08:20:00Z', 5.0, 5.0, 5.0, 2]])];
        $shared = [$this->series('cfg-s', [['2026-11-10T08:20:00Z', 7.0, 7.0, 7.0, 2], ['2026-11-10T08:40:00Z', 7.0, 7.0, 7.0, 1]])];
        $own = [$this->series('cfg-o', [['2026-11-10T09:00:00Z', 9.0, 9.0, 9.0, 1]])];

        $joined = JoinedReadings::series([['recorded_in' => 'self', 'data' => $first], $this->source($shared)], $own, true, 1200);

        $this->assertCount(1, $joined);
        $this->assertSame([['2026-11-10T08:00:00Z', 5.0, 'self'], ['2026-11-10T08:20:00Z', 6.0, 'source'], ['2026-11-10T08:40:00Z', 7.0, 'source'], ['2026-11-10T09:00:00Z', 9.0, 'self']],
            array_map(fn (array $p): array => [$p['at'], $p['value'], $p['recorded_in']], $joined[0]['points']));
        $this->assertSame(['cfg-p', 'cfg-s', 'cfg-o'], array_column($joined[0]['configurations'], 'configuration_uuid'));
        // Without the shared part, nothing it holds is marked as recorded elsewhere.
        $alone = JoinedReadings::series([['recorded_in' => 'self', 'data' => $first]], $own, true, 1200);
        $this->assertSame(['self'], array_values(array_unique(array_column($alone[0]['points'], 'recorded_in'))));
        $this->assertSame(['cfg-p', 'cfg-o'], array_column(JoinedReadings::series([['recorded_in' => 'self', 'data' => $first]], $own, false), 'configuration_uuid'));
    }

    public function test_state_history_and_counters_join_every_part_in_order(): void
    {
        $range = fn (string $from, string $to, mixed $value): array => ['from' => $from, 'to' => $to, 'sampled' => false,
            'durations' => [['value' => $value, 'known' => true, 'data_type' => 'boolean', 'duration_ms' => strtotime($to) * 1000 - strtotime($from) * 1000, 'percentage' => 100.0]],
            'timeline' => [['from' => $from, 'to' => $to, 'value' => $value, 'known' => true]]];
        $joined = JoinedReadings::stateHistory([['recorded_in' => 'self', 'data' => $range('2026-11-10T08:00:00Z', '2026-11-10T09:00:00Z', true)],
            $this->source($range('2026-11-10T09:00:00Z', '2026-11-10T10:00:00Z', false))], $range('2026-11-10T10:00:00Z', '2026-11-10T12:00:00Z', true));
        $this->assertSame(['2026-11-10T08:00:00Z', '2026-11-10T12:00:00Z'], [$joined['from'], $joined['to']]);
        $this->assertSame(['self', 'source', 'self'], array_column($joined['timeline'], 'recorded_in'));
        $this->assertSame([[true, 75.0], [false, 25.0]], array_map(fn (array $d): array => [$d['value'], $d['percentage']], $joined['durations']));

        $day = fn (string $from, string $to, array $points): array => ['from' => $from, 'to' => $to, 'bucket' => '1d', 'timezone' => 'UTC', 'unit' => 'L',
            'points' => array_map(fn (array $p): array => ['at' => $p[0], 'increase' => $p[1], 'samples' => 1, 'resets' => 0, 'partial' => false], $points)];
        $counter = JoinedReadings::increase([['recorded_in' => 'self', 'data' => $day('2026-11-08T00:00:00Z', '2026-11-09T06:00:00Z', [['2026-11-08T00:00:00Z', 10.0], ['2026-11-09T00:00:00Z', 1.0]])],
            ['recorded_in' => 'self', 'data' => $day('2026-11-09T12:00:00Z', '2026-11-10T06:00:00Z', [['2026-11-09T00:00:00Z', 2.0], ['2026-11-10T00:00:00Z', 3.0]])]],
            $day('2026-11-10T12:00:00Z', '2026-11-11T00:00:00Z', [['2026-11-10T00:00:00Z', 4.0]]));
        $this->assertSame([[10.0, 'self'], [3.0, 'self'], [7.0, 'self']], array_map(fn (array $p): array => [$p['increase'], $p['recorded_in']], $counter['points']));
        $this->assertSame('2026-11-08T00:00:00Z', $counter['from']);
    }

    /** An earlier part shared from the source. */
    private function source(array $data): array
    {
        return ['recorded_in' => 'source', 'data' => $data];
    }

    /** @param list<array{0: string, 1: float, 2: float, 3: float, 4: int}> $points */
    private function series(string $configuration, array $points, string $unit = 'L/min'): array
    {
        return ['configuration_uuid' => $configuration, 'unit' => $unit, 'data_type' => 'number',
            'points' => array_map(fn (array $p): array => ['at' => $p[0], 'value' => $p[1], 'min' => $p[2], 'max' => $p[3], 'count' => $p[4]], $points),
            'configurations' => [['configuration_uuid' => $configuration, 'from' => $points[0][0]]]];
    }
}
