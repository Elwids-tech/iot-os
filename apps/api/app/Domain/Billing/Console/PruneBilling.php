<?php

declare(strict_types=1);

namespace App\Domain\Billing\Console;

use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Removes billing ledgers past their use (constitution VII). Billing email notices are
 * kept 13 months: every key carries its month or subject, so a pruned key is never due
 * again. Later billing ledgers join here.
 */
final class PruneBilling extends Command
{
    public const NOTICE_MONTHS = 13;

    protected $signature = 'billing:prune {--now= : Prune as of this time instead of now}';

    protected $description = 'Delete billing email notices older than 13 months';

    public function handle(): int
    {
        $now = $this->option('now') ? CarbonImmutable::parse((string) $this->option('now')) : CarbonImmutable::now();
        $before = $now->subMonthsNoOverflow(self::NOTICE_MONTHS);
        $deleted = 0;

        do {
            $ids = DB::table('billing_notices')->where('sent_at', '<', $before)->orderBy('id')->limit(1000)->pluck('id');
            $deleted += $ids->isEmpty() ? 0 : DB::table('billing_notices')->whereIn('id', $ids)->delete();
        } while ($ids->count() === 1000);

        $this->info("Pruned {$deleted} billing notices.");

        return self::SUCCESS;
    }
}
