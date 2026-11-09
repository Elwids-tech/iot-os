<?php

declare(strict_types=1);

namespace App\Domain\Billing\Services;

use App\Domain\Audit\Services\ActivityLog;
use App\Domain\Billing\Enums\PaymentStatus;
use App\Domain\Billing\Mail\PaymentMail;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Models\Invoice;
use App\Domain\Billing\Models\Payment;
use App\Domain\Billing\Support\Money;
use App\Domain\Shared\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Laravel\Cashier\Cashier;
use Stripe\Exception\ApiErrorException;
use Stripe\Exception\CardException;

/**
 * Card payments through Stripe (spec 029 US7, ADR-037, contracts/stripe-webhooks.md).
 * Owners save a card and pay on Stripe's Checkout pages, so card numbers never reach the
 * platform; the account keeps the brand, last four digits and expiry. Issued invoices are
 * charged off-session with one idempotency key per attempt. A payment's status only moves
 * forward, an invoice is paid once its payments cover what credit notes left, and nothing
 * is ever restricted when payment fails (FR-043).
 */
final class Payments
{
    /** How long Stripe's search may take to show a new PaymentIntent. */
    private const SEARCH_LAG_MINUTES = 10;

    /** How long an invoice's Checkout page stays open: Stripe's minimum. */
    private const CHECKOUT_MINUTES = 30;

    public function __construct(
        private readonly Notices $notices,
        private readonly Trials $trials,
    ) {}

    /** Payments are on with Stripe's secret and webhook secret both set (FR-045). */
    public static function enabled(): bool
    {
        return filled(config('cashier.secret')) && filled(config('cashier.webhook.secret'));
    }

    /** A Stripe Checkout page in setup mode where an owner saves a card. */
    public function checkoutForPaymentMethod(BillingAccount $account): string
    {
        $this->customer($account);
        $session = Cashier::stripe()->checkout->sessions->create([
            'mode' => 'setup',
            'customer' => $account->stripe_id,
            'payment_method_types' => ['card'],
            'metadata' => ['billing_account_uuid' => $account->uuid],
            'success_url' => $this->portal($account, ['card' => 'saved']),
            'cancel_url' => $this->portal($account),
        ]);

        return (string) $session->url;
    }

    /**
     * A Stripe Checkout page that pays what is still owed on an issued invoice. It expires
     * after Stripe's minimum of 30 minutes, and is expired sooner once another payment for
     * the invoice starts or settles it (`expireCheckouts`).
     */
    public function checkoutForInvoice(Invoice $invoice): string
    {
        $owed = $invoice->outstanding();
        abort_if($owed <= 0, 409, sprintf('Nothing is owed on invoice %s.', $invoice->number));
        abort_if($invoice->payments()->where('status', Payment::PENDING)->exists(), 409, sprintf('A payment for invoice %s is still being processed.', $invoice->number));

        $account = $invoice->billingAccount;
        $this->customer($account);
        $session = Cashier::stripe()->checkout->sessions->create([
            'mode' => 'payment',
            'customer' => $account->stripe_id,
            'line_items' => [[
                'quantity' => 1,
                'price_data' => [
                    'currency' => config('cashier.currency'),
                    'unit_amount' => $owed,
                    'product_data' => ['name' => 'Invoice '.$invoice->number],
                ],
            ]],
            'metadata' => ['invoice_uuid' => $invoice->uuid],
            'payment_intent_data' => ['metadata' => ['invoice_uuid' => $invoice->uuid, 'method' => Payment::CHECKOUT]],
            'expires_at' => now()->addMinutes(self::CHECKOUT_MINUTES)->getTimestamp(),
            'success_url' => $this->portal($account, ['invoice' => $invoice->uuid, 'paid' => '1']),
            'cancel_url' => $this->portal($account, ['invoice' => $invoice->uuid]),
        ]);

        return (string) $session->url;
    }

    /** Detaches the saved card from the Stripe customer and forgets it. */
    public function removePaymentMethod(BillingAccount $account, User $actor): void
    {
        $default = $this->defaultPaymentMethodId($account);
        if ($default !== null) {
            Cashier::stripe()->paymentMethods->detach($default);
        }

        $account->forceFill(['pm_type' => null, 'pm_last_four' => null, 'pm_expires' => null])->save();
        ActivityLog::record('billing_account.payment_method_removed', null, $actor, $account);
    }

