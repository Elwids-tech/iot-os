# Feature Specification: Billing Module

**Feature Branch**: `spec/029-billing-tier-limits`

**Created**: 2026-11-06

**Status**: Draft

**Input**: Owner, 2026-11-06: spec 028 limits alerts and SMS by plan. The other limits
of a pricing tier, the number of devices, data points per month and telemetry
retention, belong in a separate, proper billing mechanism built on billing accounts.
Owner, 2026-11-07: "this should be a whole billing module for the platform", and super
administrators should be able to give trials for a limited or unlimited period.

## Context

Billing accounts (spec 023, [ADR-026](../../docs/adr/ADR-026-billing-accounts.md)) are
the payer of record and group the organizations one customer pays for.
[Spec 028](../028-pricing-plans/spec.md) (pricing plans, specified, not yet built) adds
plans: named sets of monthly allowances that platform administrators define and assign
to billing accounts, with per-account overrides, usage counting, warnings to owners and
overage. Spec 028 covers only alerts and SMS,
stores no prices, and was designed so that further allowances could be added without
changing its records (its SC-008).

A pricing tier also limits how many devices a customer may run, how many data points
they may send a month and how long their telemetry is kept. Today nothing limits or
counts devices or data points. Telemetry retention has a platform default (400 days
unless changed) and an override per organization, both set by platform administrators
in the admin app (**Settings → Retention**), so a tier's retention has to be typed into
every organization by hand. Nothing turns a plan and its usage into what the customer
owes, and nothing takes payment: the operator invoices and collects by hand.

Storage is what telemetry costs. Every stored reading is kept for the organization's
retention, so data points per month and retention together decide what a customer
costs to serve, more than the number of devices does.

This feature is the platform's billing module, built on billing accounts and spec
028's plans:

- **Limits.** Plans gain a device limit, a monthly data point allowance, a retention
  period and the organization limit that billing accounts carry today. Devices and data
  points are counted against them, and retention follows the plan.
- **Usage.** Owners and managers see where they stand and are warned before a limit.
- **Invoices.** Plans carry prices. Each month the platform drafts an invoice per
  billing account from its plan, usage, overage and tax; a platform administrator
  reviews and issues it.
- **Payment.** Owners save a card through a payment provider. Issued invoices are
  charged to it or paid online, and unpaid invoices are chased with reminders.
- **Trials.** Super administrators put a billing account on a trial, for a set period
  or with no end date, during which the plan's limits apply and nothing is charged.

Telemetry is counted where it is stored, by the runtime, and reported to the control
plane, which keeps the totals; telemetry itself never passes through the control plane
(constitution I). Neither limits nor unpaid invoices ever drop or hold back telemetry
(constitution VI).

**Terms**:

- A *plan*, *allowance*, *override*, *usage* and *overage* are as defined in spec 028.
  This spec adds three allowances and prices to every plan.
- The *device limit* is how many active devices a billing account may have at once,
  across all its organizations. It is a level, not a monthly amount.
- A *counted device* is an active device: one whose activation has been accepted and
  that has not been deactivated since. Registered devices that were never activated,
  inactive devices and archived devices do not count.
- A *data point* is one reading the platform stores for a device: one value of one
  parameter at one moment, whether valid, invalid (kept as a diagnostic) or calculated
  by the device's profile. A reading delivered twice is stored once and counts once.
- The *data point allowance* is how many data points a billing account's organizations
  may store per calendar month in UTC.
- The *retention period* is how many days an organization's telemetry history is kept
  before cleanup deletes it.
- The *organization limit* is, as in spec 023, the most organizations a billing
  account's owners may have when they create one. It moves from the billing account
  onto plans.
- A *price* is an amount in the deployment's currency: a plan's monthly base price, or
  an overage price per alert or per block of data points beyond the allowance.
- An *invoice* is what one billing account owes for one calendar month: its base
  price, overage, adjustments and tax, with the operator's and the account's billing
  details. An issued invoice never changes.
- A *credit note* corrects an issued invoice by reducing what is owed on it.
- A *payment method* is a card an owner saves for a billing account through the
  *payment provider*, the outside service that holds cards and takes payments. The
  platform never sees or stores card numbers.
- An invoice is *past due* when it is not paid by its due date.
- A *trial* is a period during which a billing account uses a plan's allowances and
  limits without being charged. A *limited* trial has an end date; an *open-ended*
  trial has none and lasts until an administrator ends it.

## Clarifications

### Session 2026-11-07

- Q: Does this billing mechanism also cover prices, invoices and payments, or only the
  limits? → A: The limits and monthly statements (later in this session widened to
  invoices and online payment, below).
- Q: Which devices count against the device limit, and what happens at it? → A: Active
  devices only. Registering a device is always allowed; activating one more at the limit
  is refused with a message. Deactivating or archiving a device frees a place.
- Q: What happens when an account has used its data point allowance? → A: Nothing
  stops. Readings keep being stored, owners are warned at 80% and 100%, and data points
  beyond the allowance are recorded as overage and priced on the invoice.
- Q: Should the billing module also produce invoices and collect payment, or stop at
  statements the operator invoices from? → A: Invoices and online payment: tax invoices,
  collecting payment by card through a payment provider, payment status and receipts,
  and handling accounts that do not pay.
- Q: What happens when a billing account does not pay an invoice? → A: Owners are
  reminded and the account is flagged past due in the admin app. Nothing is restricted
  automatically; platform administrators decide what to do.
- Q: What happens when a limited trial reaches its end date? → A: If an owner has saved
  a payment method, the account continues on the trial's plan and is charged from the
  next day. If not, it stays on the plan uncharged and is flagged "trial ended, no
  payment method" for an administrator, and owners are asked to add one.
- Q: What counts as one data point? → A: Every reading the platform stores, after
  duplicates are removed: valid readings, invalid readings kept as diagnostics, and
  values a profile calculates.
