<?php

declare(strict_types=1);

namespace App\Domain\Billing\Jobs;

use App\Domain\Billing\Models\Invoice;
use App\Domain\Billing\Services\Payments;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Charges an issued invoice to its account's saved card (spec 029 US7): attempt 1 at
 * issue, 2 on the due date and 3 seven days after. Stripe's idempotency key per attempt
 * makes a retry safe, and one job per invoice and attempt is queued at a time.
 */
final class ChargeInvoice implements ShouldBeUnique, ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public int $timeout = 60;

    public function __construct(
        public readonly int $invoiceId,
        public readonly int $attempt,
    ) {
        $this->onConnection('database')->onQueue('default');
    }

    public function uniqueId(): string
    {
        return $this->invoiceId.':'.$this->attempt;
    }

    /**
     * @return list<int>
     */
    public function backoff(): array
    {
        return [60, 600];
    }

    public function handle(Payments $payments): void
    {
        $invoice = Invoice::query()->find($this->invoiceId);

        if ($invoice !== null) {
            $payments->charge($invoice, $this->attempt);
        }
    }
}
