# Billing

Plans and the allowances they give billing accounts
([spec 028](../../specs/028-pricing-plans/spec.md),
[spec 029](../../specs/029-billing-tier-limits/spec.md),
[ADR-035](../adr/ADR-035-plans-and-allowances.md)). Billing accounts themselves, the
payer of record for one or more organizations, are described under
[Access](access.md#billing-accounts). Usage counting, invoices, payments and trials
are planned in [the billing plan](../../specs/029-billing-tier-limits/plan.md) and
described here as they are built.

Code: Laravel [`Domain/Billing`](../../apps/api/app/Domain/Billing) (resolution:
[`Allowances`](../../apps/api/app/Domain/Billing/Services/Allowances.php), plans:
[`Plans`](../../apps/api/app/Domain/Billing/Services/Plans.php), assignments:
[`PlanAssignments`](../../apps/api/app/Domain/Billing/Services/PlanAssignments.php)),
defaults in [`config/billing.php`](../../apps/api/config/billing.php).

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
  `organization_limit` field still reads and writes it: a value equal to what the plan
  or default gives removes the override, any other value sets one.
- **Rollout** assigns no plan, so every account keeps today's behaviour until an
  administrator assigns one.

Every change is audited: `billing_plan.created`, `updated` (with each changed
allowance), `archived`, `restored` and `deleted` on the plan, and
`billing_account.plan_assigned`, `plan_removed`, `allowance_overridden` and
`allowance_override_removed` on the account. The account's history shows plan and
allowance changes as updates; the plan's page shows its own history.

## API

Admin routes need `PlatformAdministration.manage-organizations`:

| Route | Purpose |
| --- | --- |
| `GET/POST admin/billing-plans` | List (`search`, `archived=0\|1`) with account counts, or create |
| `GET/PATCH/DELETE admin/billing-plans/{uuid}` | Detail with accounts and history; edit (409 `affected_accounts` without `confirm_affected`); delete (409 once assigned) |
| `POST admin/billing-plans/{uuid}/archive`, `/restore` | Archive or restore |
| `PUT admin/billing-accounts/{uuid}/plan` | `{plan_uuid}`, or `null` to remove the plan |
| `PUT/DELETE admin/billing-accounts/{uuid}/allowances/{kind}` | Override (`{value, note}`) or remove the override |

`GET admin/billing-accounts/{uuid}` carries `plan_assignment` and `allowances` (each
with `value`, `source` and `note`). The admin account list carries `plan` and filters
by `plan` (a plan's uuid, or `none`). `POST admin/organizations` takes `plan_uuid`
with a new billing account.
