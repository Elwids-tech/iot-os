# Implementation Plan: Billing Module (specs 028 and 029)

**Branch**: `spec/029-billing-plan` | **Date**: 2026-11-07 | **Spec**: [spec.md](spec.md), with
[spec 028](../028-pricing-plans/spec.md)

**Input**: Feature specifications `specs/029-billing-tier-limits/spec.md` and
`specs/028-pricing-plans/spec.md`. The owner chose on 2026-11-07 to plan them together
and to take card payments with Stripe through Laravel Cashier.

## Summary

The existing `App\Domain\Billing` (spec 023) grows into the platform's billing module.
It is built on billing accounts and described in three new ADRs (ADR-035 to ADR-037).

- **Plans and allowances (028, 029 US1).**
  - Plans hold allowances as rows keyed by kind: alerts, SMS, devices, data points,
    retention days and organizations.
  - Billing accounts get one plan at a time through an assignment history, plus
    per-kind overrides.
  - `Allowances::resolve` answers override, else plan, else deployment default.
  - Spec 023's typed-in organization limit becomes an override, which amends ADR-026.
- **Usage (028 US3–4, 029 US2–3, US5).**
  - `Usage` keeps exact monthly totals per account, each organization's share, and
    overage fixed at the moment it is counted.
  - Alerts are counted where `AlertProjector` first records an activation.
  - SMS is reserved and released by spec 011's sender.
  - Devices hold a place from the moment their activation is accepted, checked under
    the billing account's row lock.
  - Data points are counted by the Go runtime inside the storage transaction and
    reported as cumulative hourly counts in a new runtime event,
    `usage.data_points.v1`. Laravel applies only increases.
- **Retention (029 US4).**
  - `RetentionService` resolves organization override, then billing account, then
    platform, then 400 days.
  - A billing change that shortens retention writes a 30-day floor. The runtime keeps
    reading one `days` per organization from `/state`, raised to the floor, so the Go
    contract does not change.
- **Invoices (029 US6).**
  - Plans carry prices that change from next month. Administrators set the operator's
    billing details and tax rates.
  - A daily job drafts each account's invoice for every ended month once its data
    point usage is final, so a month it missed is drafted on the next run.
    Administrators adjust and issue it, which takes an unbroken number and snapshots
    it.
  - Credit notes correct issued invoices.
  - PDFs come from dompdf.
- **Payments (029 US7).**
  - Cashier makes billing accounts Stripe customers.
  - Owners save cards on Stripe Checkout in setup mode.
  - Issued invoices are charged off-session with an idempotency key, or paid on a
    Checkout page created on demand.
  - Signed webhooks drive payment status through a provider-event ledger.
  - The platform retries the charge on the due date and 7 days later, then flags the
    account past due. Nothing is ever restricted.
- **Trials (029 US8).**
  - A trial is a `trial` assignment. At its end it becomes `paid` when a card is
    saved, or `trial_unpaid` (flagged, not charged) until one is.

## Technical Context

**Language/Version**: PHP 8.4 / Laravel 13 (`apps/api`); Go 1.27 (`services/runtime`);
TypeScript, React 19 (`apps/admin`, `apps/portal`, `packages/*`)

**Primary Dependencies**:

- New: `laravel/cashier` 16.x (Stripe) and `dompdf/dompdf`.
- Existing:
  - Eloquent with `lockForUpdate`, `ActivityLog`/`DeviceAudit`, queued mail jobs;
  - pgx in the runtime;
  - TanStack Query 5;
  - `@iot-os/ui` (`CollectionPage`, `EntityPage`, `DataTable`, `Panel`,
    `SearchableSelect`, `Dialog`, `Field`, `RelativeTime`, `Freshness`,
    `statusOf`/`Status`, `SettingsPage`).

**Storage**: PostgreSQL 17 with TimescaleDB.

- Laravel gains 24 tables, eight columns on `billing_accounts` (and drops
  `organization_limit`) and one column on `devices`. See
  [data-model.md](data-model.md).
- The runtime gains `device_runtime.usage_data_points`.

**Testing**:

- PHPUnit on PostgreSQL (`php artisan test --compact`).
- Go integration tests against TimescaleDB (`DEVICE_TEST_DATABASE_URL`, `go test -p 1`).
- Contract checks: `tooling/verify-devices-contracts.py`, `contract:export --check`,
  `contract:check --base=origin/main`.