- Q: Does the plan set retention, and what happens to older data on a move to shorter
  retention? → A: The plan sets it, and a per-organization override stays for
  exceptions. On a move to shorter retention, owners are warned and older history is
  deleted 30 days later, so a mistaken change or a downgrade can be undone in time.
- Q: Should the billing account's organization limit (spec 023) move onto plans? → A:
  Yes. Plans carry an organization limit like the other allowances: the account's
  override, else its plan's, else 1. An account whose limit was raised keeps it as an
  override at rollout, so nothing changes.
- Q: How is tax on invoices worked out? → A: Platform administrators enter named tax
  rates and give each billing account one rate, or none. The platform applies it; it
  does not work out tax by jurisdiction.

## Decisions

These are drafting defaults. `/speckit-clarify` may revisit them.

- **D1. The limits are allowances on spec 028's plans.** Each is resolved as spec 028
  resolves alerts and SMS: the billing account's override, else its plan's allowance,
  else the deployment's default. Spec 028 ships first; this spec adds to it.
- **D2. Rollout changes nothing.** The deployment defaults are no device limit, no
  data point limit, today's retention (the platform default, else 400 days) and spec
  023's organization limit of 1, with raised limits kept as overrides. Plans
  start with no prices. A billing account with no plan, and a deployment with no plans,
  behave exactly as before and get no invoices.
- **D3. Everything is counted, even when unlimited**, so usage can be shown and a plan
  chosen from real numbers.
- **D4. Data points are counted in the month the runtime stored them.** A report that
  reaches the control plane late adds to the month it belongs to. Until the runtime has
  reported up to a month's end, that month's figure is shown as provisional, and no
  invoice is drafted for it.
- **D5. Devices are counted as a level.** The account page shows the current count
  and, for each month, the highest count reached. Devices have no overage price: at the
  limit, activation is refused.
- **D6. One currency per deployment**, set by the operator, shown with two decimal
  places.
- **D7. Invoices are reviewed before they are issued.** The platform drafts each
  account's invoice once the month's usage is final; a platform administrator may add
  adjustments and then issues it. An issued invoice never changes; a correction is a
  credit note.
- **D8. Invoices are due 14 days after issue.** An invoice is charged to the
  account's payment method when it is issued; without one, owners pay it through the
  payment provider's payment page, or an administrator records a payment made another
  way.
- **D9. A plan change mid-month prorates the base price by day**, each plan for the
  days it was in force. Overage is priced at the overage price in force when it was
  counted.
- **D10. Price changes apply from the next month.** Changing a plan's prices, or an
  account's price override, takes effect on the first day of the next UTC month, so a
  month is always priced from one set of prices per plan.
- **D11. A trial is a plan assignment that is not charged.** A super administrator
  starts it on a billing account with a plan and an end date or no end date. The plan's
  allowances and limits apply as usual; the invoice shows the trial's days with no base
  price and no overage charge. Owners see the trial and its end date, and are emailed 7
  days and 1 day before a limited trial ends. Administrators can extend, shorten or end
  a trial at any time.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Plans carry device, data point, retention and organization allowances (Priority: P1)

A super administrator opens a plan in the admin app. Next to its alert and SMS
allowances it now has a device limit, a monthly data point allowance, a retention
period and an organization limit, each a number or **Unlimited** (retention: a number
of days, or **Platform default**). They fill them in from the price list for each tier.
One integrator agreed a larger device limit, so on that billing account they override
the device limit and note why.

**Why this priority**: every other story reads these allowances. It replaces typing a
tier's retention into each organization and its organization limit into each account.

**Independent Test**: set all four allowances on a plan, put a billing account on it,
and override one of them on the account. The account page shows each allowance, where
it comes from (plan, override or deployment default), and the change in its history;
another account on the same plan is unchanged.

**Acceptance Scenarios**:

1. **Given** **New plan** or a plan's edit form, **Then** it asks for a device limit,
   a monthly data point allowance and an organization limit, each a whole number of 0
   or more or **Unlimited**, and a retention period, a whole number of days from 1 to
   36,500 or **Platform default**.
2. **Given** a plan used by billing accounts, **When** an administrator changes one of
   these allowances, **Then** the confirmation says how many accounts it affects, and
   for a shorter retention period also the date older history will start to be deleted
   and how many organizations it shortens.
3. **Given** a billing account, **When** an administrator overrides one of these
   allowances with a value and a note, **Then** it replaces the plan's for this account
   only and stays when the plan changes, until removed.
4. **Given** the rollout, **Then** every existing plan has no device limit, no data
   point limit, **Platform default** retention and an organization limit of 1, and
   every billing account whose organization limit was not 1 keeps it as an override,
   so nothing changes until an administrator sets them.
5. **Given** an account's organization limit, **Then** it works as in spec 023: owners
   cannot create organizations at or above it, platform administrators are not bound by
   it, and lowering it removes nothing.

---

### User Story 2 - Active devices count against the device limit (Priority: P1)

The integrator's account is on a plan with a device limit of 50. They have 48 active
devices across three customer organizations. During an install they activate two more,
which fills the limit. They can still register the next device and prepare its
configuration, but activating it is refused: the portal says the billing account's
device limit is reached and to contact the platform operator. They deactivate an old
device in one organization, which frees a place, and the new device activates.

**Why this priority**: the device limit is the first number on every tier.

**Independent Test**: put an account with two organizations on a plan with a device
limit of 3. Activate three devices across both organizations, then register a fourth
in either one and try to activate it: registration succeeds, activation is refused
with the limit named, and usage shows 3 of 3. Deactivate one device: usage shows 2 of
3 and the fourth activates.

**Acceptance Scenarios**:

1. **Given** an account below its device limit, **When** a device in any of its
   organizations is activated, **Then** it holds a place from the moment the activation
   is accepted, and usage shows it within one minute. If the activation fails, the
   place is released.
2. **Given** an account at its device limit, **When** a member activates or reactivates
   a device, **Then** it is refused with a message naming the billing account's limit,
   without naming the account or its other organizations. Registering devices and
   editing drafts are not affected.
3. **Given** a device that is already active, **When** a new configuration is activated
   or a previous one rolled back, **Then** it is not refused and the count does not
   change.
4. **Given** a device is deactivated or archived, **Then** it stops counting once the
   deactivation is accepted.
5. **Given** many activations at once across the account's organizations, such as a
   bulk onboarding run, **Then** the count never exceeds the limit: devices that fit are
   activated, and each one beyond it stays registered with the reason.
6. **Given** the device limit is lowered below the current count, or an organization
   with active devices moves into the account, **Then** no device is deactivated; the
   account is shown over its limit and no device can be activated until it is back
   below it.

---

### User Story 3 - Data points are counted against the monthly allowance (Priority: P1)

The integrator's devices report every minute. The runtime counts every reading it
stores, per organization, and reports the counts to the control plane. On the account
page the month's data points rise through the month, with each organization's share.
Late in the month the allowance runs out. Readings keep being stored, shown and used
by automations exactly as before, and the data points beyond the allowance are
recorded as overage.

**Why this priority**: data points and retention decide what a customer costs, and the
data point allowance is the second number on every tier.

**Independent Test**: put an account on a plan with a data point allowance of 1,000 and
send 1,200 readings from devices in two organizations, including re-sent duplicates.
Usage shows exactly the readings stored, each organization's share, and 200 data points
of overage; every reading is in history. Stop the control plane for an hour while
readings continue: when it is back, the missed counts arrive and the month's total is
exact.

**Acceptance Scenarios**:

1. **Given** a device sends a message with five parameter values, **When** they are
   stored, **Then** five data points are counted against the account of the device's
   organization. A value the profile calculates from them, and an invalid value kept
   as a diagnostic, each count as one more.
2. **Given** a reading is delivered twice, **When** it is stored once, **Then** it
   counts once.
3. **Given** the control plane is unreachable, **Then** ingestion and storage carry on
   as before, counts are kept by the runtime and reported when the control plane is
   back, and no count is lost or counted twice.
4. **Given** the runtime has not reported for more than five minutes, **Then** usage
   pages show when counts were last reported instead of presenting the total as
   current.
5. **Given** a new UTC month starts, **Then** data point usage starts at 0, and earlier
   months stay readable.
6. **Given** an account has used its data point allowance, **When** more readings
   arrive, **Then** they are stored, shown and evaluated exactly as before, nothing is
   slowed, and each one is counted as a data point of overage for the month.

---

### User Story 4 - Retention follows the plan (Priority: P2)

The integrator moves from one plan to another with a shorter retention period. The
administrator choosing the new plan sees which organizations it shortens and the date,
30 days away, when older history will start to be deleted, and confirms. Owners are
emailed at once and again a week before that date. Two weeks later the integrator
changes their mind and moves back: nothing is deleted. One organization keeps its own
retention override, for a contract of its own, throughout.

**Why this priority**: retention already exists per organization; plans make it follow
the tier instead of being typed per organization. Devices and data points come first
because nothing limits them today.

**Independent Test**: put an account with two organizations on a plan with 90 days of
retention and give one organization an override of 90 days. Change the plan to 7 days:
the confirmation names the one organization it shortens and the deletion date, and
**Settings → Retention** shows "7 days from" that date. Run cleanup now: nothing older
than 7 days is deleted. Move the clock past the grace period and run cleanup: only that
organization's history older than 7 days is gone.

**Acceptance Scenarios**:

1. **Given** an organization, **Then** its effective retention is resolved as FR-018
   says, and **Settings → Retention** shows the value and where it comes from
   (organization override, billing account plan or override, platform default).
2. **Given** a billing change that shortens any organization's effective retention
   (plan change, plan edit, account override, organization moved to another account),
   **When** an administrator makes it, **Then** they confirm it first, seeing each
   affected organization and the date deletion will start, 30 days later.
3. **Given** such a change, **Then** each owner of the affected account is emailed at
   once and 7 days before deletion starts, and cleanup keeps the previous period until
   that date.
4. **Given** a change that lengthens retention again before that date, **Then** nothing
   is deleted beyond the longer period.
5. **Given** a change that lengthens retention, **Then** it applies at once without
   confirmation, and history already deleted is not restored.
6. **Given** the rollout, **Then** every organization's effective retention is
   unchanged.

---

### User Story 5 - Owners and managers see usage and are warned (Priority: P2)

The integrator, an owner of the billing account, opens **Billing accounts** in the
portal. Next to alerts and SMS (spec 028) it shows active devices against the limit,
data points this month against the allowance, and the retention period, with each
organization's share. When data points pass 80% of the allowance they get an email, and
another when it is used up. A manager in one of the customer organizations sees their
own organization's devices, data points and retention under **Settings → Usage**, but
not the billing account or its other organizations.

**Why this priority**: customers need to see a limit coming before it affects them.
Administrators see usage from User Stories 1 to 3, so this comes second.

**Independent Test**: as an owner, compare **Billing accounts** with the admin app's
account page. Send readings past 80% and then 100% of the allowance: each owner gets one
email at each threshold that month. As a manager of one organization, **Settings →
Usage** shows that organization's figures and nothing about the others.

**Acceptance Scenarios**:

1. **Given** an owner, **When** they open **Billing accounts**, **Then** each account
   they own shows its device limit and active devices, its data point allowance with
   this month's usage and what is left or the overage, and its retention period, with
   each organization's devices and data points.
2. **Given** active devices or data points pass 80% of a limited allowance, and again
   when it is used up, **Then** each owner receives one email per threshold, allowance
   and month. Unlimited allowances send none.
