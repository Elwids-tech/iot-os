<?php

declare(strict_types=1);

namespace App\Domain\Billing\Mail;

use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Models\CreditNote;
use App\Domain\Billing\Models\Invoice;
use App\Domain\Billing\Services\InvoicePdf;
use App\Domain\Billing\Support\Money;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Attachment;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/**
 * An issued invoice or credit note, in plain text with its PDF attached (spec 029
 * FR-036), to the account's billing contact and each owner. It carries plain values and
 * renders the PDF when sent; issued documents never change, so it cannot go stale.
 */
final class InvoiceDocumentMail extends Mailable
{
    public function __construct(
        public string $document,
        public string $documentUuid,
        public string $number,
        public string $accountUuid,
        public string $accountName,
        public string $invoiceNumber,
        public string $month,
        public string $currency,
        public int $amount,
        public int $amountDue,
        public ?string $dueAt,
    ) {}

    public static function forInvoice(Invoice $invoice, BillingAccount $account): self
    {
        return new self('invoice', $invoice->uuid, (string) $invoice->number, $account->uuid, $account->name, (string) $invoice->number,
            $invoice->month->format('F Y'), $invoice->currency, $invoice->total, $invoice->amount_due, $invoice->due_at?->format('j F Y'));
    }

    public static function forCreditNote(CreditNote $note, Invoice $invoice, BillingAccount $account): self
    {
        return new self('credit_note', $note->uuid, $note->number, $account->uuid, $account->name, (string) $invoice->number,
            $invoice->month->format('F Y'), $invoice->currency, $note->amount, $invoice->outstanding(), null);
    }

    public function envelope(): Envelope
    {
        return new Envelope(subject: $this->document === 'invoice'
            ? sprintf('Invoice %s for %s: %s', $this->number, $this->month, $this->accountName)
            : sprintf('Credit note %s on invoice %s: %s', $this->number, $this->invoiceNumber, $this->accountName));
    }

    public function content(): Content
    {
        $money = fn (int $amount): string => $this->currency.' '.Money::format($amount);

        return new Content(text: 'billing.invoice-document', with: [
            'lead' => $this->document === 'invoice'
                ? sprintf('Invoice %s for the billing account %s, for %s, is attached.', $this->number, $this->accountName, $this->month)
                : sprintf('Credit note %s on invoice %s for the billing account %s is attached.', $this->number, $this->invoiceNumber, $this->accountName),
            'amountLabel' => $this->document === 'invoice' ? 'Total' : 'Credit',
            'amount' => $money($this->amount),
            'due' => $this->amountDue > 0 ? $money($this->amountDue).($this->dueAt === null ? '' : ', due '.$this->dueAt) : 'Nothing',
            'link' => rtrim((string) config('app.frontend_url'), '/').'/billing?account='.$this->accountUuid,
            'footer' => 'You receive this as the billing contact or an owner of this billing account.',
        ]);
    }

    /**
     * @return list<Attachment>
     */
    public function attachments(): array
    {
        return [Attachment::fromData(function (): string {
            $pdf = app(InvoicePdf::class);

            return $this->document === 'invoice'
                ? $pdf->invoice(Invoice::query()->where('uuid', $this->documentUuid)->firstOrFail())
                : $pdf->creditNote(CreditNote::query()->where('uuid', $this->documentUuid)->firstOrFail());
        }, $this->number.'.pdf')->withMime('application/pdf')];
    }
}
