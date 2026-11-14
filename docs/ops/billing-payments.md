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

Billing can ship before it is used. Leave the Stripe values out and card payments stay
off: every payment route and the webhook answer 404, and administrators record payments
by hand. An account on no plan keeps working as before: alerts, devices and data points
stay unlimited, retention follows the platform setting, and no warning or invoice is
sent. Billing starts for an account when an administrator gives it a plan or a trial.

To turn card payments on:

1. Add the three Stripe values and `BILLING_CURRENCY` to the private `environment` file
   ([release](release.md)). The release compose passes them to the API and its
   workers.
2. Upgrade, then check **Settings → Billing** in the admin app: it says whether card
   payments are on.
3. Charges are queued on the `database` queue, which the default worker runs.
   `billing:payment-reminders` runs daily at 09:00 UTC.

## Locally, in test mode

1. Put the test-mode keys in the main checkout's root `.env`, which git ignores (or a
   `.local/` env file the stack loads), and recreate the API-image services
   ([rebuild one service](../dev/local-setup.md#rebuild-one-service)). The containers
   get their environment only from the env files the stack starts with:
   `apps/api/.env` is for running the API outside Docker, and the stack never reads it.
2. Forward Stripe's events to the local API with the Stripe CLI:

   ```bash
   stripe listen --forward-to http://localhost:8001/api/stripe/webhook --events checkout.session.completed,payment_intent.succeeded,payment_intent.payment_failed,payment_method.detached
   ```

   It prints a `whsec_…` signing secret for this session; use it as
   `STRIPE_WEBHOOK_SECRET`. The CLI must be signed in to the same Stripe account as the
   keys, or it forwards another account's events. `failed to refresh session:
   invalid_scope` means its sign-in has expired: run `stripe login` again, or pass the
   test secret key with `--api-key`.
3. Run [quickstart sections 7 and 8](../../specs/029-billing-tier-limits/quickstart.md)
   with Stripe's test cards: one that always succeeds, and one that attaches but
   declines every charge. Stripe sends the owner back to `FRONTEND_URL`, which is
   `http://127.0.0.1:5173` on the dev stack: sign in to the portal at that address, as
   a session on `localhost:5173` does not carry over and the return lands on the sign-in
   page. On a payment page, Stripe offers the saved card first; **Change** pays with
   another. Section 8 ends a trial with a saved card, and saves one after
   a trial ended without it.
4. `stripe events resend <event id>` replays an event to show it changes nothing.

## When something looks wrong

- **An invoice stays pending after a charge.** Stripe may not have reached the
  webhook. **Check with Stripe** on the invoice (`POST admin/billing/invoices/{uuid}/reconcile`)
  asks Stripe for its pending payments and applies what Stripe says.
- **An account is past due.** It has an invoice unpaid after its due date. Nothing is
  restricted. The flag clears once the invoice is paid, credited or recorded as paid.
- **Turning payments off.** Remove `STRIPE_SECRET` and rebuild. Saved cards stay on
  Stripe and come back when the key does.