    /**
     * Stripe's `checkout.session.completed`: a card saved in setup mode becomes the
     * customer's default, replacing the old one; a paid session records its payment.
     *
     * @param  array<string, mixed>  $session
     */
    public function completedCheckout(array $session): void
    {
        if (($session['mode'] ?? null) === 'setup') {
            $account = BillingAccount::query()->where('uuid', (string) ($session['metadata']['billing_account_uuid'] ?? ''))->first();
            if ($account === null || ! is_string($session['setup_intent'] ?? null)) {
                return;
            }
            if ($account->stripe_id === null && is_string($session['customer'] ?? null)) {
                $account->forceFill(['stripe_id' => $session['customer']])->save();
            }
            $this->savePaymentMethod($account, $session['setup_intent']);

            return;
        }

        if (($session['mode'] ?? null) === 'payment' && ($session['payment_status'] ?? null) === 'paid' && is_string($session['payment_intent'] ?? null)) {
            $this->applyIntent([
                'id' => $session['payment_intent'],
                'status' => 'succeeded',
                'amount' => (int) ($session['amount_total'] ?? 0),
                'amount_received' => (int) ($session['amount_total'] ?? 0),
                'metadata' => ['invoice_uuid' => $session['metadata']['invoice_uuid'] ?? null, 'method' => Payment::CHECKOUT],
            ]);
        }
    }

    /**
     * Stripe's `payment_method.detached`: the stored card is forgotten once the customer
     * has no default left, for a card removed on Stripe's side.
     *
     * @param  array<string, mixed>  $method
     * @param  array<string, mixed>  $previous
     */
    public function detached(array $method, array $previous): void
    {
        $customer = $previous['customer'] ?? $method['customer'] ?? null;
        $account = is_string($customer) ? BillingAccount::query()->where('stripe_id', $customer)->first() : null;

        if ($account !== null && $account->pm_type !== null && $this->defaultPaymentMethodId($account) === null) {
            $account->forceFill(['pm_type' => null, 'pm_last_four' => null, 'pm_expires' => null])->save();
            ActivityLog::record('billing_account.payment_method_removed', null, null, $account);
        }
    }

    /**
     * Charges what is still owed on an issued invoice to the saved card, off-session
     * (`ChargeInvoice`): attempt 1 at issue, 2 on the due date, 3 seven days after. The
     * pending payment is recorded before Stripe is asked, with the attempt's idempotency
     * key, so a charge whose answer is lost still blocks the next attempt and **Check with
     * Stripe** finds it; a retried job sends the same request again and Stripe answers
     * with what it did the first time. A decline answers at once and fails the payment.
     */
    public function charge(Invoice $invoice, int $attempt): ?Payment
    {
        $account = $invoice->billingAccount;
        if (! self::enabled() || $account->pm_type === null) {
            return null;
        }

        $method = $this->defaultPaymentMethodId($account);
        if ($method === null) {
            return null;
        }

        $payment = DB::transaction(function () use ($invoice, $attempt): ?Payment {
            $locked = Invoice::query()->whereKey($invoice->getKey())->lockForUpdate()->firstOrFail();
            $owed = $locked->outstanding();
            $pending = $locked->payments()->where('status', Payment::PENDING)->first();
            if ($pending !== null) {
                // Only this attempt's own charge, with its answer lost, is sent again.
                return $pending->method === Payment::CARD && $pending->attempt === $attempt && $pending->provider_reference === null ? $pending : null;
            }
            if (! $locked->isIssued() || $owed <= 0 || $locked->payments()->where('method', Payment::CARD)->where('attempt', $attempt)->exists()) {
                return null;
            }

            return Payment::query()->create([
                'invoice_id' => $locked->getKey(),
                'amount' => $owed,
                'method' => Payment::CARD,
                'attempt' => $attempt,
                'status' => Payment::PENDING,
                'status_at' => now(),
            ]);
        });
        if ($payment === null) {
            return null;
        }
        $this->expireCheckouts($invoice);

        try {
            $intent = Cashier::stripe()->paymentIntents->create([
                'amount' => $payment->amount,
                'currency' => config('cashier.currency'),
                'customer' => $account->stripe_id,
                'payment_method' => $method,
                'off_session' => true,
                'confirm' => true,
                'description' => 'Invoice '.$invoice->number,
                'metadata' => ['invoice_uuid' => $invoice->uuid, 'method' => Payment::CARD, 'attempt' => $attempt, 'payment_uuid' => $payment->uuid],
            ], ['idempotency_key' => self::idempotencyKey($invoice, $attempt)])->toArray();
        } catch (CardException $exception) {
            $intent = $exception->getJsonBody()['error']['payment_intent'] ?? null;
            if (! is_array($intent)) {
                throw $exception;
            }
        }

        $payment->forceFill(['provider_reference' => (string) $intent['id']])->save();

        return $this->applyIntent($intent);
    }