3. **Given** a member who may manage devices, **When** they open **Settings → Usage**,
   **Then** they see their organization's active devices, its data points this month
   and its retention period, and, for each limit, what is left on the billing account.
   They do not see the billing account's name, its other organizations or their usage.
4. **Given** a member who may not manage devices, **Then** they see no limits or usage.
5. **Given** a member whose activation is refused at the device limit, **Then** the
   message explains the limit in the same terms as **Settings → Usage**.

---

### User Story 6 - Prices and monthly invoices (Priority: P2)

The super administrator enters the operator's billing details and tax rates once, then
each plan's monthly base price and overage prices, per alert and per block of data
points, from the price list. On the first days of the next month, once the runtime has
reported the whole month, the platform drafts an invoice for every billing account on a
plan. The administrator opens the integrator's draft: base price, 12,000 data points of
overage at the plan's block price, tax at the account's rate, each organization's
usage, and the total. They add a credit agreed for an outage, with a note, and issue
it. The invoice goes to the account's billing contact and owners.

**Why this priority**: the owner asked for a whole billing module; invoices turn plans
and usage into what each customer owes. Limits come first because invoices price what
they count.

**Independent Test**: give a plan a base price and overage prices, put an account with
a tax rate on it mid-month after a week on another plan, and produce usage with
overage. After the month ends and usage is final, the draft shows each plan's base
price prorated by day, the overage lines (quantity, unit price, amount), the tax and a
total equal to their sum. Add an adjustment and issue it: it can no longer change, it
has the next invoice number, and the billing contact and owners each receive one email.

**Acceptance Scenarios**:

1. **Given** **Billing settings** in the admin app, **Then** an administrator enters
   the operator's legal name, address and tax registration number, and named tax rates
   as percentages. A billing account's page asks for its billing address, an optional
   tax number and its tax rate, or none.
2. **Given** a plan's form, **Then** it asks for a monthly base price, an overage price
   per alert and an overage price per block of data points with the block size, each 0
   or more in the deployment's currency. A plan without prices is priced at 0.
3. **Given** a billing account, **When** an administrator overrides a price with a note,
   **Then** it replaces the plan's price for this account only, from the next month.
4. **Given** a UTC month has ended and the runtime has reported usage up to its end,
   **Then** the platform drafts one invoice per billing account that had a plan during
   the month, with the operator's and the account's billing details, the period, each
   plan in force with its days and prorated base price, each overage line, adjustments,
   the subtotal, tax and total, and each organization's usage.
5. **Given** usage for a month is not final three days after it ends, **Then**
   administrators see which accounts wait and since when. An administrator may draft
   the invoice anyway with a note; it then says its usage may be incomplete.
6. **Given** a draft, **When** an administrator adds an adjustment (a credit or a
   charge, with a note) and issues it, **Then** it takes the next invoice number, can no
   longer change, and is emailed to the billing contact and each owner with a link to
   view and pay it.
7. **Given** an issued invoice that was wrong, **When** an administrator issues a credit
   note for part or all of it, with a reason, **Then** the amount owed on it falls by
   that much; if it was already paid, the credit is taken off the account's next
   invoice.

---

### User Story 7 - Pay online and follow up unpaid invoices (Priority: P2)

The integrator's owner opens **Billing accounts** in the portal and adds a card on the
payment provider's secure form. When the month's invoice is issued, the card is charged
and they receive a receipt. Next month the charge fails because the card has expired:
the owners are emailed with a link to pay, the provider retries, and in the admin app
the invoice shows as failed and, after its due date, the account shows as past due.
Nothing changes for the integrator's devices or customers. The super administrator
calls the integrator, who updates the card and pays the open invoice online.

**Why this priority**: the owner asked for online payment. It needs issued invoices,
so it comes after them.

**Independent Test**: with the payment provider in test mode, save a test card as an
owner, issue an invoice and check it is charged once, marked paid and a receipt sent.
Use a test card that declines: the invoice shows as failed, the owners are emailed, the
account is flagged past due after the due date, and every device, alert and dashboard
works as before. Pay it from the emailed link: it is marked paid. Replay the provider's
reports: nothing is paid or recorded twice.

**Acceptance Scenarios**:

1. **Given** an owner, **When** they open **Billing accounts**, **Then** they can add,
   replace or remove the account's payment method on the payment provider's form, and
   see its brand, last four digits and expiry, never the full card details.
2. **Given** an account with a payment method, **When** an invoice is issued, **Then** it
   is charged to that method once, and when the provider reports success the invoice
   is marked paid and each owner receives a receipt.
3. **Given** an invoice that is unpaid (no payment method, or a failed charge), **Then**
   owners can pay it through the provider's payment page from the invoice or the email.
4. **Given** a charge fails, **Then** each owner is emailed with the reason the provider
   gives and a link to pay. Reminders follow on the due date and 7 days after.
5. **Given** an invoice is past due, **Then** the admin app shows the account as past due
   and its **Billing accounts** list can be filtered by it. Nothing in the account's
   organizations is restricted or changed.
6. **Given** a payment made outside the platform, such as a bank transfer, **When** an
   administrator records it with a note, **Then** the invoice is marked paid and the
   change is audited.
7. **Given** the payment provider is unreachable or has not yet reported, **Then** the
   invoice shows its payment as pending, never as paid or failed, until the provider
   reports.

---

### User Story 8 - Trials (Priority: P2)

A prospective integrator wants to try the platform. The super administrator creates
their organization with a new billing account and starts a 30-day trial on a mid-range
plan. The integrator's owner sees "Trial until" the end date under **Billing
accounts**, works within the plan's limits, and is emailed a week before and a day
before it ends, asking them to add a card. They do, and from the day after the trial
the account is charged. A research partner gets a trial with no end date, which lasts
until the super administrator ends it. Neither is charged while the trial lasts.