- Stripe: the PHP SDK's HTTP client is faked in unit tests; Stripe test mode with
  `stripe listen` is used in the quickstart.
- Playwright with route mocks for admin and portal; `pnpm --filter … lint`.
- Manual runs in the rebuilt stack ([quickstart.md](quickstart.md)).

**Target Platform**: `api` and the API-image services (queue workers, scheduler),
`runtime`, `admin`, `portal`

**Project Type**: web application with a Go data plane

**Performance Goals**:

- The storage transaction gains one upsert per message. At the tested load it adds at
  most 10 ms at p99 to the time a reading takes to reach history, and throughput is
  unchanged (029 SC-004).
- Usage within about a minute (reporter every 60 s; 029 SC-005 allows five minutes,
  028 SC-004 one).
- The admin billing account list in one paginated query with usage joined.
- Drafting a month's invoices for 1,000 accounts in under ten minutes.

**Constraints**:

- Telemetry never reaches Laravel; only counts do.
- No limit or unpaid invoice drops, delays or restricts telemetry.
- Card data never reaches the platform.
- With no plans, prices or Stripe keys, every existing behaviour is unchanged (028
  SC-003, 029 SC-006).
- The `/state` retention contract does not change.
- Implementation lands in small pull requests, each based on `main`, none stacked.

**Scale/Scope**: about 8 migrations, 24 tables, 16 services plus `RetentionGuard`, 1
Cashier listener, 5 console commands, 1 mail job with about 11 Mailables. One new
runtime table, one counter path, one reporter and one contract. Admin gains 5 pages
and about 10 dialogs; portal gains 5 billing panels and 1 settings section.

## Constitution Check

| Principle | Status |
| --- | --- |
| I. Laravel owns intent | Pass. Laravel owns plans, limits, invoices and payments. The runtime only counts what it stores, in its own transaction, and reports aggregates through the existing outbox. It never asks Laravel how to handle a message, and Laravel ingests no telemetry. Stripe talks only to Laravel. |
| II. Immutable versions | Pass. Nothing versioned changes. Issued invoices and credit notes never change, and plan prices are a history keyed by month. |
| III. Tenant isolation | Pass. Billing is not tenant data. Admin routes need `PlatformAdministration.manageOrganizations`. Owner routes resolve the account among the person's own accounts and answer 404 otherwise. The manager usage route sits under `ResolveOrganizationContext`, needs `Device.manage`, and returns only that organization. Tests prove a manager cannot see another organization's usage or the account, a non-owner gets 404, and a member gets 403 (028 SC-006, 029 SC-007). |
| IV. Contracts first | Pass. `usage.data_points.v1` gets a schema, fixture, cases, a catalogue entry and producer and consumer tests in the pull request that adds it. Laravel rejects other `schema_version`s. HTTP changes go through `contract:export` and `packages/api-client` in the same pull request. Users are integer `user_id`. |
| V. AI proposes | Pass. The assistant and agent tools neither read nor change billing. |
| VI. Show uncertainty | Pass. Data point usage carries `final` and `reported_at`; pages say "Provisional" or "Last reported …" instead of presenting a stale total as current. Payment status stays `pending` until Stripe reports. An invoice drafted before usage is final says its usage may be incomplete. |
| VII. Durable, idempotent messaging | Pass. Usage reports are cumulative with content-derived ids, so replays and reordering are harmless. Webhooks go through a provider-event ledger, and status only moves forward. Charges carry idempotency keys. Ledgers are pruned beyond redelivery windows: runtime buckets after 40 days, provider events after 30, Laravel buckets and billing email notices after 13 months (every notice key carries its month). |
| VIII. One design system | Pass. Lists use `CollectionPage` + `DataTable`; content sits in `Panel`s. Payment and invoice status use `statusOf`/`Status`; times use `RelativeTime`/`Freshness`. Plan, rate and account choices use `SearchableSelect`. Settings → Usage joins the `SettingsPage` sections. A sticky invoice action bar uses `keepToastsAbove`. A new kit component (`AllowanceMeter`) gets a story. `check-ui` passes. |
| IX. Verified where it runs | Pass. CI on PostgreSQL. Each pull request rebuilds the services it touches and runs its quickstart section; payments run against Stripe test mode. Load is measured with the simulator at the tested rate before and after counting. |

