<?php

declare(strict_types=1);

namespace App\Domain\DeviceAdapters\Console;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/** Deliveries, runs and counts are diagnostics, kept 7 days (spec 020, FR-070 to FR-072). */
final class PruneAdapterRecords extends Command
{
    protected $signature = 'adapters:prune';

    protected $description = 'Delete adapter deliveries, poll runs and outcome counts older than their retention';

    public function handle(): int
    {
        $deliveries = DB::table('device_adapter_deliveries')->where('received_at', '<', now()->subDays(7))->delete();
        $runs = DB::table('device_adapter_poll_runs')->where('started_at', '<', now()->subDays(7))->delete();
        $counts = DB::table('device_adapter_outcome_counts')->where('bucket', '<', now()->subDays(8))->delete();
        $reports = DB::table('device_adapter_reports')->where('created_at', '<', now()->subDays(8))->delete();
        $this->info("Pruned {$deliveries} deliveries, {$runs} poll runs, {$counts} outcome counts and {$reports} report ids.");

        return self::SUCCESS;
    }
}
