# Research: Billing Module

The spec has no open clarifications. These are the design questions the plan had to
settle, answered from the code on `main` (cd63b57) and from the owner on 2026-11-07:
spec 028 and this spec are planned together, and card payments use Stripe through
Laravel Cashier.

## R1. Planning spec 028 with spec 029

- **Decision**: one plan, in this folder, covers both specs. They share one data
  model: plans, allowances, overrides, assignments and usage. Spec 028's work comes
  first in the delivery order. [`specs/028-pricing-plans/plan.md`](../028-pricing-plans/plan.md)
  points here.
- **Rationale**: spec 028 has no plan and nothing of it is built. Spec 029 adds
  allowances, prices and trials to the same records. Planning 029 alone would mean
  guessing 028's tables.
- **Alternatives**: plan 029 alone on assumed tables (rework when 028 is planned);
  plan 028 first in its own documents pull request (a second round trip for one
  model).

## R2. Allowances as rows keyed by kind

- **Decision**:
  - A plan's allowances are rows in `billing_plan_allowances (plan_id, kind, value)`,
    and an account's overrides are rows in `billing_allowance_overrides
    (billing_account_id, kind, value, note)`.
  - `kind` is one of `alerts`, `sms`, `devices`, `data_points`, `retention_days`,
    `organizations`.
  - `value` is a non-negative integer, or `NULL` for unlimited. A missing row means
    "not set here".
  - `Allowances::resolve(account, kind)` returns the override, else the plan's row,
    else the deployment default. It also says which of the three the value came
    from.
- **Rationale**: spec 028's SC-008 wants new allowances to be additions that change
  no record. A new kind adds rows and changes no column. The resolution order is the
  one both specs state.
- **Alternatives**:
  - One column per allowance on `billing_plans` and `billing_accounts`: every new
    allowance becomes a schema change on two tables, and "not set" versus "unlimited"
    needs a second column per allowance.
  - JSON on the plan: overrides and audits become partial-document updates that
    cannot be indexed.

## R3. The organization limit moves onto plans

- **Decision**:
  - Spec 023's `billing_accounts.organization_limit` becomes the `organizations`
    allowance. The deployment default is 1.
  - The migration writes an override for every account whose limit is not 1, then
    drops the column.
  - `OwnerOrganizations::create` keeps its account row lock and count, and reads the
    limit from `Allowances::resolve`.
  - The admin account dialog loses its limit field; the account page's allowance
    panel shows and overrides the limit.
- **Rationale**: owner decision (spec 029 clarification). Raised limits are kept as
  overrides, so nothing changes at rollout (spec 029 FR-004). ADR-026 says the limit
  is a number administrators type per account, so a new ADR amends it (ADR-035).
- **Alternatives**: keep the column and also add an allowance. That gives two
  sources for one number.

## R4. Plan assignments, trials and "what is charged when"

- **Decision**:
  - `billing_plan_assignments (billing_account_id, plan_id, kind, started_at,
    ended_at, trial_ends_at, assigned_by, ended_by, end_reason)`, where `kind` is
    `paid`, `trial` or `trial_unpaid`.
  - A partial unique index allows one open row per account. Changing a plan, starting
    or ending a trial, or adding a card after a trial ends each closes the open row
    and opens a new one in the same transaction, at one timestamp. Removing the plan
    closes the row and opens none.
  - Open-ended trials have `trial_ends_at` null.
- **Rationale**:
  - One table answers both "which plan was in force" (spec 028 SC-007) and "was the
    account on a trial" (spec 029 FR-048) for any moment.
  - It also tells invoicing which days are charged.
  - `trial_unpaid` is the "trial ended, no payment method" state: on the plan, not
    charged, flagged.
- **Alternatives**: a separate `billing_trials` table next to assignments. Invoicing
  would join two timelines, and "trial ended, no payment method" belongs to neither.

## R5. Counting usage exactly

- **Decision**:
  - `billing_usage (billing_account_id, kind, month, count, overage)` holds the
    account totals.
  - `billing_usage_shares (billing_account_id, organization_id, organization_uuid,
    kind, month, count)` holds each organization's share.
  - `billing_overage (billing_account_id, kind, month, plan_assignment_id, quantity)`
    records which assignment each unit of overage happened under, so invoices price it
    at that plan's price and trials price it at 0.
  - `Usage::add(account, organization, kind, at, quantity)` runs in one
    transaction. It does an `insertOrIgnore` and then locks the totals row, resolves
    the allowance, and computes overage as the part of `quantity` beyond what was left
    (`max(0, min(quantity, count_after - allowance))`). It updates totals, share and
    overage.
  - For SMS, `Usage::reserve(account, organization, 'sms', parts)` refuses instead of
    recording overage, and `Usage::release(...)` gives parts back when the provider
    refuses a message before accepting it. This is the interface spec 011's sender
    calls (spec 028 FR-025).
- **Rationale**: one row lock per account, allowance and month serializes concurrent
  sends. Spec 028 SC-002 tests 100 concurrent SMS. Overage is fixed when it is
  counted, so a later allowance change applies only to what is left (spec 028
  FR-018).
- **Alternatives**: counting `automation_alerts` rows on read. That cannot give
  overage at the moment of counting, does not cover SMS or data points, and is slow
  across a month.

## R6. Where alerts are counted

- **Decision**: `AlertProjector::project`
  (`apps/api/app/Domain/Automation/Services/AlertProjector.php:24`) counts one alert
  at the point where it first sets `activation_transition_id`. That happens after its
  "already projected" guard, in the same transaction.
- **Rationale**:
  - Geofence rules and DAG alert actions both arrive here, through
    `WorkflowDeploymentService` and `DagActions`. The guard makes replays a no-op
    (spec 028 FR-012).
  - Offline alerts (spec 018) are other `kind`s and never pass through it. Clears,
    acknowledgements and comments take other paths.
- **Alternatives**: counting in each caller. Two places to keep in step, and a replay
  that bypasses the guard would count twice.

## R7. The device limit

- **Decision**:
  - Add `devices.limit_place_at` (nullable). A device holds a place while it is set.
  - `DeviceLimit::claim(device)` locks the device's billing account row
    (`lockForUpdate`), counts devices with `limit_place_at` set in the account's
    non-deleted organizations, refuses at the limit, and sets `limit_place_at`.
    Callers always lock the device row first, then the account row.
  - `claim` is called from:
    - `DeviceConfigurationService::activate`, but only when the device has no place
      yet. Reconfiguring an active device holds its place and is never refused
      (FR-008).
    - `DeviceLifecycleService::request` when the target is active.
  - The place is released when:
    - a deactivation request is accepted;
    - `device.failed.v1` arrives for a device whose `lifecycle` is not `active` (a
      failed first activation);
    - the device is archived;
    - its organization is deleted.
  - If a deactivation fails, the place is taken back without a limit check.
  - Rollout sets `limit_place_at` for devices that are `active` or have an activation
    outstanding.
  - `billing_device_peaks (billing_account_id, month, peak)` keeps the month's
    highest count.
- **Rationale**:
  - `lifecycle` turns `active` only when the runtime confirms
    (`RuntimeController.php:338`), but the spec counts a device from the moment its
    activation is accepted.
  - The two services are the only paths that enqueue `device.activate.v1`. Bulk
    onboarding, adapters and staging go through `activate`.
  - Bulk onboarding already marks an item Skipped on a 4xx
    (`BulkOnboarding.php:136-138`), so a refusal there carries its reason with no
    new code.
- **Alternatives**:
  - Count `lifecycle = 'active'`. Two activations in flight would both pass the
    check.
  - An organization-level lock. Two organizations on one account would not
    serialize.

## R8. Counting data points in the runtime

- **Decision**:
  - In `Store.PersistResult` (`services/runtime/internal/storage/store.go:235`), add
    up `RowsAffected()` of every observation and diagnostic insert. Calculated
    readings are among them, and so are readings skipped by the content match.
    Upsert the sum into `device_runtime.usage_data_points (organization_uuid, hour,
    count, reported_count)` in the same transaction, keyed by the transaction's
    `now()` truncated to the UTC hour.
  - A duplicate message stops at the ledger insert (line 259) and adds nothing.
  - A reporter runs every 60 seconds. It reads buckets where `count >
    reported_count`, and also every bucket of a closed hour that has not yet been
    reported final. In one transaction it writes one `usage.data_points.v1` outbox
    event and sets `reported_count`.
  - The event carries cumulative counts per (organization, hour), a `final` flag for
    hours that ended more than one minute ago, and `final_through`, a runtime-wide
    watermark. Its id is a UUID v5 of its contents, written with `ON CONFLICT DO
    NOTHING`.
  - Laravel keeps `billing_data_point_buckets` with the highest count seen per
    bucket. It applies only the increase, through `Usage::add`, to the account the
    organization belonged to at the bucket's hour. It keeps `final_through` in
    `billing_usage_watermarks`.
  - Runtime buckets are pruned after 40 days. Laravel's buckets are pruned after 13
    months; issued invoices keep their own figures.
- **Rationale**:
  - Counting in the storage transaction counts exactly what is stored, once. The
    ledger and the content match already decide that.
  - Cumulative counts make replays, duplicates and out-of-order delivery harmless:
    Laravel only ever applies the increase.
  - The control plane being down only delays reports, because the outbox and relay
    already retry (constitution I, VII).
  - One runtime instance (`ExclusiveRuntime`, `store.go:88`) makes a single watermark
    sound.
  - Hourly buckets keep rows small. The reporter keeps usage within about a minute,
    well inside spec 029's five minutes.
- **Alternatives**:
  - An event per message or per reading. That is telemetry-sized traffic to the
    control plane, and constitution I keeps telemetry out of Laravel.
  - Deltas instead of cumulative counts. A lost acknowledgement would need
    exactly-once delivery that the relay does not give.
  - Counting in Laravel from committed telemetry. Laravel must not ingest telemetry.
- **Precision**: a mid-hour move between billing accounts attributes that hour to the
  account at the hour's start. Moves are rare administrator actions.

## R9. Usage finality and lag

- **Decision**:
  - A month's data points are final when `final_through` reaches the month's end.
  - Usage pages show the time of the last report, and say "Provisional" before
    finality.
  - When no report has arrived for more than five minutes, they show "Last reported
    …" (spec 029 FR-014).
  - Alerts, SMS and devices are counted synchronously in Laravel, so they are always
    current.
- **Rationale**: constitution VI. Unknown is not zero, so a lagging total is labelled
  as such.

## R10. Retention follows the plan, with a 30-day grace

- **Decision**:
  - `RetentionService::effective` gains a billing step: the organization override,
    else the account's `retention_days` allowance, else the platform default, else
    400. `source` gains `billing_account`.
  - A new `telemetry_retention_floors (organization_id, days, until, warned_at)`
    holds the grace. `RetentionGuard::around(accounts, change)` computes each
    affected organization's effective days before and after a billing change. Where
    they fall, it writes a floor of the previous days until 30 days later.
  - The `/state` snapshot sends the cleanup days, the effective days raised to any
    active floor, in the existing `days` field. The runtime contract does not change.
  - Direct changes on **Settings → Retention** keep today's path (FR-021).
  - A daily job emails owners 7 days before a floor ends; the change itself emails
    them at once.
- **Rationale**:
  - The runtime already reads days per organization from `/state`
    (`application.go:991-1037`).
  - Keeping "the longest period of the last 30 days" in Laravel needs no state or
    schema change in Go.
  - Undoing a change within the grace leaves the floor unused, so nothing is deleted
    (SC-012).
- **Alternatives**: a runtime-side retention history. That needs a new state field
  and puts billing knowledge in Go.

## R11. Money and currency

- **Decision**:
  - Amounts are integers in minor units (`bigint`). One currency per deployment is
    set by `BILLING_CURRENCY`, which also configures Cashier.
  - Tax rates are stored in basis points.
  - Each line is rounded half up to the minor unit, and tax is computed on the
    subtotal.
  - No money library: amounts never leave minor units until formatted for display.
- **Rationale**: floats lose cents, and the platform has one currency (D6).
- **Alternatives**: `brick/money`. It is correct but not needed for single-currency
  integer arithmetic.

## R12. Prices that change from next month

- **Decision**:
  - `billing_plan_prices (plan_id, effective_from, base_price, alert_overage_price,
    data_point_overage_price, data_point_block_size)` stores each plan's price
    history. `effective_from` is always the first day of a month.
  - Editing prices writes the row for next month, or replaces it if one is already
    waiting.
  - `billing_price_overrides (billing_account_id, price, value, note,
    effective_from)` works the same way.
  - Month M is priced from the latest row with `effective_from ≤ M`.
- **Rationale**: D10, and an invoice can always be recomputed from records
  (FR-038).

## R13. Invoices

- **Decision**:
  - A daily job `billing:draft-invoices` (02:10 UTC) drafts last month's invoice for
    every account that had an assignment during the month and has no invoice for it,
    once `final_through` passes the month's end.
  - Administrators see accounts still waiting after three days, and can draft anyway
    with a note (FR-033).
  - The base price is prorated by UTC day. Each day is charged to the assignment in
    force at 00:00 UTC that day. So a trial that ends today is charged from tomorrow,
    and a plan assigned mid-day starts charging the next day.
  - Overage lines come from `billing_overage` per assignment. Data points are priced
    by whole blocks, rounded up. Units of overage under a trial assignment are shown
    at 0.
  - Issuing locks a row in `billing_number_sequences` and takes the next number, so
    numbers have no gaps (SC-009). It also snapshots the operator's and the account's
    billing details and fixes the invoice for good.
  - PDFs are rendered on request with `dompdf/dompdf` from a Blade view; CSV is
    streamed.
- **Rationale**:
  - A PostgreSQL sequence leaves gaps on rollback; a locked counter row does not.
  - dompdf is pure PHP: there is no browser in the API image, and Cashier uses it for
    its own invoice PDFs.
- **Alternatives**: Stripe Invoices as the invoice of record. Stripe would number
  them and compute their tax, and the owner chose platform-issued invoices with
  admin-set tax rates.

## R14. Credit notes and carried credit

- **Decision**:
  - `billing_credit_notes` have their own unbroken sequence and a gross amount.
  - A credit note reduces the amount due on its invoice. Any credit beyond what is
    owed goes to `billing_account_credits`, a ledger of credits and applications.
  - The next draft applies available credit after tax, as "Credit from CN-…".
- **Rationale**: issued invoices never change (D7), and FR-035 carries excess credit
  forward.

## R15. Stripe through Laravel Cashier

- **Decision**:
  - Require `laravel/cashier` 16.x (16.9 supports Laravel 13). `BillingAccount` uses
    `Billable`, and `Cashier::useCustomerModel(BillingAccount::class)`.
  - Cashier's subscription migrations are not run: Cashier 16 only publishes them, so
    nothing needs switching off (there is no `Cashier::ignoreMigrations()`), and
    `Cashier::ignoreRoutes()` leaves the webhook route to the domain. Only its customer
    columns are added to `billing_accounts`: `stripe_id`, `pm_type`, `pm_last_four`,
    plus `pm_expires`.
  - Saving a card: a Stripe Checkout session in `setup` mode, on Stripe's own page.
    `checkout.session.completed` sets the payment method as the customer's default
    and stores brand, last four and expiry.
  - Charging on issue: a queued job creates an off-session PaymentIntent for the
    amount due, with idempotency key `invoice:{uuid}:{attempt}`, and records a
    pending payment.
  - Paying from the portal or an email: the link opens the portal's invoice page.
    That page creates a Checkout session in `payment` mode on demand, so links in
    emails never expire.
  - Webhooks go to `POST /api/stripe/webhook`. Cashier verifies the signature when
    `STRIPE_WEBHOOK_SECRET` is set (required in production). A listener records each
    event id in `billing_provider_events` (`insertOrIgnore`) before acting.
    Payment status only moves forward: a later `succeeded` overrides `failed`, never
    the reverse.
  - Stripe retries webhooks; it does not retry raw off-session PaymentIntents. The
    platform retries the charge itself on the reminder days: the due date and 7 days
    after (FR-042).
  - An administrator can check a pending payment with Stripe from the invoice page,
    for a report that never arrived.
  - With no Stripe secret configured, payments are off: no card form and no charges,
    and administrators record payments (FR-045).
- **Rationale**:
  - Cashier is first-party and handles customers, payment methods and webhook
    verification.
  - Stripe hosts both forms, so card numbers never reach the platform (FR-039,
    SC-011). The portal only redirects, so no Stripe.js is loaded and the apps need
    no CSP change.
  - Test mode makes the quickstart reproducible.
- **Alternatives**:
  - Cashier Paddle: Paddle is merchant of record and issues its own invoices.
  - Stripe Billing subscriptions: Stripe would own the plan, invoice and tax.
  - Stripe Elements in the portal: Stripe.js on our pages, and nothing gained over
    hosted Checkout.
- **Spec note**: spec 029's assumption that the provider retries failed charges is
  changed to the platform retrying them on the reminder days, which customers
  experience the same way.

## R16. One ledger for billing emails

- **Decision**: `billing_notices (billing_account_id, kind, key, sent_at)`, unique on
  `(billing_account_id, kind, key)`, pruned after 13 months. Every billing email inserts its row first and
  sends only if it inserted:
  - usage thresholds (`threshold:data_points:2026-11:80`);
  - trial reminders;
  - retention warnings;
  - invoice issue, receipts and payment reminders.
  Sending follows the existing pattern: a queued `ShouldQueue` job with tries and
  backoff, and a text Mailable (`Automation/Jobs/DeliverAlertEmail.php`).
- **Rationale**: specs 028 and 029 each require "exactly one email per threshold,
  allowance and month" and similar (SC-005, SC-008, SC-010). One unique row per
  notice makes that a database guarantee.

## R17. Scheduled work

- **Decision**: new commands in `routes/console.php`, each
  `dailyAt(...)->withoutOverlapping()`:
  - `billing:end-trials` 00:05;
  - `billing:draft-invoices` 02:10;
  - `billing:retention-warnings` 08:00;
  - `billing:payment-reminders` 09:00;
  - `billing:prune` 03:30.
  None of them is monthly: each daily run finds what is due, so a missed run catches
  up.
- **Rationale**: the existing scheduler only uses every-minute and daily jobs.

## R18. Permissions and visibility

- **Decision**:
  - Every administrator action needs `PlatformAdministration.manageOrganizations`
    (assumption in both specs).
  - Owner routes resolve the account among the person's own accounts, and answer 404
    otherwise, as spec 023 does.
  - Managers read their organization's usage through a tenant route that needs
    `Device.manage`. It returns no account name, no other organization, and no prices
    or invoices.
- **Rationale**: constitution III and spec 029 FR-024 / SC-007.

## R19. Delivery order

- **Decision**: thirteen implementation pull requests after the documents one, each
  based on `main`. Spec 028's work goes first. See the plan's Delivery section for
  each pull request's dependencies. Independent ones may be open at the same time;
  none is stacked.
- **Rationale**: the owner merges lists of pull requests at once, so each must stand
  on `main` alone.
