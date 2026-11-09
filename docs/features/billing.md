# Billing

Plans, the allowances they give billing accounts, and what accounts use
([spec 028](../../specs/028-pricing-plans/spec.md),
[spec 029](../../specs/029-billing-tier-limits/spec.md),
[ADR-035](../adr/ADR-035-plans-and-allowances.md)). Billing accounts themselves, the
payer of record for one or more organizations, are described under
[Access](access.md#billing-accounts). Prices, tax, invoices, card payments and trials
are below ([the billing plan](../../specs/029-billing-tier-limits/plan.md)).

Code: Laravel [`Domain/Billing`](../../apps/api/app/Domain/Billing) (resolution:
[`Allowances`](../../apps/api/app/Domain/Billing/Services/Allowances.php), plans:
[`Plans`](../../apps/api/app/Domain/Billing/Services/Plans.php), assignments:
[`PlanAssignments`](../../apps/api/app/Domain/Billing/Services/PlanAssignments.php),
usage: [`Usage`](../../apps/api/app/Domain/Billing/Services/Usage.php), warnings:
[`UsageThresholds`](../../apps/api/app/Domain/Billing/Services/UsageThresholds.php) and
[`Notices`](../../apps/api/app/Domain/Billing/Services/Notices.php), invoices:
[`InvoiceDrafter`](../../apps/api/app/Domain/Billing/Services/InvoiceDrafter.php),
[`InvoiceIssuer`](../../apps/api/app/Domain/Billing/Services/InvoiceIssuer.php) and
[`CreditNotes`](../../apps/api/app/Domain/Billing/Services/CreditNotes.php), trials:
[`Trials`](../../apps/api/app/Domain/Billing/Services/Trials.php)), defaults in
[`config/billing.php`](../../apps/api/config/billing.php).

## Plans and allowances

A **plan** is a named set of allowances, one per pricing tier. It stores no price.
Each allowance has a kind:

| Kind | What it limits | Deployment default |
| --- | --- | --- |
| `alerts` | automation alert activations per calendar month (UTC) | unlimited |
| `sms` | SMS parts per month | `BILLING_DEFAULT_SMS_ALLOWANCE`, 0 if unset |
| `devices` | active devices at once | unlimited |
| `data_points` | stored readings per month | unlimited |
| `retention_days` | days of telemetry history (1 to 36,500) | the platform's retention setting |
| `organizations` | organizations owners may create under the account | 1 |

A value is a whole number of 0 or more, or **unlimited** (`null`). Retention is never
unlimited. A plan lists only the kinds it sets; a kind it leaves out falls back to
the deployment default.

A billing account has at most one plan at a time. Its allowance for each kind is its
**override**, else its plan's allowance, else the deployment default
(`Allowances::resolve`). An override has a note, survives plan changes, and is
removed to fall back to the plan.

- **Assignments.** `billing_plan_assignments` records which plan an account was on
  from when to when, and how (`paid`, `trial`, `trial_unpaid`). Changing or removing
  a plan closes the open period and opens the next at the same instant, under the
  account's row lock. A partial unique index allows one open period per account, and
  a gap means no plan. `PlanAssignments::at()` tells which plan applied at any moment.
- **Editing a plan** changes every account on it at once. When accounts are on it,
  changing its allowances needs `confirm_affected` set to their number; the 409 says
  how many. To keep customers on old terms, create a new plan and archive the old one.
- **Archived plans** stay on their accounts and cannot be newly assigned. A plan that
  was ever assigned cannot be deleted, only archived.
- **The organization limit** that spec 023 typed into each account is the
  `organizations` allowance. The rollout kept every raised limit as an override noted
  "Organization limit before plans". Owners are still refused at the limit, under the
  account's row lock, and platform administrators are not bound by it. The account's
  `organization_limit` field reads it; create and update no longer accept it, so it
  changes only as an override.
- **Rollout** assigns no plan, so every account keeps today's behaviour until an
  administrator assigns one.

Every change is audited: `billing_plan.created`, `updated` (with each changed
allowance), `archived`, `restored` and `deleted` on the plan, and
`billing_account.plan_assigned`, `plan_removed`, `allowance_overridden` and
`allowance_override_removed` on the account. The account's history shows plan and
allowance changes as updates; the plan's page shows its own history.

## Admin app

Every page below needs `PlatformAdministration.manage-organizations`. `GET me` sends it
as `capabilities.manage_organizations`, and without it the admin app shows neither the
entries nor the routes: a platform administrator who may only manage retention opens on
**Settings → Retention** (spec 028 US1/AC6, [access](access.md)).

- **Plans** (after Billing accounts in the sidebar) lists current plans with their
  allowances and how many accounts are on each; the Status filter shows archived or
  all plans. **New plan** and **Edit** open one dialog: a field per allowance, empty
  for the deployment default, with an **Unlimited** switch (retention has none; empty
  means the platform setting). Editing a plan that accounts are on asks to confirm
  how many it changes. A plan that was ever assigned can only be archived.
- **A plan's page** shows its allowances, its **Prices** (this month's, and next
  month's when a change waits), the accounts on it (with paid or trial) and its
  history. **Set prices** opens a dialog that says which day the prices apply from.
- **A billing account's page** has a **Plan** panel (change or remove the plan) and an
  **Allowances** panel listing each kind with its value, where it comes from
  (override, plan or default) and the override's note, with **Override** and
  **Remove override**. Its **Usage** panel has a month picker (this UTC month and the
  eleven before it), a meter per allowance and each organization's share. The account
  list has a Plan column and filter, and a Usage filter: **80% or more used** or
  **Used up**, the device limit included.
- The account's **Prices** panel lists each price this month and from next month, with
  **Override** (a value and a note, from next month) and **Remove override**; an account
  without a plan has none. **Billing details** holds its address, tax number and tax
  rate (a searchable picker; archived rates are not offered). **Invoices** lists its
  latest twelve, and **Draft invoice** drafts a month now, with a note.
- **Invoices** (after Plans) has four tabs: **Drafts**, **Waiting for usage** (each
  account's wait, overdue after three days, with **Draft anyway**), **Issued** and
  **Unpaid** (pending or failed). A notice counts accounts waiting too long.
- **An invoice's page** shows its lines, each organization's usage, its credit notes
  (with their PDF and CSV), its history and, on the right, the totals and who it is
  billed to. A sticky bar holds the PDF and CSV and, on a draft, **Recalculate**, **Add
  adjustment** (a credit or a charge, a printed description and a private note) and
  **Issue**, which asks first because an issued invoice never changes. A draft of the
  running month is a preview: **Issue** waits until the month ends, and the bar says
  from when. An issued invoice has **Credit note** instead, up to what is not yet
  credited. An invoice drafted before its usage was final keeps that mark once issued.
- **Settings → Billing** holds the operator's details and number prefixes (a stale save
  says someone else saved and offers to load their version), the deployment's currency
  and whether card payments are on, both read-only, and the tax rates with **Add tax
  rate**, **Edit** and **Archive**. Percentages take up to two decimals and are stored
  as basis points.
- **Payments** (spec 029 US7). The account list marks accounts **Past due** and filters
  them (Payment: Past due); the account's page shows the mark with since when, and a
  **Payment method** panel with the card's brand, last four digits and expiry. An issued
  invoice's page has a **Payments** panel (card charges by attempt, Checkout payments and
  payments recorded by hand, each with its status and the card issuer's reason or the
  note), **Record payment** (up to what is still owed, with a note) and, while a card or
  Checkout payment is still processing, **Check with Stripe**.
