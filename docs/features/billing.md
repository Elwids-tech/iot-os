# Billing

Plans, the allowances they give billing accounts, and what accounts use
([spec 028](../../specs/028-pricing-plans/spec.md),
[spec 029](../../specs/029-billing-tier-limits/spec.md),
[ADR-035](../adr/ADR-035-plans-and-allowances.md)). Billing accounts themselves, the
payer of record for one or more organizations, are described under
[Access](access.md#billing-accounts). The device limit, data point counting,
invoices, payments and trials are planned in
[the billing plan](../../specs/029-billing-tier-limits/plan.md) and described here as
they are built.

Code: Laravel [`Domain/Billing`](../../apps/api/app/Domain/Billing) (resolution:
[`Allowances`](../../apps/api/app/Domain/Billing/Services/Allowances.php), plans:
[`Plans`](../../apps/api/app/Domain/Billing/Services/Plans.php), assignments:
[`PlanAssignments`](../../apps/api/app/Domain/Billing/Services/PlanAssignments.php),
usage: [`Usage`](../../apps/api/app/Domain/Billing/Services/Usage.php), warnings:
[`UsageThresholds`](../../apps/api/app/Domain/Billing/Services/UsageThresholds.php) and
[`Notices`](../../apps/api/app/Domain/Billing/Services/Notices.php)), defaults in
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

- **Plans** (after Billing accounts in the sidebar) lists current plans with their
  allowances and how many accounts are on each; the Status filter shows archived or
  all plans. **New plan** and **Edit** open one dialog: a field per allowance, empty
  for the deployment default, with an **Unlimited** switch (retention has none; empty
  means the platform setting). Editing a plan that accounts are on asks to confirm
  how many it changes. A plan that was ever assigned can only be archived.
- **A plan's page** shows its allowances, the accounts on it (with paid or trial) and
  its history.
- **A billing account's page** has a **Plan** panel (change or remove the plan) and an
  **Allowances** panel listing each kind with its value, where it comes from
  (override, plan or default) and the override's note, with **Override** and
  **Remove override**. The account list has a Plan column and filter.
- **New organization** with a new billing account can start it on a plan.

## Usage

`Usage` counts what each billing account uses per UTC month: alerts and SMS so far,
data points once the runtime reports them. Organizations on an account share its
allowances.

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

`GET admin/billing-accounts/{uuid}` carries `plan_assignment`, `allowances` (each
with `value`, `source` and `note`) and this month's `usage`. The admin account list
carries `plan` and filters by `plan` (a plan's uuid, or `none`) and by
`usage_at_least` (1 to 100; the list's filter is 80): accounts that have used at
least that share of a limited allowance this month, resolved in SQL as
`Allowances` does. `POST admin/organizations` takes `plan_uuid` with a new billing
account.

Owner and manager routes:

| Route | Purpose |
| --- | --- |
| `GET billing-accounts` | The accounts the signed-in person owns, each with `plan`, `allowances` and this month's `usage` |
| `GET billing-accounts/{uuid}/usage?month=YYYY-MM` | An owned account's usage for a month; 404 otherwise |
| `GET organizations/{uuid}/usage` | This month's usage as a manager sees it; needs `Device.manage` |

A usage entry is `{kind, month, count, allowance, left, overage, organizations}`;
the manager's leaves out `organizations` and its `count` is the organization's own.
