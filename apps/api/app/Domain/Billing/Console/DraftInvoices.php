<?php

declare(strict_types=1);

namespace App\Domain\Billing\Console;

use App\Domain\Billing\Services\InvoiceDrafter;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;

/**
 * Drafts the invoices of each ended month once the runtime has reported its usage to its
 * end (spec 029 FR-031, research R13). Daily, so a missed run or a month whose usage
 * became final late catches up; until usage is final the accounts wait, and
 * administrators see them after three days.
 */
final class DraftInvoices extends Command
{
    protected $signature = 'billing:draft-invoices {--now= : Draft as of this time instead of now}';

    protected $description = 'Draft the invoices of ended months whose usage is final';

    public function handle(InvoiceDrafter $drafter): int
    {
        $now = $this->option('now') ? CarbonImmutable::parse((string) $this->option('now')) : CarbonImmutable::now();

        foreach ($drafter->draftDue($now) as $month => $count) {
            $this->info(sprintf('Drafted %d invoices for %s.', $count, CarbonImmutable::parse($month)->format('F Y')));
        }

        $waiting = collect($drafter->waiting(null, $now))->countBy(fn (array $row): string => $row['month']->format('F Y'));
        foreach ($waiting as $month => $count) {
            $this->info(sprintf('Usage for %s is not final yet: %d accounts wait.', $month, $count));
        }

        return self::SUCCESS;
    }
}
