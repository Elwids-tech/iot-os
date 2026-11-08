<?php

declare(strict_types=1);

namespace App\Domain\Billing\Console;

use App\Domain\Billing\Enums\PaymentStatus;
use App\Domain\Billing\Jobs\ChargeInvoice;
use App\Domain\Billing\Mail\PaymentMail;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Models\Invoice;
use App\Domain\Billing\Services\Notices;
use App\Domain\Billing\Services\Payments;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Database\Eloquent\Collection;

/**
 * Follows up unpaid invoices (spec 029 US7, FR-042, FR-043). On an invoice's due date and
 * seven days after, its owners get a reminder and a saved card is charged again
 * (attempts 2 and 3); each step happens once, even when a day is missed. Accounts with an
 * invoice unpaid past its due date are flagged past due, and the flag clears once none
 * is. Nothing else changes for the account's organizations.
 */
final class PaymentReminders extends Command
{
    protected $signature = 'billing:payment-reminders {--now= : Run as of this time instead of now}';

    protected $description = 'Remind owners of unpaid invoices on their due date and 7 days after, charge saved cards again, and flag accounts past due';

    public function handle(Payments $payments, Notices $notices): int
    {
        $now = $this->option('now') ? CarbonImmutable::parse((string) $this->option('now')) : CarbonImmutable::now();
        $today = $now->utc()->toDateString();
        $reminded = 0;
        $charged = 0;

        Invoice::query()
            ->where('status', Invoice::ISSUED)
            ->whereIn('payment_status', [PaymentStatus::Pending->value, PaymentStatus::Failed->value])
            ->whereNotNull('due_at')
            ->whereDate('due_at', '<=', $today)
            ->with('billingAccount')
            ->chunkById(200, function (Collection $invoices) use ($notices, $today, &$reminded, &$charged): void {
                foreach ($invoices as $invoice) {
                    /** @var Invoice $invoice */
                    if ($invoice->outstanding() <= 0) {
                        continue;
                    }

                    [$step, $attempt] = $invoice->due_at->utc()->addDays(7)->toDateString() <= $today ? ['due+7', 3] : ['due', 2];
                    $account = $invoice->billingAccount;
                    if ($notices->send($account, 'payment_reminder', 'invoice:'.$invoice->uuid.':'.$step, PaymentMail::reminder($invoice, $account))) {
                        $reminded++;
                    }

                    if (Payments::enabled() && $account->pm_type !== null && ! $invoice->payments()->where('attempt', '>=', $attempt)->exists()) {
                        ChargeInvoice::dispatch((int) $invoice->getKey(), $attempt);
                        $charged++;
                    }
                }
            });

        $flagged = BillingAccount::query()
            ->where(fn ($query) => $query
                ->whereNotNull('past_due_since')
                ->orWhereHas('invoices', fn ($query) => $query
                    ->where('status', Invoice::ISSUED)
                    ->whereIn('payment_status', [PaymentStatus::Pending->value, PaymentStatus::Failed->value])
                    ->where('due_at', '<', $now)))
            ->get()
            ->each(fn (BillingAccount $account) => $payments->refreshPastDue($account, $now))
            ->filter(fn (BillingAccount $account): bool => $account->past_due_since !== null)
            ->count();

        $this->info("Sent {$reminded} payment reminders, queued {$charged} card charges; {$flagged} billing accounts are past due.");

        return self::SUCCESS;
    }
}
