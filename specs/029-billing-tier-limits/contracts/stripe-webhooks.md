# Contract: Stripe events (spec 029 US7)

Stripe calls `POST /api/stripe/webhook`, Cashier's webhook route. Cashier's
`VerifyWebhookSignature` checks the `Stripe-Signature` header against
`STRIPE_WEBHOOK_SECRET`, which is required whenever `STRIPE_SECRET` is set; an
unverified request answers 403 (FR-041).

`App\Domain\Billing\Listeners\StripeEvents` listens to Cashier's `WebhookReceived`.
For each event it:

1. inserts `billing_provider_events.provider_event_id` (`insertOrIgnore`) and stops
   if the row already existed;
2. handles the event types below, in one transaction;
3. ignores every other type.

Cashier's own handlers for subscriptions, customers and cards (`customer.updated`,
`payment_method.automatically_updated` among them) are switched off in
`StripeWebhookController`, so an event the endpoint should not receive never changes
the stored card.

| Stripe event | Matched by | Effect |
| --- | --- | --- |
| `checkout.session.completed`, `mode=setup` | `metadata.billing_account_uuid` | Retrieves the SetupIntent's payment method, makes it the customer's default (detaching the old one), and stores the brand, last four digits and expiry. If the open assignment is `trial_unpaid`, it opens `paid` at once, charged from the next 00:00 UTC (the rest of the day, overage included, stays the trial's). Audited as `billing_account.payment_method_changed`. |
| `checkout.session.completed`, `mode=payment`, `payment_status=paid` | `metadata.invoice_uuid` | Records a `checkout` payment, `succeeded`, with the PaymentIntent id; the invoice becomes `paid` and the owners get a receipt. |
| `payment_intent.succeeded` | `metadata.invoice_uuid` + PaymentIntent id | Marks the payment `succeeded`; the invoice becomes `paid` and the owners get a receipt. |
| `payment_intent.payment_failed` | PaymentIntent id | Marks the payment `failed` with `last_payment_error.message`. The invoice becomes `failed` unless already paid. The owners get the reason and a link to pay. |
| `payment_method.detached` | customer | Clears the stored display fields when the detached method was the default. |

## Rules

- **Payment status only moves forward.** An older `payment_failed` arriving after
  `succeeded` changes nothing.
- **Amounts are checked.** A succeeded amount different from the payment's amount is
  kept as received and audited (`billing_invoice.payment_amount_mismatch`) for an
  administrator to review. What goes beyond what was still owed becomes account
  credit (`billing_invoice.overpaid`). This should not happen; it guards against a
  mismatched session.
- **Charges are idempotent.** The off-session charge uses the idempotency key
  `invoice:{invoice_uuid}:{attempt}`, so a retried job never charges twice.
- **The return from Checkout is read from Stripe too.** Checkout's `success_url` carries
  the session's id, and `POST billing-accounts/{account}/invoices/{invoice}/checkout/returned`
  retrieves that session and its PaymentIntent and applies it exactly as
  `payment_intent.succeeded` would, keyed by the PaymentIntent id. The event that follows
  changes nothing. A session whose `metadata.invoice_uuid` or customer does not match is
  ignored, and so is an event whose PaymentIntent carries no invoice.
- **Refusals that charged nothing fail at once.** When Stripe answers the off-session
  charge with a 4xx other than a card decline, the payment fails with Stripe's message.
  Only a timeout, a 429 or a 5xx leaves it pending, as the charge may have gone through.
- **Payments can be switched off.** With no `STRIPE_SECRET`, the route and payment
  endpoints answer 404, and the portal offers no card (FR-045).
- **Card data never reaches the platform.** Card numbers and security codes are only
  ever entered on Stripe's Checkout pages (FR-039, SC-011).
