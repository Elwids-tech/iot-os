# Feature Specification: Pricing Plans

**Feature Branch**: `spec/028-pricing-plans`

**Created**: 2026-11-06

**Status**: Draft

**Input**: Owner, 2026-11-06: pricing tiers will be priced by the number of alerts and
of SMS each one includes, so SMS is limited by plan. Spec 011 (notification channels,
draft) meanwhile gives each organization a monthly SMS allowance that platform
administrators type in "until plans exist".

## Context

The platform has no plans. Nothing records what a customer is entitled to, and nothing
counts what they use. The only limit is typed in by hand: a billing account's
organization limit (spec 023). Spec 011, still a draft, would add another: each
organization's monthly SMS allowance, which platform administrators would copy from the
customer's tier. Workflow alerts are unlimited: every activation is recorded and emailed
to its recipients.

Pricing will be tiered, and each tier is defined by how many alerts and how many SMS
it includes a month. This feature adds **plans**: named sets of monthly allowances that
platform administrators define once and assign, instead of typing the same numbers into
every organization. The platform counts alerts and SMS against them, shows customers
what they have used, warns before an allowance runs out and applies the plan's limits.
Plans store no price; prices, invoices and payments are later work.

Billing accounts (spec 023, [ADR-026](../../docs/adr/ADR-026-billing-accounts.md)) are
the payer of record. They already record which account an organization belonged to on
any day, so that metering could attach to them later.

**Terms**:

- A *plan* is a named set of monthly allowances, one per tier on the price list. It
  stores no price.
- An *allowance* is how many of one metered item (alerts, SMS) a plan includes per
  calendar month in UTC. An allowance is a whole number of 0 or more, or *unlimited*.
- *Usage* is how many have been counted against an allowance in a month.
- An *override* is an allowance set for one billing account, replacing its plan's, for a
  customer on special terms.
- An *alert*, for counting, is one activation of an automation alert (a geofence rule
  or a DAG alert action). It counts once, however many people or channels it reaches.
  Clears do not count, and neither do offline alerts (spec 018), which the platform
  raises by itself.
- An *SMS* is one part of a text message, as in spec 011: 160 characters, or 70 when the
  text has characters outside the basic SMS alphabet. A two-part message counts as two.
- *Overage* is usage beyond an alert allowance. It is recorded so that it can be billed
  later; it stops nothing.

## Clarifications

### Session 2026-11-06

- Q: Does a plan attach to a billing account or to each organization? → A: To the
  billing account. All of its organizations share its allowances, so an integrator buys
  one plan for all their customers.
- Q: What counts as one alert against the alert allowance? → A: Each activation of an
  automation alert, once, however many people or channels it reaches. Clears and offline
  alerts (spec 018) do not count.
- Q: What happens when an account has used its alert allowance? → A: Alerts and their
  messages keep going. Owners are warned at 80% and 100%, and alerts beyond the
  allowance are recorded as overage to be billed later. SMS still stops at its allowance
  (spec 011).
- Q: Who defines plans and assigns them to billing accounts? → A: Platform
  administrators who can manage organizations, super administrators included, in the
  admin app, as for billing accounts in spec 023. Owners and members only see them.
- Q: How does spec 011's per-organization SMS allowance move onto plans? → A: Plans ship
  before SMS. Spec 011 is amended so SMS uses the billing account's allowance from this
  spec and never builds the typed-in per-organization allowance, so nothing is migrated.
- Q: Besides alerts and SMS, which other limits does a plan carry? → A: None in this
  spec. Devices, data points per month and telemetry retention belong to a separate
  billing spec, built on billing accounts, that takes every tier limit into account.

## Decisions

These are drafting defaults. `/speckit-clarify` may revisit them.

- **D1. Plans store allowances, not prices.** The price list lives outside the platform.
- **D2. Rollout changes nothing.** A billing account with no plan keeps today's
  behaviour: alerts are unlimited and the SMS allowance is the deployment's default (0
  unless the operator sets one, as spec 011 says). A deployment that defines no plans,
  such as an on-premise installation, works exactly as before.
