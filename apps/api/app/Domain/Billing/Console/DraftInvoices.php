<?php

declare(strict_types=1);

namespace App\Domain\Billing\Console;

use App\Domain\Billing\Services\InvoiceDrafter;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;

/**
 * Drafts last month's invoices once the runtime has reported the month's usage to its
 * end (spec 029 FR-031, research R13). Daily, so a missed run catches up; until usage is
 * final the accounts wait, and administrators see them after three days.
 */
final class DraftInvoices extends Command
{
    protected $signature = 'billing:draft-invoices {--now= : Draft as of this time instead of now}';

    protected $description = "Draft last month's invoices whose usage is final";

    public function handle(InvoiceDrafter $drafter): int
    {
        $now = $this->option('now') ? CarbonImmutable::parse((string) $this->option('now')) : CarbonImmutable::now();
        $month = $now->utc()->startOfMonth()->subMonthNoOverflow();

        if (! $drafter->usageFinal($month)) {
            $this->info(sprintf('Usage for %s is not final yet: %d accounts wait.', $month->format('F Y'), $drafter->dueAccounts($month)->count()));

            return self::SUCCESS;
        }

        $this->info(sprintf('Drafted %d invoices for %s.', $drafter->draftDue($now), $month->format('F Y')));

        return self::SUCCESS;
    }
}