**Why this priority**: trials let customers try the platform without the operator
setting prices to zero by hand. They need plans and invoices to mean anything, so they
come after them.

**Independent Test**: start a limited trial on an account, produce usage with overage,
and check the month's invoice: the trial days carry no base price and no overage
charge, while usage, limits and warnings work as on any plan. End a trial on an account
with a saved test card: it is charged from the next day. End one on an account without
a card: it stays on the plan uncharged, the admin app flags it "trial ended, no payment
method", and once an owner adds a card it is charged from the next day.

**Acceptance Scenarios**:

1. **Given** a billing account, **When** a super administrator chooses **Start trial**,
   **Then** they pick a plan (the account's plan by default), and either an end date or
   **No end date**, and the trial starts at once. The account's history records it.
2. **Given** an administrator creating an organization with a new billing account,
   **Then** they can start a trial on it in the same dialog.
3. **Given** an account on a trial, **Then** the plan's allowances, limits, usage and
   warnings apply exactly as on any plan, and the invoice shows the trial's days with a
   base price of 0 and no overage charge.
4. **Given** a limited trial, **Then** the portal shows its end date and each owner is
   emailed 7 days and 1 day before it ends, asked to add a payment method if there is
   none.
5. **Given** a limited trial reaches its end date and the account has a payment method,
   **Then** the account continues on the trial's plan and is charged from the next day,
   and each owner is emailed that the trial ended.
6. **Given** a limited trial reaches its end date and the account has no payment method,
   **Then** the account stays on the plan and is not charged, the admin app flags it
   "trial ended, no payment method", and owners are emailed to add one. Once an owner
   adds one, the account is charged from the next day.
7. **Given** a trial, **When** an administrator extends it, shortens it, changes its
   plan, ends it or turns it into a paid plan, **Then** the change applies at once and
   is recorded in the account's history. Ending an open-ended trial follows scenarios 5
   and 6.
8. **Given** the admin app's **Billing accounts** list, **Then** it can be filtered by
   accounts on a trial, by trials ending in the next 7 days, and by trials ended without
   a payment method.

---

### Edge Cases

- **Organization moved to another billing account mid-month** (spec 023). Its active
  devices move with it at once and may put the new account over its device limit;
  nothing is deactivated. Data points stored before the move stay with the old account,
  those after it count against the new one, and each account's invoice prices only its
  own usage. Its effective retention follows the new account, and a move that shortens
  it gets the same 30-day grace as any billing change.
- **Organization deleted** (spec 006). Its data points stay in the account's totals for
  that month, on its invoice and in history; its devices stop counting.
- **Bulk onboarding at the device limit** (spec 026). Devices that fit are activated;
  each one beyond the limit stays registered with the reason, and the run can be
  retried after the limit is raised.
- **Gateways.** A gateway record is not a device. A gateway's own health metrics count
  as a device once onboarded and activated as one, like any other device.
- **Adapter and simulated devices** count like any other device, and their readings
  count as data points.
- **Runtime restarted or reports replayed.** Counts are reported with identities so a
  replayed report never counts twice, and a restart never loses counts already
  stored.
- **Retention cleanup.** Deleting history never reduces the data points counted for a
  month.
- **Two retention reductions in a row.** Cleanup keeps the longest period the billing
  account gave the organization in the last 30 days.
- **Retention set directly.** Changing an organization's override or the platform
  default in **Settings → Retention** keeps today's behaviour: the administrator
  confirms the cutoff and cleanup applies it at its next run.
- **Allowance of 0.** A device limit of 0 allows no active devices; with a data point
  allowance of 0, every data point is overage.
- **No plan, or a deployment without plans.** Nothing is limited and no invoice is
  drafted; usage is still counted and shown to platform administrators and owners.
- **Concurrent activations at the limit.** Two devices competing for the last place:
  one is activated, the other is refused.
- **A month with no usage.** An account on a plan still gets an invoice with its base
  price.
- **Invoice of 0.** An account whose month is all trial, or fully credited, gets an
  invoice of 0 that is marked paid and charges nothing.
- **Billing account with issued invoices.** It cannot be deleted, even when empty, so
  that its invoices stay readable; this amends spec 023's FR-013.
- **Prices changed mid-month.** The current month keeps the prices in force at its
  start; the confirmation says when the new prices apply.
- **Trial ending mid-month.** The invoice charges the base price, prorated by day, only
  for the days after the trial, and only overage counted after it.
- **Trial on an account with usage already over the plan's limits.** As for any plan
  change: nothing is deactivated, and activations are refused until the account is
  below its device limit.
- **Trial ends while the control plane is down.** It ends at its end date; owners are
  emailed when the control plane is back.
- **Payment method removed with an invoice unpaid.** The invoice stays unpaid and
  payable through the provider's page; reminders continue.
- **Provider reports arrive twice or out of order.** Each is applied once, and an
  invoice already marked paid is never marked failed by an older report.
- **A charge succeeds at the provider but its report is lost.** The invoice stays
  pending until the provider's report arrives or an administrator checks it against
  the provider; it is never charged a second time.
- **A deployment without a payment provider**, such as an on-premise installation.
  Invoices are still drafted and issued; payment methods are not offered, and
  administrators record payments by hand.

## Requirements *(mandatory)*

### Functional Requirements

**Allowances**

- **FR-001**: Every plan MUST have a device limit, a monthly data point allowance and
  an organization limit, each a whole number of 0 or more or unlimited, and a retention
  period, a whole number of days from 1 to 36,500 or the platform default.
- **FR-002**: Platform administrators who can manage plans (spec 028) MUST be able to
  set and change these allowances on plans and override them per billing account, with
  a note, exactly as for alerts and SMS (spec 028 FR-003, FR-008). Changes MUST be
  audited and shown in the plan's and account's history.
- **FR-003**: Each allowance MUST resolve as the account's override, else its plan's
  allowance, else the deployment's default. Deployment defaults MUST be no device limit,
  no data point limit, the platform default retention and an organization limit of 1.
- **FR-004**: The rollout MUST leave every plan without device or data point limits
  or prices, with platform default retention and an organization limit of 1, and MUST
  turn every billing account's organization limit other than 1 into an override, so
  devices, ingestion, retention and organization creation behave exactly as before
  until an administrator changes them.
- **FR-004a**: The organization limit MUST keep spec 023's behaviour (its FR-008,
  FR-017 and US2 scenario 6): owners are refused at or above it, platform
  administrators are not bound by it, and lowering it removes nothing. Spec 023's
  typed-in limit (its FR-010) becomes this override.