- **D3. Editing a plan changes every account on it at once.** To keep existing customers
  on their old terms, an administrator creates a new plan and archives the old one.
  Archived plans stay on their accounts but cannot be newly assigned.
- **D4. Everything is counted, even when unlimited**, so usage can be shown and a plan
  chosen from real numbers.
- **D5. Months are calendar months in UTC**, as in spec 011.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Define plans (Priority: P1)

A super administrator opens **Plans** in the admin app and chooses **New plan**. They
enter the tier's name from the price list, a short description, and its monthly
allowances for alerts and SMS, each a number or **Unlimited**. They create one plan for
each tier. The Plans list shows every plan with its allowances and how many billing
accounts are on it.

**Why this priority**: every other story needs plans. It replaces typing the same
numbers into each organization.

**Independent Test**: create two plans with different allowances, change an allowance
on one and archive the other. The list shows each plan's allowances and account count,
the archived plan is no longer offered for assignment, and each plan's history shows
the changes with who made them and when.

**Acceptance Scenarios**:

1. **Given** a platform administrator, **When** they open **Plans**, **Then** they see
   every plan with its name, allowances, number of billing accounts and whether it is
   archived, and can search by name.
2. **Given** **New plan**, **Then** the form asks for a name, unique among plans, an
   optional description, and for each allowance either a whole number of 0 or more or
   **Unlimited**.
3. **Given** a plan that billing accounts use, **When** an administrator changes an
   allowance, **Then** the confirmation says how many accounts it affects, and once
   confirmed the new allowance applies to all of them at once and is recorded in the
   plan's history.
4. **Given** a plan, **When** an administrator archives it, **Then** accounts on it keep
   it and it is no longer offered when choosing a plan. Restoring it offers it again.
5. **Given** a plan that has never been assigned, **When** an administrator deletes it,
   **Then** it is removed. A plan that has ever been assigned cannot be deleted, and the
   page says to archive it instead.
6. **Given** a person who may not manage plans, **Then** **Plans** is not shown and the
   API refuses plan changes with 403.

---

### User Story 2 - Put a billing account on a plan (Priority: P1)

The administrator opens the integrator's billing account and chooses **Change plan**,
picking from a searchable selector of plans. The account page now shows the plan, each
allowance, this month's usage with a breakdown by organization, and the change in its
history. The integrator agreed special terms for SMS, so the administrator overrides
the SMS allowance for this account alone and notes why.

**Why this priority**: plans do nothing until accounts are on them.

**Independent Test**: put a billing account with two organizations on a plan, raise
alerts and send SMS in both, and open the account page. It shows the plan's allowances,
the combined usage and each organization's share. Override one allowance: it replaces
the plan's for this account only, and another account on the same plan is unchanged.

**Acceptance Scenarios**:

1. **Given** a billing account's page, **Then** it shows the account's plan, or **No
   plan**, and for each allowance its value, where it comes from (plan, override or
   deployment default), this month's usage, what is left or the overage, and each
   organization's usage.
2. **Given** **Change plan**, **When** the administrator picks a plan, **Then** it
   applies from that moment. Usage already counted this month stays counted, and what is
   left is the new allowance minus it. The change is recorded in the account's history.
3. **Given** an administrator overrides an allowance with a value and a note, **Then** it
   replaces the plan's allowance for this account only and stays when the plan changes,
   until it is removed. The page marks it as an override.
4. **Given** **Remove plan**, **Then** the account goes back to the deployment's
   defaults.
5. **Given** the **Billing accounts** list, **Then** it shows each account's plan and can
   be filtered by plan and by accounts that have used 80% or more of any allowance this
   month.
6. **Given** an administrator creating an organization with a new billing account (spec
   023), **Then** they can choose the account's plan. **No plan** is the default.

---

### User Story 3 - Alerts and SMS count against the plan (Priority: P1)

A device in one of the integrator's organizations trips a workflow. Its alert counts
once against the alert allowance, and the SMS sent to the on-call technician counts
its parts against the SMS allowance. Late in the month the SMS allowance runs out: the
next alert SMS is cancelled with a reason while email, Teams and Slack messages still go
out. Alerts past the alert allowance keep going and are recorded as overage.

**Why this priority**: it is the request. Without counting and limits, plans are labels.

