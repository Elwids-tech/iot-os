<?php

declare(strict_types=1);

namespace App\Domain\Billing\Console;

use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Removes billing ledgers past their use (constitution VII). Billing email notices are
 * kept 13 months: every key carries its month or subject, so a pruned key is never due
 * again. Data point buckets are kept 13 months too; usage keeps its monthly totals and
 * runtime reports that old no longer arrive. Retention floors go once they end (spec
 * 029 US4).
 */
final class PruneBilling extends Command
{
    public const NOTICE_MONTHS = 13;

    public const BUCKET_MONTHS = 13;

    protected $signature = 'billing:prune {--now= : Prune as of this time instead of now}';

    protected $description = 'Delete billing email notices and data point buckets older than 13 months, and retention floors that ended';

    public function handle(): int
    {
        $now = $this->option('now') ? CarbonImmutable::parse((string) $this->option('now')) : CarbonImmutable::now();
        $before = $now->subMonthsNoOverflow(self::NOTICE_MONTHS);
        $deleted = 0;

        do {
            $ids = DB::table('billing_notices')->where('sent_at', '<', $before)->orderBy('id')->limit(1000)->pluck('id');
            $deleted += $ids->isEmpty() ? 0 : DB::table('billing_notices')->whereIn('id', $ids)->delete();
        } while ($ids->count() === 1000);

        // A daily run finds one day of hours per organization.
        $buckets = DB::table('billing_data_point_buckets')->where('hour', '<', $now->subMonthsNoOverflow(self::BUCKET_MONTHS))->delete();
        $floors = DB::table('telemetry_retention_floors')->where('until', '<=', $now)->delete();

        $this->info("Pruned {$deleted} billing notices, {$buckets} data point buckets and {$floors} retention floors.");

        return self::SUCCESS;
    }
}
