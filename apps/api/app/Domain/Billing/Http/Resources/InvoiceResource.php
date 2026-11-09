<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Resources;

use App\Domain\Billing\Models\Invoice;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * An invoice in a list (spec 029 US6). Amounts are integers in the minor units of
 * `currency`; `outstanding` is what is still owed after credit notes and payment.
 *
 * @extends JsonResource<Invoice>
 */
class InvoiceResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'uuid' => (string) $this->resource->uuid,
            'number' => $this->resource->number === null ? null : (string) $this->resource->number,
            /** @var 'draft'|'issued' */
            'status' => (string) $this->resource->status,
            /** The first day of the UTC month, `YYYY-MM-DD`. */
            'month' => $this->resource->month->toDateString(),
            'billing_account' => ['uuid' => (string) $this->resource->billingAccount->uuid, 'name' => (string) $this->resource->billingAccount->name],
            'usage_incomplete' => (bool) $this->resource->usage_incomplete,
            'currency' => (string) $this->resource->currency,
            'subtotal' => (int) $this->resource->subtotal,
            'tax' => (int) $this->resource->tax,
            'total' => (int) $this->resource->total,
            'credit_applied' => (int) $this->resource->credit_applied,
            'amount_due' => (int) $this->resource->amount_due,
            'outstanding' => $this->resource->isIssued() ? $this->resource->outstanding() : (int) $this->resource->amount_due,
            'due_at' => $this->resource->due_at?->toIso8601String(),
            /** @var 'pending'|'paid'|'failed'|'credited'|'paid_outside' */
            'payment_status' => $this->resource->payment_status->value,
            /** A card or Checkout payment is still being processed: nothing more can be paid until Stripe answers. */
            'payment_processing' => (bool) $this->resource->paymentProcessing(),
            'drafted_at' => $this->resource->drafted_at->toIso8601String(),
            'issued_at' => $this->resource->issued_at?->toIso8601String(),
        ];
    }
}
