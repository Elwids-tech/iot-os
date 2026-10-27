<?php

declare(strict_types=1);

namespace App\Domain\Dashboards\Services;

/**
 * Where a new panel goes, as `appendLayout` in apps/portal/src/dashboards/model.ts places
 * it: half the columns wide and 6 rows high, at the first free slot or below everything.
 * Both are pinned by contracts/dashboards/v1/panel-suggestions.fixture.json.
 */
final class DashboardLayout
{
    /** Columns per breakpoint, as the portal's grid. */
    public const COLUMNS = ['lg' => 12, 'md' => 10, 'sm' => 6, 'xs' => 1, 'xxs' => 1];

    /**
     * Adds panel `$id` to every saved breakpoint, or to `lg` when none is saved yet.
     *
     * @param  array<string, list<array{i: string, x: int, y: int, w: int, h: int}>>  $layouts
     * @param  'available'|'bottom'  $placement
     * @return array<string, list<array{i: string, x: int, y: int, w: int, h: int}>>
     */
    public function append(array $layouts, string $id, string $placement = 'available'): array
    {
        $result = [];
        foreach ($layouts === [] ? ['lg' => []] : $layouts as $breakpoint => $items) {
            $cols = self::COLUMNS[$breakpoint] ?? 12;
            $result[$breakpoint] = $this->place($items ?? [], $id, $placement, $cols, max(1, intdiv($cols, 2)), 6);
        }

        return $result;
    }

    /**
     * @param  list<array{i: string, x: int, y: int, w: int, h: int}>  $items
     * @return list<array{i: string, x: int, y: int, w: int, h: int}>
     */
    private function place(array $items, string $id, string $placement, int $cols, int $w, int $h): array
    {
        if ($placement === 'bottom') {
            // Under the lowest panel, so the grid's upward compaction keeps it at the bottom.
            $lowest = null;
            foreach ($items as $item) {
                if ($lowest === null || $item['y'] + $item['h'] > $lowest['y'] + $lowest['h']) {
                    $lowest = $item;
                }
            }

            return [...$items, ['i' => $id, 'x' => $lowest ? min($lowest['x'], $cols - $w) : 0, 'y' => $lowest ? $lowest['y'] + $lowest['h'] : 0, 'w' => $w, 'h' => $h]];
        }
        $rows = array_unique([0, ...array_map(fn (array $item): int => $item['y'] + $item['h'], $items)]);
        sort($rows);
        foreach ($rows as $y) {
            for ($x = 0; $x <= $cols - $w; $x++) {
                if (! $this->overlaps($items, $x, $y, $w, $h)) {
                    return [...$items, ['i' => $id, 'x' => $x, 'y' => $y, 'w' => $w, 'h' => $h]];
                }
            }
        }

        return $items;
    }

    /** @param  list<array{i: string, x: int, y: int, w: int, h: int}>  $items */
    private function overlaps(array $items, int $x, int $y, int $w, int $h): bool
    {
        foreach ($items as $item) {
            if ($x < $item['x'] + $item['w'] && $x + $w > $item['x'] && $y < $item['y'] + $item['h'] && $y + $h > $item['y']) {
                return true;
            }
        }

        return false;
    }
}
