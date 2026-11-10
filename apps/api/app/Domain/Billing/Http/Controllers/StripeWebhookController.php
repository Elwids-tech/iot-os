<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Controllers;

use App\Domain\Billing\Services\Payments;
use Illuminate\Http\Request;
use Laravel\Cashier\Http\Controllers\WebhookController;
use Symfony\Component\HttpFoundation\Response;

/**
 * `POST /api/stripe/webhook` (spec 029 FR-041). Cashier verifies the `Stripe-Signature`
 * header against `STRIPE_WEBHOOK_SECRET` and answers 403 otherwise; `StripeEvents`
 * handles what arrives. While payments are off the route answers 404. Cashier's
 * subscription and customer handlers are switched off: billing accounts keep no
 * Cashier subscriptions.
 */
final class StripeWebhookController extends WebhookController
{
    /**
     * Stripe's event: `id`, `type` and `data.object`, signed in the `Stripe-Signature` header.
     */
    public function handleWebhook(Request $request): Response
    {
        abort_unless(Payments::enabled(), 404);

        return parent::handleWebhook($request);
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    protected function handleCustomerSubscriptionCreated(array $payload): Response
    {
        return $this->successMethod();
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    protected function handleCustomerSubscriptionUpdated(array $payload): Response
    {
        return $this->successMethod();
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    protected function handleCustomerSubscriptionDeleted(array $payload): Response
    {
        return $this->successMethod();
    }

    /**
     * The card on file changes only through `Payments`, which audits it; Cashier would
     * rewrite or clear it from the customer's default payment method.
     *
     * @param  array<string, mixed>  $payload
     */
    protected function handleCustomerUpdated(array $payload): Response
    {
        return $this->successMethod();
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    protected function handleCustomerDeleted(array $payload): Response
    {
        return $this->successMethod();
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    protected function handlePaymentMethodAutomaticallyUpdated(array $payload): Response
    {
        return $this->successMethod();
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    protected function handleInvoicePaymentActionRequired(array $payload): Response
    {
        return $this->successMethod();
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    protected function handleInvoicePaymentSucceeded(array $payload): Response
    {
        return $this->successMethod();
    }
}