    /** One key per invoice and attempt, so Stripe charges each attempt once. */
    public static function idempotencyKey(Invoice $invoice, int $attempt): string
    {
        return sprintf('invoice:%s:%d', $invoice->uuid, $attempt);
    }

    /**
     * Applies a PaymentIntent's state to its payment, creating the payment from the
     * intent's metadata when Stripe's event comes first. Status only moves forward.
     *
     * @param  array<string, mixed>  $intent
     */
    public function applyIntent(array $intent): ?Payment
    {
        $status = match ($intent['status'] ?? null) {
            'succeeded' => Payment::SUCCEEDED,
            'requires_payment_method', 'canceled' => Payment::FAILED,
            default => Payment::PENDING,
        };

        return DB::transaction(function () use ($intent, $status): ?Payment {
            $payment = Payment::query()->where('provider_reference', (string) $intent['id'])->lockForUpdate()->first();
            // A charge recorded before Stripe answered carries the payment's uuid.
            if ($payment === null && is_string($intent['metadata']['payment_uuid'] ?? null)) {
                $payment = Payment::query()->where('uuid', $intent['metadata']['payment_uuid'])->whereNull('provider_reference')->lockForUpdate()->first();
                $payment?->forceFill(['provider_reference' => (string) $intent['id']])->save();
            }

            if ($payment === null) {
                $invoice = Invoice::query()->where('uuid', (string) ($intent['metadata']['invoice_uuid'] ?? ''))->where('status', Invoice::ISSUED)->first();
                if ($invoice === null) {
                    return null;
                }
                $method = $intent['metadata']['method'] ?? null;
                $payment = Payment::query()->create([
                    'invoice_id' => $invoice->getKey(),
                    'amount' => (int) ($intent['amount'] ?? 0),
                    'method' => in_array($method, [Payment::CARD, Payment::CHECKOUT], true) ? $method : Payment::CARD,
                    'provider_reference' => (string) $intent['id'],
                    'attempt' => (int) ($intent['metadata']['attempt'] ?? 0),
                    'status' => Payment::PENDING,
                    'status_at' => now(),
                ]);
            }

            if ($status !== Payment::PENDING && $payment->canMoveTo($status)) {
                $status === Payment::SUCCEEDED
                    ? $this->succeeded($payment, (int) ($intent['amount_received'] ?? $intent['amount'] ?? $payment->amount))
                    : $this->failed($payment, $intent['last_payment_error']['message'] ?? null);
            }

            return $payment;
        });
    }

    /**
     * A payment an administrator recorded as made another way (FR-044). Owners get a
     * receipt, as for every payment that succeeds (FR-042).
     */
    public function recordOutside(Invoice $invoice, int $amount, ?string $note, User $actor): Payment
    {
        return DB::transaction(function () use ($invoice, $amount, $note, $actor): Payment {
            $locked = Invoice::query()->whereKey($invoice->getKey())->lockForUpdate()->firstOrFail();
            abort_unless($locked->isIssued(), 409, 'Only an issued invoice takes payments.');
            $owed = $locked->outstanding();
            if ($amount < 1 || $amount > $owed) {
                throw ValidationException::withMessages(['amount' => $owed > 0
                    ? sprintf('Enter an amount above 0 and up to %s, what is still owed.', Money::format($owed))
                    : 'Nothing is owed on this invoice.']);
            }

            $payment = Payment::query()->create([
                'invoice_id' => $locked->getKey(),
                'amount' => $amount,
                'method' => Payment::OUTSIDE,
                'status' => Payment::SUCCEEDED,
                'note' => $note,
                'recorded_by' => $actor->getKey(),
                'status_at' => now(),
            ]);
            $this->settle($locked);
            ActivityLog::record('billing_invoice.payment_recorded', null, $actor, $locked, ['amount' => $amount, 'note' => $note]);
            $this->notices->send($locked->billingAccount, 'receipt', 'payment:'.$payment->uuid, PaymentMail::receipt($locked, $locked->billingAccount, $amount));

            return $payment;
        });
    }

