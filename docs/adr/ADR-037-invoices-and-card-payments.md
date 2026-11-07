# ADR-037: The Platform Issues Invoices and Takes Card Payments Through Stripe

**Status:** Proposed
**Date:** 2026-11-07
**Relates to:** [ADR-026](ADR-026-billing-accounts.md), [ADR-035](ADR-035-plans-and-allowances.md),
[ADR-036](ADR-036-runtime-counts-data-points.md),
[spec 029](../../specs/029-billing-tier-limits/spec.md)

## Context

The owner wants a whole billing module:

- prices on plans;
- monthly invoices with tax rates the operator sets;
- card payments, with reminders for unpaid invoices;
- trials, with or without an end date.

Unpaid invoices must never restrict an account (spec 029 clarifications). The
repository is public, so prices, rates and keys live only in the database and in
ignored environment files. Laravel's first-party packages are preferred over
in-house protocol code.

## Decision

**The platform is the issuer of its invoices.**

- Each month, once usage is final (ADR-036), the platform drafts one invoice per
  billing account that had a plan. Lines are:
  - the base price, prorated by UTC day per assignment;
  - overage priced per assignment, with trial days and trial overage at 0;
  - adjustments;
  - tax at the account's rate;
  - credit carried from earlier credit notes.
- Amounts are integer minor units in one currency per deployment.
- Prices change from the next month, so a month is priced from one set of prices.
- A platform administrator reviews and issues each invoice. Issuing takes the next
  number from a locked counter, so numbers have no gaps, and snapshots the billing
  details. After issue, the invoice never changes; corrections are credit notes with
  their own numbers.

**Card payments use Stripe through Laravel Cashier.**

- Billing accounts are Cashier's customer model. Cashier's subscription tables are not
  used.
- Owners save a card on a Stripe Checkout page in setup mode.
- An issued invoice is charged off-session with an idempotency key per attempt. An
  unpaid invoice is paid on a Checkout page created when the owner asks.
- Card numbers never reach the platform.
- Stripe's signed webhooks drive payment status through a ledger of event ids.
  Status only moves forward.
- The platform retries a failed charge on the due date and 7 days later, sending
  reminders each time, then flags the account past due. Nothing is restricted.
- A deployment without Stripe keys issues invoices and records payments by hand.

**Trials are assignments that are not charged** (ADR-035). At a limited trial's end,
an account with a saved card is charged from the next day. One without a card stays
on the plan uncharged and is flagged until a card is added.

**PDFs are rendered by dompdf from a Blade view.**

## Consequences

- The platform depends on Stripe's availability for payments, not for invoicing or
  for anything customers do with devices.
- Stripe fees and the merchant account are the operator's.
- Tax is a rate the operator keeps correct; the platform does not work out tax by
  jurisdiction. A multi-jurisdiction operator would need several rates per account or
  a tax service, and so a new ADR.
- Paddle (merchant of record) and Stripe Billing subscriptions were rejected: either
  would own invoice numbers and tax, which the owner wants the platform to own.
- Webhooks need `STRIPE_WEBHOOK_SECRET` in production, and the API must be reachable
  from Stripe at `/api/stripe/webhook`.
- Two new Composer dependencies: `laravel/cashier` and `dompdf/dompdf`.