## Decisions

Details and alternatives are in [research.md](research.md).

| Decision | Chosen | Rejected because |
| --- | --- | --- |
| Scope of this plan | Specs 028 and 029 together, 028's work first (R1) | Planning 029 alone would guess 028's tables |
| Allowances | Rows keyed by kind on plans and as account overrides; `NULL` = unlimited, missing = default (R2) | Columns per allowance make every new limit a schema change |
| Organization limit | Becomes the `organizations` allowance; raised limits migrate to overrides; ADR-035 amends ADR-026 (R3) | Keeping the column too gives two sources for one number |
| Trials and history | `billing_plan_assignments.kind` ∈ `paid`, `trial`, `trial_unpaid` (R4) | A separate trials table makes invoicing join two timelines |
| Exact usage | Totals + shares + overage per assignment, under a row lock per account, kind and month; SMS reserve and release (R5) | Counting rows on read cannot fix overage when counted |
| Alerts | Counted in `AlertProjector` at the first activation (R6) | Counting in callers duplicates the replay guard |
| Device limit | `devices.limit_place_at`, claimed under the account row lock in the two activation paths (R7) | Counting `lifecycle = active` lets two in-flight activations pass |
| Data points | Counted in `PersistResult`, reported as cumulative hourly buckets with a watermark (R8, ADR-036) | Per-message events put telemetry-sized traffic on the control plane |
| Retention grace | Floors in Laravel; `/state` sends the raised days (R10) | A runtime retention history changes the Go contract |
| Money | Integer minor units, one configured currency, basis-point tax (R11) | Floats lose cents |
| Prices | Month-keyed price history on plans and overrides (R12) | Mutable prices make invoices impossible to recompute |
| Numbering | A locked counter row per sequence (R13) | PostgreSQL sequences leave gaps |
| PDF | dompdf from a Blade view (R13) | A headless browser in the API image |
| Payments | Stripe via Cashier: Checkout for cards and payments, off-session PaymentIntents, signed webhooks, platform-driven retries (R15, ADR-037) | Paddle and Stripe Billing would own invoices and tax |
| Billing emails | One `billing_notices` ledger for exactly-once sending (R16) | Per-feature flags drift |

## Design

### Storage

The migrations land with the pull request that needs them (see Delivery), each with
a `down()`.

1. **Plans**:
   - `billing_plans`, `billing_plan_allowances`, `billing_allowance_overrides` and
     `billing_plan_assignments`, the last with a partial unique index on the open row;
   - migrate `billing_accounts.organization_limit` into overrides where it is not 1,
     then drop the column.
2. **Usage**: `billing_usage`, `billing_usage_shares`, `billing_overage`,
   `billing_device_peaks`, `billing_notices`.
3. **Device limit**: `devices.limit_place_at` with its partial index, and a backfill
   for active devices and outstanding activations.
4. **Data points**: `billing_data_point_buckets`, `billing_usage_watermarks`. On the
   runtime side, `usage_data_points` in `services/runtime/internal/storage/schema.sql`
   (idempotent DDL).
5. **Retention**: `telemetry_retention_floors`.
6. **Invoices**:
   - `billing_settings`, `billing_tax_rates`, `billing_plan_prices`,
     `billing_price_overrides`;
   - `billing_accounts` billing detail columns;
   - `billing_invoices`, `billing_invoice_lines`, `billing_invoice_usage`,
     `billing_credit_notes`, `billing_account_credits`, `billing_number_sequences`.
7. **Payments**: Cashier's customer columns on `billing_accounts` (`stripe_id`,
   `pm_type`, `pm_last_four`, `pm_expires`), `past_due_since`, `billing_payments`,
   `billing_provider_events`.

`OrganizationDeletion::KEPT` gains `billing_usage_shares` and
`billing_data_point_buckets`, with the organization reference set null. Invoices
reference the account, not the organization.

### Billing services (`app/Domain/Billing/Services`)