    /**
     * Asks Stripe for each pending payment's PaymentIntent and applies what it says. A
     * card charge whose answer was lost is looked up by the payment's uuid; once Stripe's
     * search has had time to see it, finding none means the card was never charged, and
     * the payment fails so the invoice can be paid.
     */
    public function reconcile(Invoice $invoice): void
    {
        foreach ($invoice->payments()->where('status', Payment::PENDING)->where('method', '!=', Payment::OUTSIDE)->get() as $payment) {
            if ($payment->provider_reference !== null) {
                $this->applyIntent(Cashier::stripe()->paymentIntents->retrieve($payment->provider_reference)->toArray());

                continue;
            }

            $found = Cashier::stripe()->paymentIntents->search(['query' => sprintf("metadata['payment_uuid']:'%s'", $payment->uuid), 'limit' => 1])->data[0] ?? null;
            if ($found !== null) {
                $this->applyIntent($found->toArray());
            } elseif ($payment->created_at->lessThan(now()->subMinutes(self::SEARCH_LAG_MINUTES))) {
                DB::transaction(function () use ($payment): void {
                    $locked = Payment::query()->whereKey($payment->getKey())->whereNull('provider_reference')->lockForUpdate()->first();
                    if ($locked?->status === Payment::PENDING) {
                        $this->failed($locked, 'The charge never reached Stripe; the card was not charged.');
                    }
                });
            }
        }
    }

    /**
     * Flags the account past due from the first day one of its invoices is unpaid after
     * its due date, and clears the flag once none is (FR-043). Nothing else changes.
     */
    public function refreshPastDue(BillingAccount $account, ?CarbonImmutable $now = null): void
    {
        $now ??= CarbonImmutable::now();
        $overdue = $account->invoices()
            ->where('status', Invoice::ISSUED)
            ->whereIn('payment_status', [PaymentStatus::Pending->value, PaymentStatus::Failed->value])
            ->where('due_at', '<', $now)
            ->get()
            ->contains(fn (Invoice $invoice): bool => $invoice->outstanding() > 0);

        if ($overdue && $account->past_due_since === null) {
            $account->forceFill(['past_due_since' => $now])->save();
        } elseif (! $overdue && $account->past_due_since !== null) {
            $account->forceFill(['past_due_since' => null])->save();
        }
    }

    /** Saves a completed setup's card as the customer's default, detaching the old one. */
    private function savePaymentMethod(BillingAccount $account, string $setupIntent): void
    {
        $stripe = Cashier::stripe();
        $method = $stripe->setupIntents->retrieve($setupIntent, ['expand' => ['payment_method']])->toArray()['payment_method'] ?? null;
        if (! is_array($method) || ! isset($method['id'])) {
            return;
        }

        $old = $this->defaultPaymentMethodId($account);
        $stripe->customers->update((string) $account->stripe_id, ['invoice_settings' => ['default_payment_method' => $method['id']]]);
        if ($old !== null && $old !== $method['id']) {
            $stripe->paymentMethods->detach($old);
        }

        $card = $method['card'] ?? null;
        $account->forceFill([
            'pm_type' => (string) ($card['brand'] ?? $method['type'] ?? 'card'),
            'pm_last_four' => isset($card['last4']) ? (string) $card['last4'] : null,
            'pm_expires' => isset($card['exp_year'], $card['exp_month']) ? sprintf('%04d-%02d', $card['exp_year'], $card['exp_month']) : null,
        ])->save();
        ActivityLog::record('billing_account.payment_method_changed', null, null, $account, ['brand' => $account->pm_type, 'last_four' => $account->pm_last_four]);
        $this->trials->paymentMethodAdded($account);
    }

