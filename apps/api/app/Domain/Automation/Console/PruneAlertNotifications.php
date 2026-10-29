<?php

declare(strict_types=1);

namespace App\Domain\Automation\Console;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/** Bell notifications are kept 90 days, read or unread (spec 022, FR-012). The alerts stay. */
final class PruneAlertNotifications extends Command
{
    public const DAYS = 90;

    protected $signature = 'alerts:prune-notifications';

    protected $description = 'Delete alert notifications older than 90 days';

    public function handle(): int
    {
        $deleted = 0;
        do {
            $ids = DB::table('notifications')->where('type', 'alert')->where('created_at', '<', now()->subDays(self::DAYS))->limit(1000)->pluck('id');
            $deleted += $ids->isEmpty() ? 0 : DB::table('notifications')->whereIn('id', $ids)->delete();
        } while ($ids->count() === 1000);
        $this->info("Pruned {$deleted} alert notifications.");

        return self::SUCCESS;
    }
}
