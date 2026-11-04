<?php

declare(strict_types=1);

namespace App\Domain\Firmware\Services;

/**
 * What changed in a profile's metrics across its published revisions (spec 027 R6), so a
 * developer holding any older revision can see what a newer starter adds or changes.
 */
final class MetricHistory
{
    public function __construct(private readonly MetricTables $tables) {}

    /**
     * @param  list<array{revision: int, definition: array}>  $revisions  every published revision, up to the one the starter is for
     * @return array{metrics: list<array{key: string, datatype: string, unit: ?string, writable: bool, introduced_in: int, changed_in: ?int}>, retired: list<array{key: string, retired_in: int}>}
     */
    public function of(array $revisions): array
    {
        usort($revisions, fn (array $a, array $b): int => $a['revision'] <=> $b['revision']);
        $introduced = $changed = $last = $seenIn = [];
        $current = [];
        foreach ($revisions as $revision) {
            $current = $this->tables->metrics($revision['definition']);
            foreach ($current as $metric) {
                $key = $metric['key'];
                $shape = [$metric['datatype'], $metric['unit']];
                $introduced[$key] ??= $revision['revision'];
                if (isset($last[$key]) && $last[$key] !== $shape) {
                    $changed[$key] = $revision['revision'];
                }
                $last[$key] = $shape;
                $seenIn[$key] = $revision['revision'];
            }
        }
        $metrics = array_map(fn (array $metric): array => [
            'key' => $metric['key'], 'datatype' => $metric['datatype'], 'unit' => $metric['unit'], 'writable' => $metric['writable'],
            'introduced_in' => $introduced[$metric['key']], 'changed_in' => $changed[$metric['key']] ?? null,
        ], $current);
        $keys = array_column($current, 'key');
        $retired = [];
        foreach ($seenIn as $key => $lastSeen) {
            if (! in_array($key, $keys, true)) {
                $next = array_values(array_filter(array_column($revisions, 'revision'), fn (int $revision): bool => $revision > $lastSeen));
                $retired[] = ['key' => (string) $key, 'retired_in' => $next[0]];
            }
        }

        return ['metrics' => $metrics, 'retired' => $retired];
    }
}