**Independent Test**: put an account on a plan with 3 alerts and 2 SMS a month, and
trigger 4 alerts that each text one recipient. Usage shows 4 alerts, one of them
overage, and 2 SMS sent; the third and fourth SMS are cancelled with "SMS allowance used
up for this month", and the fourth alert's email is still sent. On the first day of the
next UTC month usage starts again at 0.

**Acceptance Scenarios**:

1. **Given** an alert, **When** it is counted, **Then** it counts exactly once, however
   often the runtime's report of it is replayed. Acknowledging, assigning, commenting on
   or clearing it adds nothing.
2. **Given** an SMS that the provider accepts, **Then** its parts count against the SMS
   allowance. An SMS cancelled or refused before the provider accepts it counts nothing,
   and verification codes count against no allowance (spec 011).
3. **Given** what is left of the SMS allowance is less than the parts an SMS needs,
   **When** it is due, **Then** it is cancelled with "SMS allowance used up for this
   month", and email, Teams and Slack messages are unaffected (spec 011).
4. **Given** an account has used its alert allowance, **When** another alert activates,
   **Then** it is recorded, shown and sent exactly as before, and counted as one alert of
   overage for the month.
5. **Given** a new UTC month starts, **Then** usage and overage start at 0, and previous
   months stay readable.
6. **Given** many SMS at once, **Then** the SMS allowance is never exceeded.

---

### User Story 4 - See usage and be warned (Priority: P2)

The integrator, an owner of their billing account, opens **Billing accounts** in the
portal. It shows the plan, each allowance, what is used and left this month, and each
organization's share. When the SMS allowance passes 80%, they get an email, and a second
one when it is used up. A manager in one of the integrator's customer organizations sees
on **Settings → Notifications** what is left of the SMS allowance, but not the billing
account or its other organizations.

**Why this priority**: customers need to see a limit coming before it stops anything.
The admin app already shows usage (User Story 2), so this comes second.

**Independent Test**: as an owner, open **Billing accounts** and compare its usage with
the admin app's. Send SMS until 80% and then 100% of the allowance is used: the owner
receives one email at each threshold and no more that month. As a manager of one
organization, the notifications settings page shows what is left and nothing about the
other organizations.

**Acceptance Scenarios**:

1. **Given** an owner, **When** they open **Billing accounts**, **Then** each account
   they own shows its plan, each allowance, usage and what is left or the overage this
   month, and each organization's usage.
2. **Given** an allowance passes 80%, and again when it is used up, **Then** each owner
   of the account receives one email per threshold, allowance and month. Unlimited
   allowances send none.
3. **Given** a manager of an organization (someone who may manage devices), **When** they
   open **Settings → Notifications**, **Then** they see, for their organization, each
   allowance, what is left or the overage this month, and how much their organization
   has used. They do not see the billing account's name, its other organizations or their
   usage.
4. **Given** a member who may not manage devices, **Then** they see no allowance or
   usage.
5. **Given** an account with no owners, **Then** no warning emails are sent, and platform
   administrators find it with the **Billing accounts** filter of User Story 2.

---

### Edge Cases

- **Plan changed or lowered mid-month.** The new allowance applies at once to what is
  left. Nothing already sent is undone; if usage is already above the new allowance,
  nothing is left until next month.
- **Organization moved to another billing account mid-month** (spec 023). Usage before
  the move stays with the old account, usage after it counts against the new one, and
  both pages show it.
- **Organization deleted** (spec 006). Its usage stays in the account's totals for that
  month and in history.
- **Alerts reported late**, for example after the control plane was down at the end of a
  month. They count in the month the platform records them, so a past month's usage
  never changes.
- **Allowance of 0.** No SMS is sent, and every alert is overage. **Unlimited** is
  counted but never limits and never has overage.
- **SMS not configured.** When the deployment has no SMS provider, SMS allowances and
  usage are not shown to customers.
- **Concurrent sends at the limit.** Two SMS competing for the last part: one is sent,
  the other is cancelled.
- **Archived plan.** Accounts keep it; its allowances can still be changed; it cannot be
  newly assigned.
