<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Resources;

use App\Domain\Billing\Enums\InvoiceLineKind;
use App\Domain\Billing\Models\InvoiceLine;
use App\Domain\Billing\Models\Payment;
use App\Domain\Billing\Services\InvoiceDrafter;
use App\Domain\Billing\Services\InvoiceHistory;
use App\Domain\Billing\Services\InvoicePdf;
use Illuminate\Http\Request;

/**
 * An invoice with its lines, each organization's usage and its credit notes (spec 029
 * FR-032). Issued invoices carry the details they were issued with; a draft shows the
 * account's and operator's details as they are now. `owner` leaves out what is for
 * administrators only: the reason for drafting early, adjustment and payment notes, and
 * the history.
 */
final class InvoiceDetailResource extends InvoiceResource
{
    public bool $owner = false;

    public function forOwner(): self
    {
        $this->owner = true;

        return $this;
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $invoice = $this->resource;
        $account = $invoice->billingAccount;

        return [
            ...parent::toArray($request),
            'draft_note' => $this->owner || $invoice->draft_note === null ? null : (string) $invoice->draft_note,
            /** The runtime has reported the month's usage to its end; a draft marked incomplete is recalculated before it is issued. */
            'usage_final' => (bool) app(InvoiceDrafter::class)->usageFinal($invoice->month),
            'tax_rate_name' => $invoice->tax_rate_name === null ? null : (string) $invoice->tax_rate_name,
            'tax_basis_points' => $invoice->tax_basis_points === null ? null : (int) $invoice->tax_basis_points,
            /**
             * The operator's details as issued; null on a draft.
             *
             * @var array{legal_name: string|null, address: string|null, tax_registration_number: string|null, invoice_footer: string|null}|null
             */
            'operator_details' => $invoice->operator_details,
            /** @var array{name: string, contact_email: string|null, billing_address: string|null, tax_number: string|null} */
            'account_details' => $invoice->account_details ?? [
                'name' => (string) $account->name,
                'contact_email' => $account->contact_email,
                'billing_address' => $account->billing_address,
                'tax_number' => $account->tax_number,
            ],
            /** @var list<array{id: int, position: int, kind: 'base_price'|'trial'|'alert_overage'|'data_point_overage'|'adjustment'|'credit', description: string, quantity: float, unit_price: int|null, amount: int, period_start: string|null, period_end: string|null, note: string|null}> */
            'lines' => $invoice->lines->map(fn (InvoiceLine $line): array => [
                'id' => (int) $line->getKey(),
                'position' => (int) $line->position,
                'kind' => $line->kind->value,
                'description' => (string) $line->description,
                'quantity' => (float) $line->quantity,
                'unit_price' => $line->unit_price === null ? null : (int) $line->unit_price,
                'amount' => (int) $line->amount,
                'period_start' => $line->period_start?->toDateString(),
                'period_end' => $line->period_end?->toDateString(),
                'note' => $line->note === null || ($this->owner && $line->kind === InvoiceLineKind::Adjustment) ? null : (string) $line->note,
            ])->values()->all(),
            /** @var list<array{organization_uuid: string, organization_name: string, kind: 'alerts'|'sms'|'data_points', count: int}> */
            'usage' => array_map(fn (object $row): array => [
                'organization_uuid' => (string) $row->organization_uuid,
                'organization_name' => (string) $row->organization_name,
                'kind' => (string) $row->kind,
                'count' => (int) $row->count,
            ], app(InvoicePdf::class)->usage($invoice)),
            'credit_notes' => CreditNoteResource::collection($invoice->creditNotes),
            /**
             * Card charges, Checkout payments and payments recorded by hand, oldest first (spec 029 US7).
             *
             * @var list<array{uuid: string, method: 'card'|'checkout'|'outside', amount: int, attempt: int, status: 'pending'|'succeeded'|'failed', failure_reason: string|null, note: string|null, at: string}>
             */
            'payments' => $invoice->payments->map(fn (Payment $payment): array => [
                'uuid' => (string) $payment->uuid,
                'method' => (string) $payment->method,
                'amount' => (int) $payment->amount,
                'attempt' => (int) $payment->attempt,
                'status' => (string) $payment->status,
                'failure_reason' => $payment->failure_reason === null ? null : (string) $payment->failure_reason,
                'note' => $this->owner || $payment->note === null ? null : (string) $payment->note,
                'at' => $payment->status_at->toIso8601String(),
            ])->values()->all(),
            /**
             * Drafting, adjustments, issuing, credit notes and payments, newest first; empty for owners.
             *
             * @var list<array{at: string, action: 'drafted'|'recalculated'|'adjustment_added'|'adjustment_removed'|'issued'|'credit_note_issued'|'payment_recorded'|'payment_succeeded'|'payment_failed'|'payment_amount_mismatch'|'overpaid', actor: array{id: int, name: string}|null, description: string|null, amount: int|null, note: string|null, number: string|null}>
             */
            'history' => $this->owner ? [] : app(InvoiceHistory::class)->for($invoice),
        ];
    }
}