**Devices**

- **FR-005**: The platform MUST count, at every moment, each billing account's active
  devices across its organizations, with each organization's share.
- **FR-006**: A device MUST count from the moment its activation is accepted until its
  deactivation is accepted, it is archived, or its organization is deleted. A failed
  activation MUST release its place. Registered devices that were never activated MUST
  NOT count.
- **FR-007**: The platform MUST record, per billing account and UTC month, the highest
  number of active devices reached.
- **FR-008**: At the device limit, activating or reactivating a device MUST be refused
  with a message naming the billing account's limit. Concurrent activations MUST NOT
  take the count above the limit. Registering devices, editing drafts and activating a
  new configuration on an already active device MUST NOT be refused.
- **FR-009**: Lowering the device limit, or moving an organization into an account,
  MUST NOT deactivate or archive any device; the account MUST be shown over its limit
  and refuse activations until it is below it.

**Data points**

- **FR-010**: The runtime MUST count each reading it stores (valid, invalid or
  calculated) per organization, once, however often it was delivered.
- **FR-011**: The runtime MUST report its counts to the control plane, which keeps the
  totals; telemetry MUST NOT be sent to the control plane to be counted.
- **FR-012**: Reports MUST be durable and idempotent: counts survive restarts and
  outages of either side, are delivered at least once and are counted exactly once.
- **FR-013**: Data points MUST be counted in the UTC month the runtime stored them, and
  against the billing account the organization belonged to at that moment.
- **FR-014**: Until the runtime has reported up to the end of a month, or when it has
  not reported for more than five minutes, usage MUST be shown with the time of the
  last report and MUST NOT be presented as complete.
- **FR-015**: Counting MUST NOT slow ingestion or storage noticeably, and MUST NOT
  depend on the control plane being reachable.
- **FR-016**: The data point allowance MUST NOT stop, drop, delay or slow any reading.
  Data points beyond it MUST be stored, shown and evaluated exactly as before and
  counted as overage for the month.
- **FR-017**: Data point usage and overage MUST be kept per billing account and month,
  with each organization's share, for as long as the account exists.

**Retention**

- **FR-018**: An organization's effective retention MUST be its own override, else its
  billing account's retention allowance, else the platform default, else 400 days.
- **FR-019**: A billing change that shortens any organization's effective retention
  (plan change, plan edit, account override, organization moved) MUST be confirmed by
  the administrator, who sees each affected organization and the date deletion will
  start, 30 days after the change.
- **FR-020**: After such a change, cleanup MUST keep using the longest period the
  billing account gave the organization in the last 30 days, and each owner MUST be
  emailed at the change and 7 days before deletion starts. Lengthening retention MUST
  apply at once and MUST NOT restore deleted history.
- **FR-021**: Changes made directly to an organization's override or the platform
  default in **Settings → Retention** MUST keep today's behaviour (confirmation, then
  cleanup at its next run).
- **FR-022**: **Settings → Retention** in the admin app MUST show each organization's
  effective retention, where it comes from, and any pending reduction with its date.

**Seeing usage and warnings**

- **FR-023**: The admin app's billing account page and the portal's **Billing
  accounts** page MUST show, next to spec 028's allowances, the device limit and active
  devices, the data point allowance with this month's usage and what is left or the
  overage, and the retention period, with each organization's devices and data points,
  and earlier months' figures.
- **FR-024**: Members who may manage devices MUST see, on **Settings → Usage**, their
  organization's active devices, data points this month and retention period, and what
  is left of each limited allowance on the billing account. They MUST NOT see the
  billing account, its other organizations, their usage, prices, invoices or payment
  details. Other members see none of it.
- **FR-025**: Owners MUST receive one email when active devices or data points pass
  80% of a limited allowance and one when it is used up, per allowance and month.
- **FR-026**: The admin app's **Billing accounts** list MUST include these allowances
  in spec 028's filter for accounts that have used 80% or more of any allowance.

**Prices and tax**

- **FR-027**: Every plan MUST be able to carry a monthly base price, an overage price
  per alert, and an overage price per block of data points with the block size, each 0
  or more in the deployment's single currency. A missing price is 0.
- **FR-028**: Platform administrators MUST be able to override any price for one
  billing account, with a note. Price changes and overrides MUST take effect on the
  first day of the next UTC month, MUST say so when confirmed, and MUST be audited.
- **FR-029**: Platform administrators MUST be able to enter the operator's billing
  details (legal name, address, tax registration number) and named tax rates, and give
  each billing account a billing address, an optional tax number and a tax rate or
  none.
- **FR-030**: Only platform administrators and the account's owners MUST see prices;
  owners see only the prices that apply to their accounts.

**Invoices**

- **FR-031**: After each UTC month, once the runtime has reported usage up to its end,
  the platform MUST draft one invoice for each billing account that had a plan during
  the month.
- **FR-032**: An invoice MUST show the operator's and the account's billing details,
  the month, each plan in force with the days it applied and its base price prorated by
  day, trial days at 0, one line per priced overage (quantity, unit price, amount), any
  adjustments, the subtotal, the tax rate and amount, the total, the due date, and each
  organization's usage.
