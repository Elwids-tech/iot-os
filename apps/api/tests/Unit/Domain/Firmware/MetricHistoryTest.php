<?php

declare(strict_types=1);

namespace Tests\Unit\Domain\Firmware;

use App\Domain\Firmware\Services\MetricHistory;
use App\Domain\Firmware\Services\MetricTables;
use Tests\TestCase;

final class MetricHistoryTest extends TestCase
{
    public function test_history_records_added_changed_and_retired_metrics(): void
    {
        $relay = json_decode((string) file_get_contents(base_path('../../contracts/firmware/fixtures/profiles/relay.json')), true)['revisions'];

        $history = (new MetricHistory(new MetricTables))->of(array_reverse($relay));

        $this->assertSame([[1, null], [1, 2], [2, null]], array_map(fn ($metric) => [$metric['introduced_in'], $metric['changed_in']], $history['metrics']));
        $this->assertSame([['key' => 'legacy_flag', 'retired_in' => 2]], $history['retired']);
    }

    public function test_a_change_is_dated_by_the_revision_that_made_it_across_skipped_revisions(): void
    {
        $revision = fn (int $n, string $unit, bool $extra): array => ['revision' => $n, 'definition' => ['parameters' => [
            ['key' => 'level', 'data_type' => 'number', 'kind' => 'measurement', 'reports_state' => true, 'unit' => $unit],
            ...($extra ? [['key' => 'spare', 'data_type' => 'integer', 'kind' => 'state', 'reports_state' => true]] : []),
        ]]];

        $history = (new MetricHistory(new MetricTables))->of([$revision(1, 'cm', true), $revision(4, 'cm', true), $revision(7, 'mm', false)]);

        $this->assertSame(7, $history['metrics'][0]['changed_in']);
        $this->assertSame([['key' => 'spare', 'retired_in' => 7]], $history['retired']);
    }
}