    private function succeeded(Payment $payment, int $received): void
    {
        $invoice = Invoice::query()->whereKey($payment->invoice_id)->lockForUpdate()->firstOrFail();
        $account = $invoice->billingAccount;
        // What was still owed before this payment. Anything beyond it was paid twice: a
        // Checkout page completed late, or a credit note or payment recorded while this one
        // was pending. It becomes account credit for the next invoice (FR-035, FR-040).
        $owed = $invoice->outstanding();

        // A different amount is kept as received and left for an administrator to review.
        if ($received !== $payment->amount) {
            ActivityLog::record('billing_invoice.payment_amount_mismatch', null, null, $invoice, ['expected' => $payment->amount, 'received' => $received]);
        }
        $payment->forceFill(['status' => Payment::SUCCEEDED, 'amount' => $received, 'failure_reason' => null, 'status_at' => now()])->save();
        if ($received > $owed) {
            DB::table('billing_account_credits')->insert([
                'billing_account_id' => $account->getKey(),
                'amount' => $received - $owed,
                'invoice_id' => $invoice->getKey(),
                'created_at' => now(),
            ]);
            ActivityLog::record('billing_invoice.overpaid', null, null, $invoice, ['amount' => $received - $owed, 'method' => $payment->method]);
        }
        $this->settle($invoice);
        ActivityLog::record('billing_invoice.payment_succeeded', null, null, $invoice, ['amount' => $received, 'method' => $payment->method]);
        $this->notices->send($account, 'receipt', 'payment:'.$payment->uuid, PaymentMail::receipt($invoice, $account, $received));
    }

    private function failed(Payment $payment, ?string $reason): void
    {
        $invoice = Invoice::query()->whereKey($payment->invoice_id)->lockForUpdate()->firstOrFail();
        $account = $invoice->billingAccount;

        $payment->forceFill(['status' => Payment::FAILED, 'failure_reason' => $reason, 'status_at' => now()])->save();
        if (! in_array($invoice->payment_status, [PaymentStatus::Paid, PaymentStatus::PaidOutside, PaymentStatus::Credited], true)) {
            $invoice->forceFill(['payment_status' => PaymentStatus::Failed])->save();
        }
        ActivityLog::record('billing_invoice.payment_failed', null, null, $invoice, ['amount' => $payment->amount, 'reason' => $reason]);
        $this->notices->send($account, 'payment_failed', 'payment:'.$payment->uuid, PaymentMail::failed($invoice, $account, $payment->amount, $reason, $payment->method));
    }

    /**
     * Marks the invoice paid once its payments cover what credit notes left, and closes
     * its open Checkout pages. One already settled, credited included, keeps its status.
     */
    private function settle(Invoice $invoice): void
    {
        if (! in_array($invoice->payment_status, [PaymentStatus::Paid, PaymentStatus::PaidOutside, PaymentStatus::Credited], true)
            && $invoice->amount_due - (int) $invoice->creditNotes()->sum('applied') - $invoice->paid() <= 0) {
            $last = $invoice->payments()->where('status', Payment::SUCCEEDED)->reorder()->latest('status_at')->latest('id')->first();
            $invoice->forceFill(['payment_status' => $last?->method === Payment::OUTSIDE ? PaymentStatus::PaidOutside : PaymentStatus::Paid])->save();
        }
        if ($invoice->outstanding() <= 0) {
            DB::afterCommit(fn () => $this->expireCheckouts($invoice));
        }

        $this->refreshPastDue($invoice->billingAccount);
    }

    /**
     * Expires the invoice's Checkout pages still open, so a page left open cannot pay it a
     * second time (FR-040). A Stripe error here leaves them to expire on their own.
     */
    public function expireCheckouts(Invoice $invoice): void
    {
        $customer = $invoice->billingAccount->stripe_id;
        if (! self::enabled() || $customer === null) {
            return;
        }

        try {
            $sessions = Cashier::stripe()->checkout->sessions->all(['customer' => $customer, 'status' => 'open', 'limit' => 100]);
            foreach ($sessions->data as $session) {
                if (($session->metadata['invoice_uuid'] ?? null) === $invoice->uuid) {
                    Cashier::stripe()->checkout->sessions->expire($session->id);
                }
            }
        } catch (ApiErrorException $exception) {
            report($exception);
        }
    }

    private function customer(BillingAccount $account): void
    {
        $account->createOrGetStripeCustomer(['metadata' => ['billing_account_uuid' => $account->uuid]]);
    }

    private function defaultPaymentMethodId(BillingAccount $account): ?string
    {
        if ($account->stripe_id === null) {
            return null;
        }

        $default = Cashier::stripe()->customers->retrieve($account->stripe_id)->toArray()['invoice_settings']['default_payment_method'] ?? null;

        return is_array($default) ? ($default['id'] ?? null) : (is_string($default) ? $default : null);
    }

    /**
     * @param  array<string, string>  $parameters
     */
    private function portal(BillingAccount $account, array $parameters = []): string
    {
        return rtrim((string) config('app.frontend_url'), '/').'/billing?'.http_build_query(['account' => $account->uuid, ...$parameters]);
    }
}