- **FR-033**: When a month's usage is not final three days after it ends,
  administrators MUST see which accounts wait and since when, and MAY draft the invoice
  anyway with a note, which marks it as possibly incomplete.
- **FR-034**: Platform administrators MUST be able to add adjustments (a credit or a
  charge, with a note) to a draft and issue it. Issuing MUST give it the next number in
  one unbroken sequence and fix its contents for good. Drafting, adjusting and issuing
  MUST be audited.
- **FR-035**: Platform administrators MUST be able to issue a credit note against an
  issued invoice, for part or all of it, with a reason. It MUST reduce what is owed on
  that invoice; credit beyond what is owed MUST be taken off the account's next invoice.
- **FR-036**: An issued invoice or credit note MUST be emailed to the account's billing
  contact and each owner, and owners MUST be able to view, print and download it as PDF
  and CSV in the portal. Drafts MUST NOT be shown to owners.
- **FR-037**: A billing account with issued invoices MUST NOT be deleted (amending spec
  023's FR-013).
- **FR-038**: Invoice totals MUST equal the sum of their lines, computed from the
  usage, overage, prices, tax rate and plan days on record, so that an invoice can be
  recomputed and checked at any time.

**Payment**

- **FR-039**: Owners MUST be able to add, replace and remove a billing account's
  payment method on the payment provider's own form. The platform MUST NOT receive,
  store, log or show card numbers or security codes; it keeps only the provider's
  reference and the brand, last four digits and expiry for display.
- **FR-040**: When an invoice is issued for an account with a payment method, the
  platform MUST ask the provider to charge it exactly once. Owners MUST be able to pay
  any unpaid invoice through the provider's payment page from the invoice or its email.
- **FR-041**: An invoice's payment status (pending, paid, failed, credited, paid
  outside the platform) MUST follow the provider's reports. Reports MUST be verified as
  coming from the provider and applied once each, whatever their order, and an invoice
  MUST show pending, never paid or failed, until the provider reports.
- **FR-042**: When a payment succeeds, each owner MUST receive a receipt. When a charge
  fails, each owner MUST be emailed the provider's reason and a link to pay, with
  reminders on the due date and 7 days after.
- **FR-043**: An invoice not paid by its due date MUST make its account past due in the
  admin app, with a filter on the **Billing accounts** list. Non-payment MUST NOT
  restrict, suspend or change anything in the account's organizations; platform
  administrators decide what to do.
- **FR-044**: Platform administrators MUST be able to record a payment made outside the
  platform, with a note, which marks the invoice paid and is audited.
- **FR-045**: A deployment without a payment provider MUST still draft and issue
  invoices, MUST NOT offer payment methods, and MUST let administrators record payments.

**Trials**

- **FR-046**: Platform administrators who can manage plans, super administrators
  included, MUST be able to start a trial on a billing account with a plan and either an
  end date or no end date, including when creating an organization with a new billing
  account. An account MUST have at most one trial at a time.
- **FR-047**: During a trial, the plan's allowances, limits, usage counting and warnings
  MUST apply as for any plan, and invoices MUST show the trial's days with a base price
  of 0 and no overage charge.
- **FR-048**: Administrators MUST be able to extend, shorten, change the plan of, end,
  or convert a trial to a paid plan at any time. Every trial change MUST be audited and
  shown in the account's history, and it MUST be possible to tell whether an account
  was on a trial at any moment since rollout.
- **FR-049**: Owners MUST see an account's trial and its end date in the portal, and
  MUST be emailed 7 days and 1 day before a limited trial ends, asked to add a payment
  method if there is none, and when it ends.
- **FR-050**: When a trial ends, an account with a payment method MUST continue on the
  trial's plan and be charged from the next day. An account without one MUST stay on
  the plan uncharged and be flagged "trial ended, no payment method" in the admin app
  until an owner adds one, from the next day after which it is charged, or an
  administrator acts.
- **FR-051**: The admin app's **Billing accounts** list MUST filter by accounts on a
  trial, by trials ending in the next 7 days, and by trials ended without a payment
  method.

**Contracts and documentation**

- **FR-052**: The usage report from the runtime to the control plane MUST have a
  versioned contract with fixtures (constitution IV). The OpenAPI description and
  `packages/api-client` MUST cover the new allowances, prices, tax settings, usage,
  invoices, credit notes, payment methods, payments and trials. User references use the
  integer `user_id` ([ADR-013](../../docs/adr/ADR-013-integer-user-ids.md)).
- **FR-053**: `docs/features/devices.md` (retention, device limit), a billing feature
  document linked from `docs/features/access.md` (billing accounts), and the in-product
  help MUST describe the limits, usage, warnings, invoices, payment and trials.

### Key Entities

- **Plan** (spec 028): gains a device limit, a monthly data point allowance, a
  retention period, an organization limit, a monthly base price, overage prices per
  alert and per block of data points, and the block size.
- **Allowance override** (spec 028): may now override any of the four new allowances,
  and holds what was each billing account's typed-in organization limit.
- **Price override**: a billing account, a price, its value, a note, who set it, and
  the month it applies from.
- **Billing settings**: the operator's legal name, address and tax registration
  number, the deployment's currency, and named tax rates.
- **Billing account** (spec 023): gains a billing address, an optional tax number, a
  tax rate, a payment method reference and its display details, and a past-due flag.
- **Device usage**: a billing account, a UTC month, the highest count reached, and each
  organization's current count.
- **Data point report**: an organization, a period the runtime counted, the count, and
  an identity so it is applied once.
- **Usage** (spec 028): gains data point usage and overage per account, month and
  organization.
- **Retention setting** (existing): a platform default and per-organization overrides;
  the billing account's allowance sits between them, with any pending reduction and its
  date.