- **Trials** (spec 029 US8). The account's **Plan** panel has **Start trial**: a plan
  (the account's own by default) and a last day (UTC, 30 days by default) or **No end
  date**. During a trial it has **Change trial** (the same dialog), **End trial** and
  **Convert to paid**; a trial that ended without a card keeps **Convert to paid**. The
  account list marks trials, with their last day, and filters them (Trial: On a trial,
  Ending within 7 days, Ended, no payment method).
- **New organization** with a new billing account can start it on a plan, or on a trial
  of it (**Start on a trial**).

Money is formatted with `formatMoney` from `@iot-os/ui/lib/money` in the reader's
locale and typed in major units (`parseMoney`); invoice months, due days and the
`payment`, `invoice` and `invoice_payment` status domains come from
`@iot-os/ui/lib/invoices` and the kit's status vocabulary.

## Usage

`Usage` counts what each billing account uses per UTC month: alerts, SMS and data
points (from the runtime's reports, below). Devices are a level, kept by `DeviceLimit`
(below). Organizations on an account share its allowances.

- **Tables.** `billing_usage` holds the account's `count` and `overage` per kind and
  month (the month is its first day). `billing_usage_shares` holds each organization's
  share under the name it had; it stays when the organization is deleted
  (`OrganizationDeletion::KEPT`) or moves to another account, so past months keep
  adding up. `billing_overage` records which plan assignment each unit of overage
  happened under (none when the account had no plan), which is what invoices will
  price.
- **Exact.** Every write inserts the month's row if needed and locks it, so concurrent
  counts for one account, kind and month serialize. A share is only written under that
  lock.
- **Overage** is the part of a count beyond the allowance at that moment:
  `max(0, min(quantity, count after − allowance))`. It is fixed when counted, so a plan
  change, plan edit or override mid-month applies only to what is left, and nothing
  already counted moves. Unlimited is counted and never has overage.
- **Alerts** count once per automation alert activation, in `AlertProjector`'s
  transaction, in the month the platform records it, and never stop the alert
  ([alert allowance](alerts.md#alert-allowance)).
- **SMS** are reserved, not counted after the fact (see below), and never have overage.
- **What a month shows.** `allowance` is the account's allowance now and `left`
  follows from it (0 once used up); `overage` is what was recorded at the time. Months
  stay readable for as long as the account exists.

### Device limit

Devices are a level, not a monthly amount
([spec 029](../../specs/029-billing-tier-limits/spec.md) US2, research R7,
[`DeviceLimit`](../../apps/api/app/Domain/Billing/Services/DeviceLimit.php)). A device
holds a place while `devices.limit_place_at` is set: from the moment its activation is
accepted until its deactivation is accepted or it is archived
([devices](devices.md#device-limit)).

- **Claiming.** `DeviceConfigurationService::activate` (first activation or a new
  configuration) and `DeviceLifecycleService::request` (reactivation) claim a place with
  the device row locked. `claim` then locks the billing account row, counts the places
  in the account's organizations and refuses at the limit with a 422 on `device`, so
  concurrent activations across organizations never pass it. A device that already
  holds a place keeps it: reconfiguring or rolling back is never refused.
- **Releasing.** Both deactivation paths release when the request is accepted, archive
  releases, and `device.failed.v1` releases for a device that is not active (a failed
  first activation or reactivation). A failed deactivation takes the place back without
  a check.
- **Over the limit.** Lowering the limit or moving an organization in deactivates
  nothing; usage shows `over_limit` and activations are refused until it is back below.
- **Bulk onboarding.** The refusal is a `DeviceLimitReached`, a 422 like any other, which
  bulk onboarding tells apart: each source beyond the limit stays registered with its
  device and the reason, and its item fails, so **Retry failed** activates the same
  devices once the limit is raised ([devices](devices.md#bulk-onboarding)).
- **Peak.** `billing_device_peaks` keeps each month's highest count. Claims raise it
  with the count after, releases with the count before, and `billing:device-peaks`
  (daily at 00:15 UTC) records each account's current count, for a month in which
  nothing changed.
- **Warnings** at 80% and 100% of the limit go to owners once per threshold and month
  (`devices:{YYYY-MM}:{80|100}`), as for the monthly kinds.
- **Usage.** The `devices` entry's `count` is the devices holding a place now, with
  each organization's share; an earlier month shows its peak. It has `peak_this_month`
  and `over_limit`, and no overage. The `usage_at_least` filter includes the current
  device count.
- **Rollout** gives a place to every active device, unless its deactivation is already
  accepted, and to every device whose activation is outstanding.

### Data points

A data point is a stored reading
([spec 029](../../specs/029-billing-tier-limits/spec.md) US3,
[ADR-036](../adr/ADR-036-runtime-counts-data-points.md)). Telemetry never reaches the
control plane: the runtime counts what it stores and reports cumulative counts per
organization and UTC hour (`usage.data_points.v1`,
[events](../reference/events.md#data-point-usage)).

- **Intake.** [`DataPointReports`](../../apps/api/app/Domain/Billing/Services/DataPointReports.php)
  keeps the highest count seen per bucket in `billing_data_point_buckets`, under its
  row lock, and counts only the increase through `Usage::add`, in the bucket's month.
  Replays, lower counts and reports out of order change nothing.
- **Attribution.** A bucket is fixed, when first seen, to the billing account whose
  assignment covered its hour (`billing_account_assignments`), so an hour before a
  move counts for the old account and an hour after it for the new one. A bucket of an
  organization that no longer exists is kept with no account and is not counted.
- **Overage.** Readings are never stopped; what goes past the allowance is overage, as
  for alerts.
- **Finality.** `billing_usage_watermarks` keeps the runtime's `final_through`, which
  only moves forward, and when it last reported: the newest report's `generated_at`
  (never later than now), not when the report arrived, so a backlog of events reads as
  late. A month's `data_points` entry is
  `final` once the watermark passes the month's end; until then the count may still
  grow. It is `stale` when an open month has not been reported for longer than
  `BILLING_USAGE_REPORT_STALE_SECONDS` (300 by default), for example while the
  runtime or the control plane is down; the counts catch up exactly when it returns.
- **Pruning.** `billing:prune` removes buckets older than 13 months; the monthly totals
  stay in `billing_usage`.
- **Cost to ingestion** (SC-004). Counting adds one upsert to each storing transaction.
  On the dev stack on 2026-11-08 we measured, at the tested rate (503 simulated water
  meters, each reporting every 10 s, 50 messages a second), the time from the runtime
  receiving a message to it being visible in history, with
  [`tooling/measure-history-latency.py`](../../tooling/measure-history-latency.py).
  We ran 10 minutes with counting, 10 without (a temporary build without the upsert),
  then 10 with counting again:

  | Run | Messages | p50 | p95 | p99 | Queue p50 |
  | --- | --- | --- | --- | --- | --- |
  | With counting | 30,152 | 62 ms | 108 ms | 126 ms | 6 ms |
  | Without counting | 30,045 | 61 ms | 106 ms | 113 ms | 4 ms |
  | With counting again | 30,031 | 64 ms | 111 ms | 119 ms | 6 ms |

  - **Within 5%.** p50 and p95 stay within 5% in both counting runs (p50 +1.6% and
    +4.9%, p95 +1.9% and +4.7%). The two counting runs differ from each other by about
    as much as either differs from the run without.
  - **Absolute cost.** Counting adds about 2 ms before storing starts. The probe polls
    every 100 ms, which adds about 50 ms to every figure.
  - **Tail.** Each counting run had 6–7 messages over 500 ms (at most 1.5 s); the run
    without had none. They came near the database's five-minute checkpoints, one of
    which took 1.1 s to sync.
  - **Readings kept.** No reading was dropped in any run.

### SMS allowance

Spec 011's SMS sender, when it is built, goes through
[`Contracts\SmsAllowance`](../../apps/api/app/Domain/Billing/Contracts/SmsAllowance.php),
bound to `Usage`:

- `reserve(account, organization, parts, at)` before handing a message to the
  provider. Under the row lock it counts the parts when they fit in what is left, and
  answers `false` otherwise; the sender then cancels the message with "SMS allowance
  used up for this month", and the other channels are unaffected. Two messages
  competing for the last part: one goes, the other is cancelled.
- `release(account, organization, parts, reservedAt)` when the provider refuses the
  message before accepting it. It gives the parts back to the month they were
  reserved in, never below 0.

Verification codes never reserve anything. The allowance is the account's (override,
else plan, else `BILLING_DEFAULT_SMS_ALLOWANCE`), not a per-organization number.

**SMS not configured.** The deployment can send SMS when spec 011's Twilio settings,
`TWILIO_ACCOUNT_SID` and `TWILIO_FROM` (`config/services.php`), are set
(`Usage::smsAvailable()`). Without them, owners and managers see no SMS allowance or
usage; platform administrators still do.

### Warnings

When a limited allowance passes 80% (`count ≥ ⌈allowance × 0.8⌉`) and again when it
is used up, each owner of the account gets one plain-text email
([`UsageThresholdMail`](../../apps/api/app/Domain/Billing/Mail/UsageThresholdMail.php))
naming the account, the allowance, what is used and left, and linking to
`/billing?account={uuid}` in the portal.

- Once per threshold, allowance and month: `Notices` inserts a `billing_notices` row
  keyed `{kind}:{YYYY-MM}:{80|100}` and queues the emails in the same transaction only
  when it was inserted. An allowance that jumps past both thresholds at once sends both.
- Thresholds are checked after the counting transaction commits. Unlimited allowances
  send nothing, and an account with no owners gets no notice.
- `DeliverBillingEmail` sends one email per owner on the `alerts` database queue (five
  tries, backoff 1, 5 and 15 minutes), and skips anyone who is no longer an owner or
  has no verified address by then.
- `billing:prune` (daily at 03:30) deletes notices older than 13 months; every key
  carries its month, so a pruned key is never due again.

### Who sees usage

| Who | Where | What |
| --- | --- | --- |
| Platform administrators | `admin/billing-accounts/{uuid}` and its `usage` route | Every kind, every month, each organization's share |
| Owners | `billing-accounts` and `billing-accounts/{uuid}/usage` | Their accounts: plan, allowances, usage and each organization's share; 404 for anyone else's |
| Members with `Device.manage` | `organizations/{uuid}/usage` | This month: their organization's own counts, and the account's allowance, what is left and the overage; never the account's name, its other organizations or prices |
| Other members | | Nothing (403) |

In the apps (spec 029 US5):

- **Meters.** `AllowanceMeter` in `@iot-os/ui` shows a count, of how much or
  **Unlimited**, what is left or the overage, a bar and a `usage` status: within the
  allowance under 80%, **80% or more used**, **Used up**, and for devices **Over the
  limit**. An allowance raised past the count shows what is left beside the month's
  overage ("760 alerts left · 240 alerts of overage", `allowanceLine`), and so does
  Settings → Usage. An earlier month shows its count and overage only, without today's
  allowance, bar or status: the allowance may have changed since, and no history of it
  is kept. Data points read **Provisional** with when the runtime last reported (late
  after five minutes, the API's `stale`) until their month is **Final**. The age keeps
  ticking on a page left open (`useNow` in the kit drives every `RelativeTime` and
  `Freshness`), and the portal asks for usage again every minute. `UsagePanel`
  combines the meters, a month picker and each organization's share; the admin
  account page and the portal's Billing accounts page both use it.
- **Owners** see the chosen account on **Billing accounts** (`/billing?account=`) with
  a **Plan** panel (the plan and since when, each allowance, retention included), the
  **Usage** panel and its **Organizations**.
- **Managers** see **Settings → Usage**, shown only with `Device.manage`: their
  organization's active devices, data points, alerts and SMS this month, what is left
  of each on the account (never its own count), and its retention with where it comes
  from and any pending reduction. **Settings → Notifications** shows the alert and SMS
  allowances the same way above its workflows. The Help guide is `billing-usage`.

## Retention

An organization's telemetry retention follows its billing account when it has no
override of its own ([spec 029](../../specs/029-billing-tier-limits/spec.md) US4,
research R10, [devices](devices.md#retention)): the account's `retention_days`
allowance from its plan or an account override, else the platform default. The
deployment default for `retention_days` is none, so rollout changed no organization's
retention.

- **Confirmation.** A plan change or removal, a plan edit, a retention override or its
  removal, and moving an organization to another account run inside
  [`RetentionGuard`](../../apps/api/app/Domain/Devices/Services/RetentionGuard.php).
  It compares each organization's effective retention before and after, in one
  transaction. If any falls, the API answers 409 with `retention.organizations` (each
  `from_days` and `to_days`) and `retention.deletion_from`, and changes nothing until
  the request is repeated with `confirm_retention: true`. The admin app shows that
  confirmation. Lengthening applies at once.
- **Grace.** Once confirmed, each shortened organization gets a
  `telemetry_retention_floors` row holding the previous period for
  `BILLING_RETENTION_GRACE_DAYS` (30). The cleanup days sent to the runtime in `/state`
  are the effective period raised to any running floor, so two reductions in a row
  keep the longest period of the last 30 days, and undoing a change in time deletes
  nothing. Organizations with their own override are untouched.
- **Emails.** Owners get [`RetentionReducedMail`](../../apps/api/app/Domain/Billing/Mail/RetentionReducedMail.php)
  at each change (`retention_reduction`, keyed by its floor, so a second change the same
  day is emailed too), and `billing:retention-warnings` (daily at 08:00) sends it again
  7 days before the floor ends (`retention_warning`, once per organization and date),
  unless the change was undone. `billing:prune` removes floors that ended.
- **Direct changes** on Settings → Retention (an organization override or the platform
  default) keep their immediate behaviour and make no floor. A confirmed shorter
  organization override also ends that organization's running floors, so it applies at
  the next cleanup (FR-021). The retention response carries `cleanup_days` (what cleanup
  uses now, longer during a grace) and `default_days` (the platform's own fallback, 400
  by default). The confirmation reduces from what cleanup uses and says it ends the
  grace.

## Prices and invoices

Spec 029 US6, research R11–R14. Amounts are integers in the minor units of one
currency per deployment (`BILLING_CURRENCY`, default `USD`), shown with two decimals;
every division rounds half up.

- **Prices.** A plan has a monthly base price, a price per alert over the allowance and
  a price per block of data points over it, with the block size (`billing_plan_prices`).
  A platform administrator can override any of them for one account, with a note
  (`billing_price_overrides`; a null value goes back to the plan's). Every change applies
  from the first day of the next UTC month, so a month is priced from one set of prices.
  A plan with no prices is free. Owners see their own account's prices; managers and
  members never see prices.
- **Settings and tax.** One `billing_settings` row holds the operator's legal name,
  address, tax number, invoice footer and number prefixes (`INV-`, `CN-`), saved with a
  revision (409 when stale). Tax rates are named, in basis points, archived rather than
  deleted. Each account has a billing address, an optional tax number and a rate or none.
- **Drafting.** A month in which the account had no plan cannot be drafted (422, D2).
  `billing:draft-invoices` (daily at 02:10) drafts each ended month's invoice for each
  account that had a plan during it and has none for it, once the runtime has reported
  data points to the month's end. Every month since the first plan assignment is
  checked, so a month the job missed, or whose usage became final late, is drafted on
  the next run. Each UTC day is charged to the assignment in force at 00:00, so a plan
  assigned mid-day starts charging the next day; consecutive days of one assignment make
  one line with the base price prorated by day, and trial days are shown at 0. Overage
  from `billing_overage` is priced per assignment at that plan's prices for the month,
  overrides applied: alerts one by one, data points by whole blocks rounded up, nothing
  during a trial. Each organization's usage is snapshotted with the draft.
- **Waiting.** Until usage is final, accounts wait, for every month that waits; after
  `BILLING_INVOICE_WAIT_DAYS` (3) the waiting list marks them overdue, and an
  administrator can draft anyway with a note, which marks the draft possibly incomplete.
  Issued without recalculating, the invoice keeps the mark in the PDF, admin and portal.
- **Review.** Drafts are recalculated from the records at any time, keeping
  administrators' adjustments (a charge, or a credit with a negative amount, with a note
  only administrators see). The account's credit is stored as a last `credit` line after
  tax, but documents, admin and portal show it once, as a totals row ("Credit from
  CN-…"), so the lines shown add up to the subtotal (`@iot-os/ui/lib/invoices`
  `invoiceLines`).
- **Issuing.** Only once the invoice's month has ended (409 before: a draft of the
  running month is a preview). A draft made before its month's usage was final must be
  recalculated once it is (409 until then, and admin's **Issue** asks for it; the
  detail's `usage_final` says so), so it never goes out without what came in since. In
  one transaction: the next number from a locked counter row
  (`billing_number_sequences`, so no gaps); snapshots of the operator's and the account's
  details and the tax rate; tax on the subtotal; the account's credit applied; due in
  `BILLING_INVOICE_DUE_DAYS` (14). An invoice with nothing to pay is paid. From then on
  only `payment_status` changes; the model refuses any other write.
- **Credit notes** have their own sequence and an amount up to the part of the invoice
  not yet credited. Each takes what it can off what the invoice still owes (`applied`);
  the rest becomes account credit (`billing_account_credits`) for the next invoice, shown
  as "Credit from CN-…". An invoice whose credit notes leave nothing owed reads
  `credited`, and the account's past due is refreshed. The invoice's own figures never
  change: `outstanding` is derived.
- **Documents and email.** PDFs are rendered on request with dompdf from
  `resources/views/billing/invoice.blade.php`; an invoice's CSV holds the lines, totals
  and usage, a credit note's its reason and amounts.
  An issued invoice or credit note is emailed once each to the billing contact and every
  owner (`invoice_issued`, `credit_note_issued` notices), with the PDF attached. Owners
  see issued invoices only; a draft answers 404.
- **Deleting** an account with issued invoices answers 409; otherwise its drafts go with
  it and its plan assignment ends (`account_deleted`), so plan counts and lists leave it
  out.

Issuing dispatches `InvoiceIssued`. With a saved card, it also queues the first charge
([card payments](#card-payments)).

In the portal, an owner's **Billing accounts** page shows the plan's prices on the
**Plan** panel ("from {month}" when they change next month), an **Invoices** panel of
issued invoices with their payment status and due date, and a **Credit notes** panel
when there are any. Opening an invoice (`?invoice={uuid}`, so a link can open it)
shows its lines, totals, credit notes, payments and usage in a sheet, with the PDF to
print or keep and the CSV.

With card payments on, the page also has a **Card** panel (**Add card** or **Replace
card**, which open Stripe's page, and **Remove**, which asks first), a **Pay** button on
each invoice still owed (awaiting payment or failed), and **Pay** in the invoice's sheet,
focused when an email's link opens an unpaid invoice. Back from Stripe (`card=saved`,
`paid=1`), the page asks again every two seconds, up to 20 times, until Stripe's event
has arrived, then says the card was saved or the payment received. A past due account
shows a notice that nothing is restricted. With payments off there is no Card panel or
Pay button.

## Card payments

Spec 029 US7, ADR-037, [contracts/stripe-webhooks.md](../../specs/029-billing-tier-limits/contracts/stripe-webhooks.md).
Setting up Stripe is in [card payments](../ops/billing-payments.md).

- **On or off.** Payments are on when both `STRIPE_SECRET` and `STRIPE_WEBHOOK_SECRET`
  are set (`Payments::enabled()`). While they are off, every payment route and the
  webhook answer 404, accounts and settings say `payments_enabled: false`, and
  administrators record payments by hand.
- **Cards.** A billing account is a Stripe customer through Laravel Cashier (its
  `Billable` trait; Cashier's subscription tables and routes are not used). An owner
  saves a card on a Stripe Checkout page in setup mode. When Stripe reports the session
  complete, the card becomes the customer's default, the old one is detached, and the
  account keeps only its brand, last four digits and `YYYY-MM` expiry
  (`payment_method`). A card removed on Stripe's side is forgotten once the customer
  has no default.
- **Charges.** Issuing queues `ChargeInvoice` (the `database` queue) when payments are
  on, the account has a card and something is due. It records a pending payment first,
  then charges what is still owed off-session, with the idempotency key
  `invoice:{uuid}:{attempt}` and the payment's uuid in the PaymentIntent's metadata:
  attempt 1 at issue, 2 on the due date, 3 seven days after. A retried job sends the same
  request, so Stripe charges once. When every try loses Stripe's answer, the pending
  payment blocks the next attempt and the Checkout page until Stripe's event arrives or
  an administrator checks with Stripe.
- **Paying online.** An owner can pay what is still owed on a Checkout page in payment
  mode, which answers 409 when nothing is owed or a payment is still processing. The
  page expires after 30 minutes (Stripe's minimum), and the invoice's open pages are
  expired once a card charge starts or the invoice is settled.
- **Stripe's events.** `POST /api/stripe/webhook` is verified against the signing
  secret (403 otherwise). Each event id goes into `billing_provider_events` first and is
  acted on only once; `billing:prune` forgets ids after 30 days, longer than Stripe
  retries an event. A payment moves only forward: `pending` to `failed` or
  `succeeded`, `failed` to `succeeded`. A succeeded amount that differs from the charge
  is kept as received and audited for review.
- **Settling.** `outstanding` is the amount due less credit notes' applied parts and the
  payments that succeeded. An invoice becomes `paid` once nothing is owed, or
  `paid_outside` when a payment recorded by hand settled it. A failed charge marks it
  `failed` unless it is already settled.
- **Paid twice.** A payment that succeeds for more than was still owed, such as a
  Checkout page completed after the card was charged, or a charge that was pending
  while a credit note or a payment by hand settled the invoice, keeps the rest. It goes
  to account credit for the next invoice, shown as "Credit from the overpayment of
  INV-…", is audited (`billing_invoice.overpaid`, history `overpaid`), and leaves a
  settled invoice's status as it was.
- **Emails** go to the owners once each:
  - a `receipt` per payment, a payment recorded by hand included (FR-042);
  - a `payment_failed` email with the card issuer's reason, worded for a saved card or
    for Stripe's page as the payment was made;
  - a `payment_reminder` on the due date and seven days after.

  Each links to `/billing?account=…&invoice=…`. The invoice email now links to the
  invoice too.
- **Reminders and past due.** `billing:payment-reminders` (daily at 09:00 UTC,
  `--now=`) sends each reminder once and charges a saved card again, within 30 days of
  the due date; past that the invoice is left to administrators, so a reminder whose
  notice `billing:prune` removed after 13 months is never sent again. Accounts with an
  invoice unpaid after its due date get `past_due_since`, kept from the first day; the
  flag clears once none is. Nothing else changes for the account's organizations
  (FR-043).
- **While a payment is processing.** A card or Stripe page payment Stripe has not
  answered yet sets the invoice's `payment_processing`. The portal shows
  "Payment processing" instead of **Pay**, and reminders wait. The step goes out on a
  later run if the payment fails.
- **By hand.** An administrator records a payment made another way, up to what is still
  owed, with a required note on how it was paid, whether or not cards are on. **Check
  with Stripe** (`reconcile`) asks Stripe about pending payments: by the PaymentIntent, or, for a charge whose
  answer was lost, by searching its metadata for the payment's uuid. Finding none ten
  minutes on, longer than Stripe's search takes to catch up, means the card was never
  charged: the payment fails, the owners are emailed, and the next attempt or **Pay**
  can settle it.

Invoice history adds `payment_recorded`, `payment_succeeded`, `payment_failed` and
`payment_amount_mismatch`; the audit catalogue adds the card's saving and removal.

## Trials

Spec 029 US8, research R4. A trial is a `trial` plan assignment: the plan's allowances,
limits, usage and warnings apply as on any plan, and invoices show its days and its
overage at 0.

- **Limited or open-ended.** `trial_ends_at` is the instant it ends, or null. The admin
  app picks a last day: a trial ending at 00:00 UTC on the 9th runs until the 8th. An
  account has one open trial at most (409).
- **Steps.** Starting, moving to another plan, ending and converting each close the open
  assignment and open the next at one instant (`PlanAssignments::replace`), so the
  history answers "was the account on a trial at instant X". Extending or shortening
  changes `trial_ends_at` in place. A trial's plan can shorten retention, which needs
  confirmation like a plan change. Changing or removing the plan during a trial ends it
  too, audited and emailed as any end ("moved to {plan}" or "no longer on a plan").
- **The card rule** (FR-050). When a trial ends, the account stays on its plan: `paid`
  with a saved card, otherwise `trial_unpaid` ("trial ended, no payment method":
  flagged, still not charged). Saving a card then makes it `paid`
  (`Trials::paymentMethodAdded`, called when Stripe confirms the card), and an
  administrator can convert it. Invoices charge each day by the assignment in force at
  00:00 UTC, so a trial that ends during a day is charged from the next; overage counted
  after the switch is charged.
- **`billing:end-trials`** (hourly at :05, `--now=`) ends trials whose end has
  passed, at their end even when the job runs late (so a trial that ended while the
  control plane was down ends within the hour after it is back), then sends `trial_reminder` emails
  for limited trials ending within 7 days and within 1 day, once each per trial and end
  date (so an extended trial is reminded again). Each asks for a card when none is
  saved. Ending a trial sends `trial_ended` once, saying whether the plan is now charged.
- **Portal.** The owner's **Plan** panel shows "Trial until {day}" or "Trial, no end
  date", and "Add a card to keep your plan" with **Add a card** while a trial ends within
  7 days or ended without a card.

The account's history and the audit catalogue add `trial_started`, `trial_changed` and
`trial_ended`. Dates come from `@iot-os/ui/lib/trials` (`trialLastDay`, `trialEndsAt`,
`trialText`, `trialEndingSoon`).

## API

Admin routes need `PlatformAdministration.manage-organizations`:

| Route | Purpose |
| --- | --- |
| `GET/POST admin/billing-plans` | List (`search`, `archived=0\|1`) with account counts, or create |
| `GET/PATCH/DELETE admin/billing-plans/{uuid}` | Detail with accounts and history; edit (409 `affected_accounts` without `confirm_affected`); delete (409 once assigned) |
| `POST admin/billing-plans/{uuid}/archive`, `/restore` | Archive or restore |
| `PUT admin/billing-accounts/{uuid}/plan` | `{plan_uuid}`, or `null` to remove the plan |
| `PUT/DELETE admin/billing-accounts/{uuid}/allowances/{kind}` | Override (`{value, note}`) or remove the override |
| `GET admin/billing-accounts/{uuid}/usage?month=YYYY-MM` | Usage for a month (this month by default), with each organization's share |
| `PUT admin/billing-plans/{uuid}/prices` | The plan's prices from next month; the response's `effective_from` says when |
| `PUT admin/billing-accounts/{uuid}/prices/{price}` | `{value, note}` override from next month; `value: null` removes it |
| `PATCH admin/billing-accounts/{uuid}/billing-details` | `{billing_address, tax_number, tax_rate_uuid}` |
| `GET/PUT admin/billing/settings` | Operator details and prefixes, with `revision` (409 when stale); `currency` is read-only |
| `GET/POST admin/billing/tax-rates`, `PATCH …/{uuid}`, `POST …/{uuid}/archive` | Tax rates |
| `GET admin/billing/invoices?status=&month=&account=&payment_status=&unpaid=1` | Invoices, newest month first; `unpaid` is issued and pending or failed |
| `GET admin/billing/invoices/waiting?month=YYYY-MM` | Accounts waiting for final usage, for every ended month or the one given, each with `month`, `waiting_since` and `overdue` |
| `POST admin/billing-accounts/{uuid}/invoices` | `{month, note}`: draft anyway (409 when one exists) |
| `GET admin/billing/invoices/{uuid}`, `.pdf`, `.csv` | Lines, usage, credit notes and `history` (drafting, adjustments, issuing, credit notes, newest first); documents |
| `POST admin/billing/invoices/{uuid}/recalculate`, `/adjustments`, `DELETE …/adjustments/{line}` | Drafts only (409 once issued) |
| `POST admin/billing/invoices/{uuid}/issue` | Number, fix and email it; 409 until its month has ended |
| `POST admin/billing/invoices/{uuid}/credit-notes`, `GET admin/billing/credit-notes/{uuid}.pdf`, `.csv` | `{amount, reason}` on an issued invoice; documents |
| `POST admin/billing/invoices/{uuid}/payments` | `{amount, note}`: a payment made another way, up to what is still owed (201) |
| `POST admin/billing/invoices/{uuid}/reconcile` | Applies Stripe's state to pending payments; 404 while payments are off |
| `POST admin/billing-accounts/{uuid}/trial` | `{plan_uuid?, ends_at\|null}`: start a trial now (409 when one is open) |
| `PATCH admin/billing-accounts/{uuid}/trial` | `{ends_at\|null, plan_uuid?}`: extend, shorten or move it (409 without one) |
| `POST admin/billing-accounts/{uuid}/trial/end`, `/convert` | End it now by the card rule, or turn it (or a trial that ended without a card) into the paid plan |

The plan, trial, allowance and organization-move routes answer 409 `retention` when the change
shortens an organization's telemetry retention, until `confirm_retention: true` is
sent ([retention](#retention)).

`GET admin/billing-accounts/{uuid}` carries `plan_assignment`, `allowances` (each
with `value`, `source` and `note`), this month's `usage`, `prices` (this month's and,
when a change waits, next month's), `price_overrides`, `billing_details`,
`payment_method` and `past_due_since`. Plans carry `prices` too. Invoice details carry
`payments`. Billing settings carry `payments_enabled`. The admin account list
carries `plan` (with `kind` and `trial_ends_at`) and `past_due_since`, and filters by
`past_due=1`, by `trial` (`active`, `ending` within 7 days, `ended_unpaid`), by `plan` (a plan's uuid, or `none`) and by
`usage_at_least` (1 to 100; the list's filter is 80): accounts that have used at
least that share of a limited allowance this month, resolved in SQL as
`Allowances` does. `POST admin/organizations` takes `plan_uuid`, or `trial: {plan_uuid,
ends_at|null}`, with a new billing account.

Owner and manager routes:

| Route | Purpose |
| --- | --- |
| `GET billing-accounts` | The accounts the signed-in person owns, each with `plan`, `allowances`, this month's `usage`, `prices`, `latest_invoice`, `payments_enabled`, `payment_method` and `past_due_since` |
| `GET billing-accounts/{uuid}/usage?month=YYYY-MM` | An owned account's usage for a month; 404 otherwise |
| `GET billing-accounts/{uuid}/invoices` | Issued invoices and credit notes |
| `GET billing-accounts/{uuid}/invoices/{uuid}`, `.pdf`, `.csv`; `GET billing-accounts/{uuid}/credit-notes/{uuid}.pdf`, `.csv` | Issued only; a draft or another account's answers 404 |
| `POST billing-accounts/{uuid}/payment-method/checkout`, `DELETE billing-accounts/{uuid}/payment-method` | `{url}` of Stripe's page to save a card; remove it. 404 while payments are off |
| `POST billing-accounts/{uuid}/invoices/{uuid}/checkout` | `{url}` of Stripe's page to pay what is owed; 409 when nothing is |
| `GET organizations/{uuid}/usage` | This month's usage as a manager sees it, and the organization's `retention`; needs `Device.manage` |

A usage entry is `{kind, month, count, allowance, left, overage, organizations}`,
where `allowance` is the allowance now and an earlier month's `left` is null, plus
`peak_this_month` and `over_limit` (never true for an earlier month) for `devices` and `final`, `reported_at` and
`stale` for `data_points`. The manager's leaves out `organizations` and
`peak_this_month`, and its `count` is the organization's own. It also carries
`retention`: `{days, source, pending_reduction}`, where `source` is `organization`,
`billing_account`, `platform` or `default` and `pending_reduction` is `{days, from}`
while a billing change's grace runs. An owner's account `plan` carries `since`, `kind`
and `trial_ends_at`.
