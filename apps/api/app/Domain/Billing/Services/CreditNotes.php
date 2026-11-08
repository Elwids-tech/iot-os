<?php

declare(strict_types=1);

namespace App\Domain\Billing\Services;

use App\Domain\Audit\Services\ActivityLog;
use App\Domain\Billing\Enums\PaymentStatus;
use App\Domain\Billing\Mail\InvoiceDocumentMail;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Models\CreditNote;
use App\Domain\Billing\Models\Invoice;
use App\Domain\Billing\Support\Money;
use App\Domain\Shared\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Credit notes against issued invoices (spec 029 FR-035, research R14), numbered in their
 * own unbroken sequence. A credit note takes what it can off what the invoice still
 * owes; the rest becomes account credit for the next invoice. The invoice itself never
 * changes, except that it reads `credited` once nothing is left to pay.
 */
final class CreditNotes
{
    public function __construct(
        private readonly BillingSettings $settings,
        private readonly Notices $notices,
    ) {}

    public function issue(Invoice $invoice, int $amount, string $reason, User $actor): CreditNote
    {
        $note = DB::transaction(function () use ($invoice, $amount, $reason, $actor): CreditNote {
            $locked = Invoice::query()->whereKey($invoice->getKey())->lockForUpdate()->firstOrFail();
            abort_unless($locked->isIssued(), 409, 'Only an issued invoice can have a credit note. Adjust the draft instead.');
            BillingAccount::withTrashed()->whereKey($locked->billing_account_id)->lockForUpdate()->firstOrFail();

            $creditable = $locked->total - (int) $locked->creditNotes()->sum('amount');
            if ($amount < 1 || $amount > $creditable) {
                throw ValidationException::withMessages(['amount' => sprintf(
                    'Enter an amount above 0 and up to %s, the part of the invoice not yet credited.',
                    Money::format(max(0, $creditable)),
                )]);
            }

            $outstanding = $locked->outstanding();
            $applied = min($amount, $outstanding);
            $next = (int) DB::table('billing_number_sequences')->where('name', 'credit_note')->lockForUpdate()->value('next');
            DB::table('billing_number_sequences')->where('name', 'credit_note')->update(['next' => $next + 1]);

            $note = $locked->creditNotes()->create([
                'number' => $this->settings->get()['credit_note_prefix'].str_pad((string) $next, 4, '0', STR_PAD_LEFT),
                'amount' => $amount,
                'applied' => $applied,
                'reason' => $reason,
                'issued_by' => $actor->getKey(),
                'issued_at' => now(),
            ]);
            if ($amount > $applied) {
                DB::table('billing_account_credits')->insert([
                    'billing_account_id' => $locked->billing_account_id,
                    'amount' => $amount - $applied,
                    'credit_note_id' => $note->getKey(),
                    'created_at' => now(),
                ]);
            }
            if ($applied > 0 && $applied === $outstanding) {
                $locked->forceFill(['payment_status' => PaymentStatus::Credited])->save();
            }
            ActivityLog::record('billing_credit_note.issued', null, $actor, $note, [
                'invoice_uuid' => $locked->uuid,
                'invoice_number' => $locked->number,
                'amount' => $amount,
                'applied' => $applied,
                'reason' => $reason,
            ]);

            return $note;
        });

        $invoice = $note->invoice;
        $account = $invoice->billingAccount;
        $this->notices->sendWithContact($account, 'credit_note_issued', 'credit_note:'.$note->uuid, InvoiceDocumentMail::forCreditNote($note, $invoice, $account));

        return $note;
    }
}