- **Billing account deleted** (spec 023, only when empty). Its plan history and usage go
  with it, and its deletion stays in the audit record.

## Requirements *(mandatory)*

### Functional Requirements

**Plans**

- **FR-001**: Platform administrators who can manage organizations, super
  administrators included, MUST be able to create a plan with a name, unique among
  plans, an optional description, and a monthly allowance for alerts and one for SMS,
  each a whole number of 0 or more or unlimited. Plans MUST NOT store prices. In this
  spec, "platform administrators" means these administrators; nobody else can create,
  change or assign plans or overrides.
- **FR-002**: Platform administrators MUST be able to list and search plans, seeing each
  plan's allowances, number of billing accounts and whether it is archived.
- **FR-003**: Platform administrators MUST be able to rename a plan and change its
  description and allowances. A change MUST apply at once to every billing account on
  the plan, after a confirmation that says how many it affects.
- **FR-004**: Platform administrators MUST be able to archive and restore a plan.
  Archived plans MUST stay on their accounts and MUST NOT be offered for assignment.
- **FR-005**: A plan that has never been assigned MAY be deleted; one that has been
  assigned MUST NOT be.
- **FR-006**: Creating, changing, archiving, restoring and deleting plans MUST be audited
  with who made the change and when, and shown in the plan's history.

**Assigning plans**

- **FR-007**: Plans MUST attach to billing accounts, not organizations. Each billing
  account MUST have at most one plan at a time, and all of its organizations share its
  allowances. Platform administrators MUST be able to assign, change and remove it.
  Each assignment MUST record the plan, when it started and who made it, so that the
  plan in force at any moment since rollout can be told.
- **FR-008**: Platform administrators MUST be able to override any allowance for one
  billing account, with a note. An override replaces the plan's allowance for that
  account only, survives plan changes, and is audited.
- **FR-009**: An account's allowance MUST be its override, else its plan's allowance,
  else the deployment's default. Deployment defaults are unlimited alerts and the SMS
  allowance the operator sets, 0 if none.
- **FR-010**: When a platform administrator creates an organization with a new billing
  account, they MUST be able to choose its plan. No plan is the default.
- **FR-011**: The rollout MUST leave every billing account with no plan, so alerts and
  notifications behave exactly as before until a plan is assigned.

**Counting**

- **FR-012**: The platform MUST count each automation alert activation once against the
  alert allowance of the billing account its organization belongs to, in the UTC month
  the platform records it. Replayed reports MUST NOT count again; acknowledging,
  assigning, commenting on or clearing an alert MUST NOT count, and offline alerts (spec
  018) MUST NOT count.
- **FR-013**: The platform MUST count each SMS part against the SMS allowance when the
  provider accepts the message. Messages cancelled or refused before acceptance and
  verification codes MUST NOT count.
- **FR-014**: Usage and overage MUST be kept per billing account, allowance and month,
  with each organization's share, for as long as the account exists.
- **FR-015**: Usage MUST be exact: concurrent sends and replayed events MUST NOT
  over-count or under-count, and MUST NOT let the SMS allowance be exceeded.

**Limits**

- **FR-016**: An SMS whose parts do not fit in what is left of the SMS allowance MUST be
  cancelled with "SMS allowance used up for this month"; other channels are unaffected.
- **FR-017**: The alert allowance MUST NOT stop anything. Alerts beyond it MUST be
  recorded, shown on the Alerts page and in the event log, and sent on every channel as
  before, and MUST be counted as overage for the month.
- **FR-018**: An allowance changed mid-month (plan change, plan edit, override) MUST
  apply at once to what is left. Nothing already sent is undone.

**Seeing usage**

- **FR-019**: The admin app's billing account page MUST show the plan, each allowance and
  its source, this month's usage, what is left or the overage, each organization's
  usage, earlier months' usage and overage, and the account's plan and override history.
- **FR-020**: The admin app's **Billing accounts** list MUST show each account's plan and
  filter by plan and by accounts that have used 80% or more of any allowance this month.
- **FR-021**: Billing account owners MUST see, in the portal, each account they own with
  its plan, allowances, usage and what is left or the overage this month, and each
  organization's usage.