- `Plans`: create, update (the confirmation count, retention guard), archive, restore,
  delete (refused once ever assigned), and `setPrices` (next month's row).
- `Allowances`:
  - `resolve(account, kind)` returns `{value, source, note}`;
  - `override` and `removeOverride`, both audited and wrapped in the retention guard;
  - `defaults()` from config: SMS default from spec 011's setting, organizations 1,
    the others unlimited, retention the platform setting.
- `PlanAssignments`:
  - `assign(account, plan, actor)` and `remove`. Each closes the open row and opens
    the next at one timestamp, under the account row lock, inside the retention
    guard.
  - `current(account)` and `at(account, instant)`.
- `Usage`:
  - `add(account, organization, kind, at, quantity)` and `reserve` / `release` for
    SMS (research R5);
  - `forAccount(account, month)` and `forOrganization(organization, month)`;
  - threshold checks after each change dispatch `Notices` for 80% and 100%.
- `DeviceLimit`: `claim(device)` (account lock, count, refuse, peak), `release(device)`,
  `count(account)`.
- `DataPointReports::apply(payload)`: the bucket upsert, applying increases, the
  watermark (contract).
- `Prices::for(account, month)`: the plan's price row and the account's overrides in
  force for the month.
- `BillingSettings` and `TaxRates`: CRUD with a revision guard.
- `InvoiceDrafter`:
  - `draftDue(now)` drafts every account due for each ended month whose usage is
    final;
  - `draft(account, month, actor?, note?)` and `recalculate(invoice)`.
  - Lines are built from assignment days (prorated per UTC day at 00:00), overage per
    assignment, adjustments and available credit. Usage rows come from the shares.
- `InvoiceIssuer::issue(invoice, actor)`:
  1. take the sequence lock and number;
  2. snapshot the details and tax;
  3. set `due_at`;
  4. apply credit;
  5. if the amount due is 0, mark it paid;
  6. otherwise dispatch `ChargeInvoice` when payments are on and a card exists;
  7. send the notices.
- `CreditNotes::issue(invoice, amount, reason, actor)`: reduces the amount due, and
  sends any excess to `billing_account_credits`.
- `Payments`:
  - `checkoutForInvoice`, `checkoutForPaymentMethod`, `removePaymentMethod`;
  - `charge(invoice, attempt)`: an off-session PaymentIntent with an idempotency key;
  - `recordOutside`, `reconcile(invoice)`;
  - `markPastDue(now)`.
- `Trials`:
  - `start`, `change`, `end(reason)`, `convert`;
  - `endDue(now)`: due trials become `paid` or `trial_unpaid`;
  - `paymentMethodAdded(account)`: `trial_unpaid` becomes `paid` from the next 00:00
    UTC.
- `Notices::send(account, kind, key, mailable)`: the `billing_notices` insert, then a
  queued `DeliverBillingEmail` job on the owners, or on the billing contact for
  invoices.

`App\Domain\Billing\Listeners\StripeEvents` handles Cashier's `WebhookReceived`
([contract](contracts/stripe-webhooks.md)). `BillingAccount` uses Cashier's
`Billable`, registered with `Cashier::useCustomerModel(BillingAccount::class)`.
Cashier 16 only publishes its migrations, so none run; `BillingServiceProvider` calls
`Cashier::ignoreRoutes()`, and the webhook is the domain's own controller. Payments are
off unless both `cashier.secret` and `cashier.webhook.secret` are set.

### Changes outside the domain

- `Automation/Services/AlertProjector::project`: after setting
  `activation_transition_id`, `Usage::add(..., 'alerts', now(), 1)`. That is the
  month the platform records the alert, as spec 028's late-reports edge case says,
  not the transition's `occurred_at`.
- `Devices/Services/DeviceConfigurationService::activate`: calls
  `DeviceLimit::claim($device)` inside `locked()` when the device holds no place.
- `Devices/Services/DeviceLifecycleService::request`:
  - target active: `claim`;
  - target inactive: `release`;
  - a failed deactivation re-claims without a check.
- `Devices/Http/Controllers/RuntimeController`:
  - `device.failed.v1` on a non-active device releases its place;
  - a new `usage.data_points.v1` branch, before the device lookup, calls
    `DataPointReports::apply`;
  - `state()` sends cleanup days from `RetentionService::cleanupDays`.
- Device archive (in `DeviceController`) releases the place.
- `Devices/Services/RetentionService`:
  - `effective()` gains the billing step and `pending_reduction`;
  - a new `cleanupDays(organization)`;
  - a new `RetentionGuard::around(array $accounts, callable)` used by `Plans`,
    `Allowances`, `PlanAssignments`, `Trials` and `BillingAccounts::move`.
- `Billing/Services/OwnerOrganizations::create`: the limit comes from
  `Allowances::resolve(account, 'organizations')`; the lock and count are unchanged.
- `Billing/Services/BillingAccounts::move`: wrapped in `RetentionGuard`. Data point
  attribution follows the assignment history (R8).
- `Administration/Http/Controllers/PlatformOrganizationController@store`: optional
  `plan_uuid` or `trial` with a new account.
- `Audit/Services/ActivityCatalogue`: the new events in
  [data-model.md](data-model.md#audit-events-activitycatalogue).
- Spec 011's SMS sender, when it is built: `Usage::reserve` before handing a message
  to Twilio, and `Usage::release` if Twilio refuses it before accepting.

### Runtime (`services/runtime`)

- `internal/storage/store.go`, `PersistResult`: keep each observation and diagnostic
  insert's `RowsAffected()`. After the readings loop, if the sum is above 0, upsert
  `usage_data_points (organization_uuid, date_trunc('hour', now()))` with `count =
  count + sum`. Return the inserted count alongside the existing boolean, which keeps
  its meaning for callers.
- `internal/storage/usage.go` (new):
  - `ReportUsage(ctx, now)` selects the candidate buckets, builds events of at most
    500 buckets with `final_through = date_trunc('hour', now - 1 minute)`, and inserts
    them into the outbox with UUID v5 ids and `ON CONFLICT DO NOTHING`. In the same
    transaction it updates `reported_count` and `reported_final`.
  - `PruneUsage` removes buckets older than 40 days.
- `internal/app/application.go`: a 60-second ticker calls `ReportUsage`, beside the
  heartbeat. Pruning joins the existing 24-hour maintenance.
- `internal/devices/types.go`: the payload types. The contract files are listed in
  [the event contract](contracts/usage-data-points-event.md).
- Tests:
  - an integration test that duplicates, content-match skips and calculated readings
    count exactly;
  - a reporter test for cumulative, final and watermark behaviour, with
    `AssertProduced`;
  - a pruning test.

### HTTP

Routes and bodies are in [contracts/billing-api.md](contracts/billing-api.md). Routes
live in `app/Domain/Billing/routes/api.php`; the manager route lives in the Devices
or Billing tenant group with `Device.manage`. Cashier's own routes are switched off
(`Cashier::ignoreRoutes()`); the webhook is the domain's `StripeWebhookController` at
`POST /api/stripe/webhook`, extending Cashier's with its signature check.

### Contract and client

- `contract:export` picks up the new admin, owner and tenant operations under the
  tags `Billing`, `Platform billing` and `Usage`. Supplements in
  `contracts/openapi/supplements/billing.yaml` cover the allowance maps, the 409
  confirmation bodies and the PDF/CSV responses.
- `packages/api-client/src/billing.ts` gains the plan, allowance, usage, price,
  invoice, line, credit note, payment, tax rate, settings and trial types. `index.ts`
  gains the methods, named after the routes.

### Kit

`AllowanceMeter` (`packages/ui/src/components/allowance-meter.tsx`) shows one
allowance: count, allowance or "Unlimited", what is left or the overage, and a
"Provisional"/"Last reported" note via `Freshness`. Its status comes from `statusOf`.
It has a story in `apps/storybook` and is the only new kit component.

### Admin (`apps/admin`)

- **Plans**:
  - `PlansPage`: `CollectionPage` + `DataTable` with name, allowances, price this and
    next month, accounts and archived; search and archived filter.
  - `PlanDialog`: name, description, an allowance per kind with an **Unlimited**
    toggle, retention with **Platform default**.
  - `PlanPricesDialog`, and `PlanPage` (Panels: Allowances, Prices, Accounts,
    History).
  - The confirmation dialog states the accounts affected, plus the retention deletion
    date and organizations when retention is shortened.
- **Billing account page** (existing `BillingAccountPage`), with new Panels:
  - **Plan**: change plan with a `SearchableSelect` of unarchived plans; start, change
    or end a trial.
  - **Allowances**: `AllowanceMeter`s, source badges, override dialogs.
  - **Usage**: month picker, organizations table.
  - **Prices**: overrides from next month.
  - **Billing details**: address, tax number, tax rate `SearchableSelect`.
  - **Invoices**: `DataTable` with number, month, total, payment status.
  - **Payment method**: display only.

  The Details dialog loses the organization limit field.
- **Billing accounts list**: plan column and filters for plan, 80% or more used
  (monthly allowances and the device limit), trial (active, ending in 7 days, ended
  without a card) and past due.
- **New organization dialog**: under **New billing account**, an optional plan or
  trial.
- **Billing settings page** (`/settings/billing`): operator details and prefixes, a
  tax rates `DataTable` with a dialog, currency and "Payments: on/off" shown
  read-only.
- **Invoices**:
  - `InvoicesPage` (`/billing/invoices`): tabs for Drafts, Waiting for usage, Issued
    and Unpaid.
  - `InvoicePage`: lines, usage, credit notes and payments in Panels. A sticky action
    bar (`keepToastsAbove`) holds Recalculate, Add adjustment, Issue, Credit note,
    Record payment and Check with Stripe. PDF and CSV links.
- **Settings → Retention**: the source label gains "Billing account", and pending
  reductions show "N days from {date}".
- Nav: **Plans** and **Invoices** after Billing accounts, and **Billing** under
  Settings. All are gated on `manage_organizations`, as Billing accounts already is.

### Portal (`apps/portal`)

- **Billing accounts** (`billing/BillingAccountsPage`) becomes an `EntityPage` per
  selected account with Panels:
  - **Plan**: name, prices (this month's, and next month's when they change), trial
    banner with end date, "Add a card to keep your plan" when a trial is ending or
    ended without a card. SMS is hidden when the deployment has no SMS provider.
  - **Usage**: `AllowanceMeter`s per kind, organizations' shares, month picker.
  - **Invoices**: issued invoices and credit notes, `Status` for payment status,
    **Pay** for unpaid ones, PDF and CSV.
  - **Payment method**: brand, last four, expiry; **Add card**, **Replace** and
    **Remove**, which redirect to Stripe.
  - **Organizations**: the existing table.

  A `?invoice=` deep link from emails opens the invoice and its **Pay** button.
- **Settings → Usage** (`settings/Usage.tsx`, a new `SettingsPage` section gated on
  Device.manage): this organization's devices, data points, retention, and what is
  left on the account.
- **Settings → Notifications**: spec 028's alert and SMS allowances for the
  organization, from the same usage endpoint.
- **Device activation refusals**: they show the 422 message in the existing error
  surface (activation dialog, lifecycle switch, bulk onboarding item reason).

### Emails (`DeliverBillingEmail` + text Mailables in `resources/views/billing/`)

| Email | To | When |
| --- | --- | --- |
| Usage at 80% / used up (alerts, SMS, devices, data points) | owners | first crossing per allowance and month |
| Retention shortened / deletion in 7 days | owners | at the change / 7 days before the floor ends |
| Trial ends in 7 days / 1 day; trial ended | owners | hourly job; at the end |
| Invoice issued; credit note issued | billing contact + owners | at issue |
| Receipt | owners | payment succeeded |
| Payment failed; payment reminder | owners | failure; due date and 7 days after |

Each email names the account and links to the portal's billing page. None contains
card data.

### Scheduler (`routes/console.php`)

`billing:end-trials` hourly at :05 (`hourlyAt(5)`), then daily: `billing:device-peaks`
00:15, `billing:draft-invoices` 02:10, `billing:prune` 03:30,
`billing:retention-warnings` 08:00 and `billing:payment-reminders` 09:00 (retries,
reminders, past due). Each runs `->withoutOverlapping()` and accepts `--now=` for
tests and the quickstart.

### Documentation

- `docs/features/billing.md` (new) covers plans, allowances, usage, device limit,
  data points, retention, invoices, payments and trials, plus the API. It is linked
  from `docs/features/access.md`'s Billing accounts section, which drops the typed
  limit.
- `docs/features/devices.md`: Retention (the billing step and grace) and Lifecycle
  (the device limit).
- `docs/features/alerts.md`: alert allowance and overage (028 FR-026).
- `docs/reference/events.md`: `usage.data_points.v1`.
- `docs/ops/`: Stripe keys and webhook setup, `BILLING_CURRENCY`.
- In-product help: a `billing-usage` article for **Settings → Usage**, and a
  paragraph in the alert notifications article (028 FR-026). Help is per
  organization, so the owner's page carries its own one-line explanations (as spec
  023 found).
- `docs/dev/gotchas.md`:
  - devices hold a place from activation, not from runtime confirmation;
  - invoices never change after issue;
  - use Stripe test keys only from `.local/`.

## Project Structure

### Documentation (this feature)

```text
specs/029-billing-tier-limits/
├── spec.md
├── plan.md                         # this file; covers spec 028 too
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/billing-api.md
├── contracts/usage-data-points-event.md
├── contracts/stripe-webhooks.md
├── checklists/requirements.md
└── tasks.md                        # /speckit-tasks
specs/028-pricing-plans/plan.md     # points here
docs/adr/ADR-035-plans-and-allowances.md
docs/adr/ADR-036-runtime-counts-data-points.md
docs/adr/ADR-037-invoices-and-card-payments.md
```

### Source Code (repository root)

```text
apps/api/composer.json                                    # laravel/cashier, dompdf/dompdf
apps/api/config/billing.php, config/cashier.php           # new
apps/api/database/migrations/2026_11_*_billing_*.php      # new, one per delivery step
apps/api/app/Domain/Billing/
├── Models/BillingPlan.php, PlanAllowance.php, PlanPrice.php, PlanAssignment.php,
│   AllowanceOverride.php, PriceOverride.php, Usage*.php, Invoice.php, InvoiceLine.php,
│   CreditNote.php, Payment.php, TaxRate.php, BillingSettings.php, Notice.php
├── Models/BillingAccount.php                             # Billable, new relations
├── Services/Plans.php, Allowances.php, PlanAssignments.php, Usage.php, DeviceLimit.php,
│   DataPointReports.php, Prices.php, BillingSettings.php, TaxRates.php,
│   InvoiceDrafter.php, InvoiceIssuer.php, CreditNotes.php, Payments.php, Trials.php,
│   Notices.php, InvoicePdf.php
├── Services/OwnerOrganizations.php, BillingAccounts.php  # changed
├── Listeners/StripeEvents.php
├── Jobs/ChargeInvoice.php, DeliverBillingEmail.php
├── Mail/*.php
├── Console/EndTrials.php, DraftInvoices.php, RetentionWarnings.php,
│   PaymentReminders.php, PruneBilling.php
├── Http/Controllers/Platform*.php, Owned*.php, OrganizationUsageController.php
├── Http/Requests/*, Http/Resources/*
├── Providers/BillingServiceProvider.php
└── routes/api.php
apps/api/resources/views/billing/                          # mail text, invoice PDF
apps/api/app/Domain/Automation/Services/AlertProjector.php
apps/api/app/Domain/Devices/Services/DeviceConfigurationService.php, DeviceLifecycleService.php,
  RetentionService.php, RetentionGuard.php (new)
apps/api/app/Domain/Devices/Http/Controllers/RuntimeController.php, DeviceController.php
apps/api/app/Domain/Administration/Http/Controllers/PlatformOrganizationController.php
apps/api/app/Domain/Administration/Services/OrganizationDeletion.php
apps/api/app/Domain/Audit/Services/ActivityCatalogue.php
apps/api/routes/console.php
apps/api/tests/Feature/Domain/Billing/                    # new
services/runtime/internal/storage/schema.sql, store.go, usage.go (new),
  usage_integration_test.go (new)
services/runtime/internal/app/application.go
services/runtime/internal/devices/types.go
contracts/internal/events/usage.data_points.v1.{schema,fixture,cases}.json  # new
contracts/internal/catalogue.json
contracts/openapi/openapi.json, contracts/openapi/supplements/billing.yaml
packages/api-client/src/billing.ts, src/index.ts
packages/ui/src/components/allowance-meter.tsx            # new, with story
apps/storybook/src/stories/AllowanceMeter.stories.tsx     # new
apps/admin/src/pages/PlansPage.tsx, PlanPage.tsx, InvoicesPage.tsx, InvoicePage.tsx,
  BillingSettingsPage.tsx                                 # new
apps/admin/src/pages/BillingAccountPage.tsx, BillingAccountsPage.tsx, RetentionPage.tsx
apps/admin/src/components/Plan*.tsx, Allowance*.tsx, Trial*.tsx, Invoice*.tsx,
  TaxRateDialog.tsx                                       # new
apps/admin/src/components/OrganizationDialog.tsx, BillingAccountChoice.tsx,
  BillingAccountDialog.tsx
apps/admin/src/App.tsx, layout/AdminLayout.tsx
apps/portal/src/billing/*.tsx
apps/portal/src/settings/Settings.tsx, settings/Usage.tsx (new)
apps/admin/e2e/billing-*.spec.ts, apps/portal/e2e/billing-*.spec.ts
docs/features/billing.md (new), access.md, devices.md, alerts.md
docs/reference/events.md, docs/dev/gotchas.md, docs/ops/
apps/api/resources/help/billing-usage.md (new), alert-notifications.md
```

**Structure Decision**: billing stays one Laravel domain, `App\Domain\Billing`, which
spec 023 created. Automation, Devices and Administration change only at the named
calls. The runtime adds one table, one counter path and one reporter. The UI lives
with the apps, with one new kit component.

## Delivery

Every pull request is based on `main`. "After" names the pull requests that must have
merged first. Pull requests with no dependency between them may be open at the same
time. None is stacked. Each one rebuilds the services it touches, runs its quickstart
section, ticks its tasks and updates its docs.

| # | Pull request | Specs | After | Rebuild |
| --- | --- | --- | --- | --- |
| 1 | **Documents**: this folder, the 028 pointer plan, ADR-035–037 and their index rows, ADR-026 "amended by ADR-035", the spec 029 retry assumption | both | — | — |
| 2 | **Plans and allowances (API)**: plans, allowances, overrides, assignments, the organization limit move, `Allowances::resolve`, admin endpoints, organization creation with a plan, contract, client, `docs/features/billing.md` (plans) | 028 US1–2, 029 US1 | 1 | api |
| 3 | **Plans in admin**: Plans pages and dialogs, the account's Plan and Allowances panels, the New organization plan choice, the list plan filter, Playwright | 028 US1–2, 029 US1 | 2 | admin |
| 4 | **Usage and alert counting (API)**: usage tables, `Usage` with SMS reserve and release, alert counting, usage endpoints (admin, owner, manager), threshold emails, the 80% filter, `docs/features/alerts.md` | 028 US3–4 | 2 | api |
| 5 | **Device limit**: `limit_place_at`, claim and release in both activation paths and `device.failed.v1`, peaks, device usage in the endpoints, bulk onboarding reason | 029 US2 | 4 | api |
| 6 | **Data point counting**: the runtime counter, reporter and pruning, the `usage.data_points.v1` contract, Laravel intake and watermark, load measurement | 029 US3 | 4 | runtime, api |
| 7 | **Usage pages**: `AllowanceMeter` with story, the admin Usage panel, portal Billing accounts usage, **Settings → Usage** and **Settings → Notifications** allowances, help article | 028 US4, 029 US5 | 4 | admin, portal |
| 8 | **Retention follows the plan**: the billing step, floors and `RetentionGuard`, cleanup days in `/state`, emails, **Settings → Retention** source and pending reduction | 029 US4 | 4 | api, admin |
| 9 | **Prices, tax and invoices (API)**: settings, tax rates, plan prices, price overrides, drafting, adjustments, issue, numbering, credit notes and credit, PDF/CSV, emails, the delete guard on accounts, dompdf | 029 US6 | 4, 6 | api |
| 10 | **Invoices in admin and portal**: Billing settings page, tax rates, prices dialogs, Invoices and Invoice pages, the account's Invoices and Billing details panels, the portal invoices panel | 029 US6 | 9 | admin, portal |
| 11 | **Card payments (API)**: Cashier, customer columns, checkout endpoints, charging on issue, the webhook listener and ledger, retries, reminders, past due, outside payments, reconcile, ops docs | 029 US7 | 9 | api |
| 12 | **Payments in admin and portal**: payment method panel and redirects, Pay on invoices, payment status, the past-due filter, admin payment actions | 029 US7 | 11 | admin, portal |
| 13 | **Trials**: trial and `trial_unpaid` assignments, start, change, end and convert, the end-trials job, the card rule, emails, filters, the admin and portal trial UI | 029 US8 | 8, 11 | api, admin, portal |
| 14 | **Wrap-up**: `/speckit-converge`, docs cross-links, gotchas, spec folders frozen | both | 2–13 | — |

Spec 011's SMS pull request calls `Usage::reserve` and `Usage::release` once pull
request 4 has merged.

## Complexity Tracking

No violations. The two new dependencies (Cashier, dompdf) are justified in research
R13 and R15 and recorded in ADR-037.
