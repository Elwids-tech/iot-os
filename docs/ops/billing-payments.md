# Card payments

Spec 029 US7 and [ADR-037](../adr/ADR-037-invoices-and-card-payments.md). Owners save a
card and pay invoices on Stripe's Checkout pages, and issued invoices are charged to
the saved card. Card numbers never reach the platform. Without Stripe keys, payments
are off: invoices are still issued, and administrators record payments by hand. For
how payments behave, see [billing](../features/billing.md#card-payments).

## What you need

- A Stripe account. The merchant account and its fees are the operator's.
- Three values from it, kept only in private environment files, never in the
  repository:
  - `STRIPE_KEY`, the publishable key;
  - `STRIPE_SECRET`, the secret key;
  - `STRIPE_WEBHOOK_SECRET`, the signing secret of the webhook endpoint below.
- `BILLING_CURRENCY`, the deployment's one currency (default `USD`). It must not
  change once invoices exist.

Payments switch on only when both `STRIPE_SECRET` and `STRIPE_WEBHOOK_SECRET` are
set. With either missing, every payment route answers 404 and the portal offers no
card.

## The webhook endpoint

Stripe reports payments to `POST https://api.<domain>/api/stripe/webhook`. The API
checks the `Stripe-Signature` header against `STRIPE_WEBHOOK_SECRET` and refuses an
unsigned request with 403. Subscribe the endpoint to exactly these events:

- `checkout.session.completed`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `payment_method.detached`

`php artisan cashier:webhook --url=https://api.<domain>/api/stripe/webhook` creates an
endpoint with those events. Copy its signing secret into `STRIPE_WEBHOOK_SECRET`.

Each event is acted on once: its id goes into `billing_provider_events`, which
`billing:prune` empties after 30 days, past Stripe's three-day redelivery window.
Payments only move forward, so a replayed or late event changes nothing.

## A release

1. Add the four values to the private `environment` file
   ([release](release.md)). The release compose passes them to the API and its
   workers.
2. Upgrade, then check **Settings → Billing** in the admin app: it says whether card
   payments are on.
3. Charges are queued on the `database` queue, which the default worker runs.
   `billing:payment-reminders` runs daily at 09:00 UTC.

## Locally, in test mode

1. Put the test-mode keys in the main checkout's `.env`, which git ignores (or a
   `.local/` env file the stack loads), and rebuild the API-image services
   ([rebuild one service](../dev/local-setup.md#rebuild-one-service)).
2. Forward Stripe's events to the local API with the Stripe CLI:

   ```bash
   stripe listen --forward-to http://localhost:8001/api/stripe/webhook --events checkout.session.completed,payment_intent.succeeded,payment_intent.payment_failed,payment_method.detached
   ```

   It prints a `whsec_…` signing secret for this session; use it as
   `STRIPE_WEBHOOK_SECRET`.
3. Run [quickstart sections 7 and 8](../../specs/029-billing-tier-limits/quickstart.md)
   with Stripe's test cards: one that always succeeds, and one that attaches but
   declines every charge. Section 8 ends a trial with a saved card, and saves one after
   a trial ended without it.
4. `stripe events resend <event id>` replays an event to show it changes nothing.

## When something looks wrong

- **An invoice stays pending after a charge.** Stripe may not have reached the
  webhook. **Reconcile** on the invoice (`POST admin/billing/invoices/{uuid}/reconcile`)
  asks Stripe for its pending payments and applies what Stripe says.
- **An account is past due.** It has an invoice unpaid after its due date. Nothing is
  restricted. The flag clears once the invoice is paid, credited or recorded as paid.
- **Turning payments off.** Remove `STRIPE_SECRET` and rebuild. Saved cards stay on
  Stripe and come back when the key does.