- **FR-022**: Members who may manage devices MUST see, on **Settings → Notifications**,
  each allowance, what is left or the overage this month and their own organization's
  usage. They MUST
  NOT see the billing account, its other organizations or their usage. Other members see
  no allowance or usage.
- **FR-023**: Owners MUST receive one email when an allowance passes 80% and one when it
  is used up, per allowance and month. Unlimited allowances send none.

**Contracts and documentation**

- **FR-024**: The OpenAPI description and `packages/api-client` MUST cover plans,
  assignments, overrides and usage. User references use the integer `user_id`
  ([ADR-013](../../docs/adr/ADR-013-integer-user-ids.md)).
- **FR-025**: Plans MUST ship before spec 011's SMS. Spec 011's monthly SMS allowance
  (its FR-025) MUST be the SMS allowance of the organization's billing account, resolved
  as FR-009 says; the per-organization allowance typed in by platform administrators is
  not built. Wherever spec 011 checks "the organization's SMS allowance" (sending, the
  mobile number banner), it reads the account's.
- **FR-026**: `docs/features/access.md` (billing accounts), `docs/features/alerts.md` and
  the alert notification help article MUST describe plans, allowances, usage and limits.

### Key Entities

- **Plan**: name, description, monthly alert allowance, monthly SMS allowance (each a
  number or unlimited), archived or not, and creation time. It has a history of changes.
- **Plan assignment**: a billing account, a plan, when the assignment started and who
  made it. An account's assignments follow one another with no overlaps; a gap means no
  plan.
- **Allowance override**: a billing account, an allowance, its value, a note, and who set
  it and when.
- **Usage**: a billing account, an allowance, a UTC month, the count, the overage, and
  each organization's share.
- **Usage warning**: which thresholds (80%, 100%) have been emailed for an account,
  allowance and month, so each is sent once.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A platform administrator defines a plan and puts a billing account on it in
  under two minutes, without typing an allowance into any organization.
- **SC-002**: Tests show usage equal to the alerts recorded and SMS parts accepted, with
  runtime reports replayed and 100 SMS sent concurrently, that the SMS allowance is never
  exceeded, and that no alert or message is held back by the alert allowance.
- **SC-003**: After rollout, with no plan assigned, every existing alert and notification
  test passes unchanged.
- **SC-004**: Usage shown to administrators, owners and managers is never more than one
  minute behind what was counted.
- **SC-005**: Each owner receives exactly one email per threshold, allowance and month.
- **SC-006**: Tenant isolation tests show that a manager sees no other organization's
  name or usage, and that only owners and platform administrators see a billing
  account's plan.
- **SC-007**: For any billing account and any moment since rollout, the plan and
  allowances in force can be told from its history.
- **SC-008**: The plan's data model shows devices, data points per month and telemetry
  retention as additions that change no existing plan, assignment, override or usage
  record.

## Assumptions

- The billing account's organization limit (spec 023) stays on the billing account.
- Plan names and descriptions are what the price list calls each tier; this spec names
  none.
- Email, Teams and Slack messages are not limited by any allowance.
- The admin app and the API client change in the same pull request as the endpoints
  (constitution IV).

## Out of Scope

- Prices, currencies, taxes, statements, invoices and payments.
- Customers choosing or changing their own plan, trials, and buying extra allowance.
- Limits on each organization's share of a billing account's allowances.
- Devices, data points per month, telemetry retention and any other tier limit. They
  belong to a separate billing spec, built on billing accounts, that takes every tier
  limit into account.
- Showing plans on the public website; the price list lives on the company website.

## Related work

- [ADR-026](../../docs/adr/ADR-026-billing-accounts.md) and
  [spec 023](../023-billing-accounts/spec.md): billing accounts, owners and assignment
  history.
- Spec 011 (notification channels, draft PR on `spec/011-notification-channels`): SMS
  through one toll-free number, parts counting and the monthly SMS allowance this spec
  replaces. Its FR-025 is amended in its own pull request to read this spec's allowance
  (FR-025 here).
- [Spec 018](../018-device-offline-alerts/spec.md): offline alerts, raised by the
  platform rather than an automation.
- The decision to meter plans on billing accounts will be recorded as an ADR with the
  plan.
