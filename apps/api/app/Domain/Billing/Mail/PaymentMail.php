<?php

declare(strict_types=1);

namespace App\Domain\Billing\Mail;

use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Models\Invoice;
use App\Domain\Billing\Models\Payment;
use App\Domain\Billing\Support\Money;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/**
 * A payment email to the owners (spec 029 US7): a `receipt`, a `failed` charge with the
 * card issuer's reason, or a `reminder` on the due date and seven days after. Each links
 * to the invoice in the portal, where it can be paid. It carries plain values.
 */
final class PaymentMail extends Mailable
{
    public function __construct(
        public string $kind,
        public string $accountUuid,
        public string $accountName,
        public string $invoiceUuid,
        public string $invoiceNumber,
        public string $currency,
        public int $amount,
        public ?string $dueAt = null,
        public ?string $reason = null,
        public string $method = Payment::CARD,
    ) {}

    public static function receipt(Invoice $invoice, BillingAccount $account, int $amount): self
    {
        return new self('receipt', $account->uuid, $account->name, $invoice->uuid, (string) $invoice->number, $invoice->currency, $amount);
    }

    /** A charge to the saved card, or a payment on Stripe's page, that failed: worded by `$method`. */
    public static function failed(Invoice $invoice, BillingAccount $account, int $amount, ?string $reason, string $method = Payment::CARD): self
    {
        return new self('failed', $account->uuid, $account->name, $invoice->uuid, (string) $invoice->number, $invoice->currency, $amount,
            $invoice->due_at?->format('j F Y'), $reason, $method);
    }

    public static function reminder(Invoice $invoice, BillingAccount $account): self
    {
        return new self('reminder', $account->uuid, $account->name, $invoice->uuid, (string) $invoice->number, $invoice->currency,
            $invoice->outstanding(), $invoice->due_at?->format('j F Y'));
    }

    public function envelope(): Envelope
    {
        return new Envelope(subject: match ($this->kind) {
            'receipt' => sprintf('Payment received for invoice %s: %s', $this->invoiceNumber, $this->accountName),
            'failed' => sprintf('Payment failed for invoice %s: %s', $this->invoiceNumber, $this->accountName),
            default => sprintf('Invoice %s is due: %s', $this->invoiceNumber, $this->accountName),
        });
    }

    public function content(): Content
    {
        $money = $this->currency.' '.Money::format($this->amount);

        return new Content(text: 'billing.payment', with: [
            'lead' => match ($this->kind) {
                'receipt' => sprintf('We received %s for invoice %s for the billing account %s. Thank you.', $money, $this->invoiceNumber, $this->accountName),
                'failed' => $this->method === Payment::CHECKOUT
                    ? sprintf('Paying %s for invoice %s, for the billing account %s, on Stripe\'s page did not go through.', $money, $this->invoiceNumber, $this->accountName)
                    : sprintf('Charging %s to the saved card for invoice %s, for the billing account %s, failed.', $money, $this->invoiceNumber, $this->accountName),
                default => sprintf('Invoice %s for the billing account %s has %s to pay%s.', $this->invoiceNumber, $this->accountName, $money,
                    $this->dueAt === null ? '' : ', due '.$this->dueAt),
            },
            'reason' => $this->kind === 'failed' ? ($this->reason ?? 'The card issuer gave no reason.') : null,
            'action' => match (true) {
                $this->kind === 'receipt' => 'See the invoice',
                $this->kind === 'failed' && $this->method === Payment::CHECKOUT => 'Pay the invoice',
                default => 'Pay the invoice or update the card',
            },
            'link' => rtrim((string) config('app.frontend_url'), '/').'/billing?account='.$this->accountUuid.'&invoice='.$this->invoiceUuid,
            'footer' => 'You receive this as an owner of this billing account.',
        ]);
    }
}
