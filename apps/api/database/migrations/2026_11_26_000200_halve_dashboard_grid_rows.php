<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Dashboard rows are halved from 48 px to 24 px so panels resize in smaller steps. Every
 * saved layout, current and in revision history, gets each panel's row (`y`) and height
 * (`h`) doubled, so panels keep exactly their size and place: two 24 px rows and the gap
 * between them span one 48 px row in every skin. Down halves them again, rounding a
 * height up so no panel shrinks below what it had.
 */
return new class extends Migration
{
    public function up(): void
    {
        $this->scale(fn (int $y, int $h): array => [$y * 2, $h * 2]);
    }

    public function down(): void
    {
        $this->scale(fn (int $y, int $h): array => [intdiv($y, 2), max(1, intdiv($h + 1, 2))]);
    }

    /** @param  callable(int, int): array{int, int}  $rows */
    private function scale(callable $rows): void
    {
        foreach (['dashboards', 'dashboard_revisions'] as $table) {
            DB::table($table)->select(['id', 'layouts'])->orderBy('id')->chunkById(200, function ($records) use ($table, $rows): void {
                foreach ($records as $record) {
                    $layouts = json_decode((string) $record->layouts, true);
                    if (! is_array($layouts) || $layouts === []) {
                        continue;
                    }
                    foreach ($layouts as $breakpoint => $items) {
                        foreach ((array) $items as $index => $item) {
                            if (is_array($item) && isset($item['y'], $item['h'])) {
                                [$layouts[$breakpoint][$index]['y'], $layouts[$breakpoint][$index]['h']] = $rows((int) $item['y'], (int) $item['h']);
                            }
                        }
                    }
                    DB::table($table)->where('id', $record->id)->update(['layouts' => json_encode($layouts)]);
                }
            });
        }
    }
};
