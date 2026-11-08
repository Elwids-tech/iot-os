<?php

declare(strict_types=1);

namespace App\Domain\Billing\Events;

use App\Domain\Billing\Models\Invoice;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * An invoice was issued and committed (spec 029 FR-036, FR-040). Card payments (PR 11)
 * listen to charge the account's payment method; nothing listens before that.
 */
final class InvoiceIssued
{
    use Dispatchable;

    public function __construct(public readonly Invoice $invoice) {}
}
