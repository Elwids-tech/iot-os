<?php

declare(strict_types=1);

namespace App\Domain\Billing\Services;

use App\Domain\Audit\Services\ActivityLog;
use App\Domain\Billing\Enums\PaymentStatus;
use App\Domain\Billing\Events\InvoiceIssued;
use App\Domain\Billing\Jobs\ChargeInvoice;
use App\Domain\Billing\Mail\InvoiceDocumentMail;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Models\Invoice;
use App\Domain\Shared\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Issues a draft (spec 029 FR-034, FR-036, research R13). In one transaction it takes the
 * next number from a locked counter row, so numbers have no gaps; snapshots the
 * operator's and the account's details and the tax rate; applies the account's credit
 * after tax; sets the due date; and fixes the invoice for good. After commit the billing
 * contact and each owner get it by email, and an account with a saved card is charged
 * (spec 029 US7).
 */
final class InvoiceIssuer
{
    public function __construct(
        private readonly InvoiceDrafter $drafter,
        private readonly BillingSettings $settings,
        private readonly Notices $notices,
    ) {}

    public function issue(Invoice $invoice, User $actor): Invoice
    {
        $issued = DB::transaction(function () use ($invoice, $actor): Invoice {
            $locked = Invoice::query()->whereKey($invoice->getKey())->lockForUpdate()->firstOrFail();
            abort_if($locked->isIssued(), 409, sprintf('Invoice %s is already issued.', $locked->number));
            // A draft of the running month is a preview: issued now, it would charge days to
            // come and leave the rest of the month's overage off every invoice (FR-031).
            $ends = $locked->month->addMonthNoOverflow();
            abort_if($ends->greaterThan(now()), 409, sprintf(
                '%s has not ended. Its draft is a preview; issue it from %s.',
                $locked->month->format('F Y'),
                $ends->format('j F Y'),
            ));
            // Drafted before the month's usage was final: its lines may lack what came in
            // since, so it is recalculated before it goes out (FR-031, SC-009).
            abort_if($locked->usage_incomplete && $this->drafter->usageFinal($locked->month), 409, sprintf(
                "%s's usage is final now. Recalculate the draft, check it, then issue it.",
                $locked->month->format('F Y'),
            ));
            // The account row serializes its credit: two issues cannot spend it twice.
            $account = BillingAccount::withTrashed()->whereKey($locked->billing_account_id)->lockForUpdate()->firstOrFail();

            $this->drafter->totals($locked, $account);
            if ($locked->total < 0) {
                throw ValidationException::withMessages(['total' => 'The total is below 0. Reduce the credit adjustments; credit beyond a bill is given with a credit note.']);
            }

            $settings = $this->settings->get();
            $next = (int) DB::table('billing_number_sequences')->where('name', 'invoice')->lockForUpdate()->value('next');
            DB::table('billing_number_sequences')->where('name', 'invoice')->update(['next' => $next + 1]);

            if ($locked->credit_applied > 0) {
                DB::table('billing_account_credits')->insert([
                    'billing_account_id' => $account->getKey(),
                    'amount' => -$locked->credit_applied,
                    'invoice_id' => $locked->getKey(),
                    'created_at' => now(),
                ]);
            }

            $locked->forceFill([
                'number' => $settings['invoice_prefix'].str_pad((string) $next, 4, '0', STR_PAD_LEFT),
                'status' => Invoice::ISSUED,
                'operator_details' => [
                    'legal_name' => $settings['legal_name'],
                    'address' => $settings['address'],
                    'tax_registration_number' => $settings['tax_registration_number'],
                    'invoice_footer' => $settings['invoice_footer'],
                ],
                'account_details' => [
                    'name' => $account->name,
                    'contact_email' => $account->contact_email,
                    'billing_address' => $account->billing_address,
                    'tax_number' => $account->tax_number,
                ],
                'issued_by' => $actor->getKey(),
                'issued_at' => now(),
                'due_at' => now()->addDays((int) config('billing.invoice_due_days')),
                'payment_status' => $locked->amount_due === 0 ? PaymentStatus::Paid : PaymentStatus::Pending,
            ])->save();
            ActivityLog::record('billing_invoice.issued', null, $actor, $locked, [
                'billing_account_uuid' => $account->uuid,
                'number' => $locked->number,
                'total' => $locked->total,
                'amount_due' => $locked->amount_due,
            ]);

            return $locked;
        });

        $account = $issued->billingAccount;
        $this->notices->sendWithContact($account, 'invoice_issued', 'invoice:'.$issued->uuid, InvoiceDocumentMail::forInvoice($issued, $account));
        InvoiceIssued::dispatch($issued);
        if (Payments::enabled() && $account->pm_type !== null && $issued->amount_due > 0) {
            ChargeInvoice::dispatch((int) $issued->getKey(), 1);
        }

        return $issued->refresh();
    }
}