- **Invoice**: a billing account, a UTC month, a number, draft or issued, the billing
  details as they were at issue, whether its usage may be incomplete, its lines,
  subtotal, tax, total, due date, payment status, and who drafted and issued it and
  when.
- **Invoice line**: an invoice, a kind (base price, trial, alert overage, data point
  overage, adjustment, credit carried forward), a description, a quantity, a unit price,
  an amount and, for adjustments, a note.
- **Credit note**: an issued invoice, an amount, a reason, a number, and who issued it
  and when.
- **Payment**: an invoice, an amount, the provider's reference or a note for a payment
  made outside the platform, its status and when each status was reported.
- **Trial**: a billing account, a plan, when it started, its end date or none, when
  and how it ended (reached its end date, ended or converted by an administrator), and
  who started and changed it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A platform administrator sets a tier's device limit, data point
  allowance, retention and prices on a plan in under two minutes, and no longer types
  retention into each organization.
- **SC-002**: Tests show data point usage equal to the readings stored, with duplicate
  deliveries, replayed reports, runtime restarts and an hour-long control plane outage.
- **SC-003**: Under concurrent activations and bulk onboarding, the number of active
  devices never exceeds the device limit.
- **SC-004**: No reading is dropped, delayed or slowed by the data point allowance or
  by an unpaid invoice; at the platform's tested load, readings reach history as fast
  with counting as without it (within 5%).
- **SC-005**: Usage shown to administrators, owners and managers is never more than
  five minutes behind what was stored, or says how old it is.
- **SC-006**: After rollout, with no limits or prices set, every existing device,
  ingestion and retention test passes unchanged, and every organization's effective
  retention and every billing account's organization limit are the same as before.
- **SC-007**: Tenant isolation tests show that a manager sees no other organization's
  name or usage, and only owners and platform administrators see a billing account's
  limits, prices, invoices and payment details.
- **SC-008**: Each owner receives exactly one email per usage threshold, allowance and
  month, per issued invoice or credit note, per receipt, and per trial reminder.
- **SC-009**: Recomputing any issued invoice from the records gives the same lines and
  total, invoice numbers have no gaps or repeats, and invoices for every account on a
  plan are drafted within one day of the month's usage becoming final.
- **SC-010**: An owner saves a card and pays an open invoice in under two minutes.
  Tests with replayed, duplicated and out-of-order provider reports never charge an
  invoice twice or show it with the wrong status.
- **SC-011**: No card number or security code appears in the platform's database, logs
  or responses.
- **SC-012**: After a billing change shortens retention, no history inside the
  previous period is deleted for 30 days, and undoing the change within that time
  deletes nothing.
- **SC-013**: A super administrator starts a trial, limited or open-ended, in under one
  minute, and no trial day is ever charged.

## Assumptions

- Spec 028's implementation (plans, overrides, usage, warnings, the **Billing
  accounts** filter) ships before this spec is built. This spec adds allowances and prices to it and
  changes none of its records.
- Devices are counted by the control plane, which owns device records and activation;
  data points are counted by the runtime, which stores readings.
- A gateway record is not a device; a gateway's own metrics count once onboarded and
  activated as a device.
- **Settings → Usage** is a new portal page for members who may manage devices; spec
  028's alert and SMS figures stay on **Settings → Notifications**.
- Retention period bounds are those the admin app enforces today: 1 to 36,500 days.
- Platform administrators who can manage organizations manage prices, tax settings,
  invoices, payments and trials, as they manage plans (spec 028). A separate billing
  permission is not needed yet.
- Tier names, prices, tax rates and the numbers each tier includes are entered in the
  platform, never written into this repository.
- The payment provider is chosen in the plan and recorded in an ADR. It has a test
  mode, hosts the card form and payment page, retries failed charges, and reports
  payments to the platform.
- The admin app and the API client change in the same pull request as the endpoints
  (constitution IV).

## Out of Scope

- Restricting or suspending an account automatically for non-payment.
- Refunding money to a card from the platform. Refunds are made in the payment
  provider; the platform records the credit note.
- Working out tax by jurisdiction, more than one tax rate per account, and tax
  exemptions beyond giving an account no tax rate.
- More than one currency, and converting between currencies.
- Payment methods other than cards; other payments are recorded by hand.
- Customers choosing or changing their own plan, signing themselves up for a trial,
  and buying extra allowance.
- Limits on each organization's share of a billing account's allowances.
- Limits on members, dashboards, automations, API calls or storage size.
- Overage prices for devices (activation is refused at the limit) and for SMS (spec
  028 stops SMS at its allowance).
- Reducing what a data point costs to store (compression, storing telemetry once).

## Related work

- [Spec 023](../023-billing-accounts/spec.md) and
  [ADR-026](../../docs/adr/ADR-026-billing-accounts.md): billing accounts, owners,
  assignment history and the organization limit. Moving the organization limit onto
  plans amends ADR-026, through a new ADR with the plan.
- [Spec 028](../028-pricing-plans/spec.md) and its [mockups](../028-pricing-plans/mockups.html):
  plans, overrides, usage, warnings and overage for alerts and SMS. Its SC-008 asks that devices, data
  points and retention be additions; prices and trials, which it leaves out, are added
  here, and its assumption that the organization limit stays on the billing account is
  replaced.
- Spec 012 (lossless ingestion, draft PR on `spec/012-lossless-ingestion`): stable
  identities for telemetry, so a reading delivered twice is stored and counted once.
- [Spec 026](../026-embedded-gateway-sdk/spec.md): bulk onboarding of devices behind a
  gateway.
- [Devices: retention](../../docs/features/devices.md#retention): today's retention
  resolution and cleanup.
- Counting data points in the runtime, invoicing on billing accounts and the choice of
  payment provider will be recorded as ADRs with the plan.
