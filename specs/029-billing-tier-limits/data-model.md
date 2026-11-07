# Data Model: Billing Module (specs 028 and 029)

Laravel tables live in the public schema, under `App\Domain\Billing` unless noted.
Amounts are `bigint` minor units in the deployment's currency (research R11). Times
are `timestamptz` in UTC. A month is a `date` on the first day of a UTC month. Users
are referenced by integer id (ADR-013).

## Plans and allowances

### `billing_plans`

| Column | Type | Notes |
| --- | --- | --- |
| id, uuid | bigint, uuid | uuid is the route key |
| name | string(120) | unique among plans, case-insensitive |
| description | text null | |
| archived_at | timestamptz null | archived plans stay on accounts and cannot be newly assigned (028 FR-004) |
| created_at, updated_at | | |

A plan that has ever been assigned cannot be deleted (028 FR-005). This is checked
against `billing_plan_assignments`.

### `billing_plan_allowances`

| Column | Type | Notes |
| --- | --- | --- |
| plan_id | fk → billing_plans, cascade | |
| kind | string(32) | `alerts`, `sms`, `devices`, `data_points`, `retention_days`, `organizations` |
| value | bigint null | ≥ 0; `NULL` = unlimited |

The primary key is (plan_id, kind). A missing row means "not set on the plan", which
falls back to the deployment default. The rules per kind:

- `retention_days` is 1–36,500 and never unlimited; a missing row means **Platform
  default**.
- `organizations` defaults to 1.
- Every other kind defaults to unlimited, except SMS, whose default is the operator's
  setting (0 unless set).

### `billing_plan_prices`

| Column | Type | Notes |
| --- | --- | --- |
| plan_id | fk | |
| effective_from | date | always the first day of a month |
| base_price | bigint | monthly, ≥ 0 |
| alert_overage_price | bigint | per alert, ≥ 0 |
| data_point_overage_price | bigint | per block, ≥ 0 |
| data_point_block_size | integer | ≥ 1, default 1,000,000 |
| set_by, created_at | | |

The primary key is (plan_id, effective_from). Month M uses the latest row with
`effective_from ≤ M`; a plan with no row is priced at 0 (029 FR-027).

### `billing_allowance_overrides`

| Column | Type | Notes |
| --- | --- | --- |
| billing_account_id | fk → billing_accounts | |
| kind | string(32) | as above |
| value | bigint null | `NULL` = unlimited |
| note | text | required |
| set_by, created_at, updated_at | | |

The primary key is (billing_account_id, kind). Every change is audited.

### `billing_price_overrides`

| Column | Type | Notes |
| --- | --- | --- |
| billing_account_id | fk | |
| price | string(32) | `base_price`, `alert_overage_price`, `data_point_overage_price` |
| value | bigint | |
| note | text | |
| effective_from | date | first day of the next month when set (029 FR-028) |
| set_by, created_at | | |

The primary key is (billing_account_id, price, effective_from). Removing an override
writes a row with a `NULL` value from next month.

### `billing_plan_assignments`

| Column | Type | Notes |
| --- | --- | --- |
| id, uuid | | |
| billing_account_id | fk | |
| plan_id | fk, restrict | |
| kind | string(16) | `paid`, `trial`, `trial_unpaid` |
| started_at | timestamptz | |
| ended_at | timestamptz null | |
| trial_ends_at | timestamptz null | `trial` only; null for an open-ended trial |
| end_reason | string(32) null | `changed`, `removed`, `trial_reached_end`, `trial_ended_by_admin`, `trial_converted`, `payment_method_added` |
| assigned_by, ended_by | user id null | null when the platform did it |

- A partial unique index on (billing_account_id) `WHERE ended_at IS NULL` allows one
  open assignment.
- Rows follow one another without overlap. A gap means no plan.
- The kinds move like this:
  - `trial` goes to `paid` at its end if a payment method exists, otherwise to
    `trial_unpaid`.
  - `trial_unpaid` goes to `paid` from the next 00:00 UTC once a card is added, or by
    an administrator.
  - Any kind can be ended by a plan change or plan removal.

## Usage

### `billing_usage`

| Column | Type | Notes |
| --- | --- | --- |
| billing_account_id | fk | |
| kind | string(32) | `alerts`, `sms`, `data_points` |
| month | date | |
| count | bigint | |
| overage | bigint | |
| updated_at | | |

The primary key is (billing_account_id, kind, month). Writers lock the row; see
`Usage::add` and `Usage::reserve` (research R5).

### `billing_usage_shares`

The primary key is (billing_account_id, organization_uuid, kind, month). Columns:
`organization_id` (null once the organization is deleted), `organization_name`
(snapshot) and `count`. This table is added to `OrganizationDeletion::KEPT` with
`organization_id` set null.

### `billing_overage`

Columns: `billing_account_id`, `kind`, `month`, `plan_assignment_id` (null when the
account had no plan) and `quantity`. A primary key cannot include a nullable column,
so a unique index on (billing_account_id, kind, month, plan_assignment_id) `NULLS NOT
DISTINCT` (PostgreSQL 15+) keys the rows. Invoices
price each row at that assignment's plan, or at 0 for `trial` and `trial_unpaid`.

### `billing_device_peaks`

The primary key is (billing_account_id, month). Column: `peak`. It is raised whenever
a claim takes the count above it.

### `billing_data_point_buckets`

| Column | Type | Notes |
| --- | --- | --- |
| organization_uuid | uuid | |
| hour | timestamptz | UTC hour start |
| count | bigint | highest cumulative count reported |
| billing_account_id | fk null | the account at `hour`, fixed when first seen |
| updated_at | | |

The primary key is (organization_uuid, hour). Applying a report adds `max(0, reported
- count)` to usage. Rows are pruned after 13 months.

### `billing_usage_watermarks`

The primary key is `source` (`runtime`). Columns: `final_through` (timestamptz) and
`reported_at`. The value only moves forward.

## Devices

`devices.limit_place_at` (timestamptz null) is added, with a partial index on
`(organization_id) WHERE limit_place_at IS NOT NULL AND deleted_at IS NULL`. It is set
by `DeviceLimit::claim` and cleared on the events listed in research R7. The rollout
sets it for devices that are `active` or have an activation outstanding.

## Retention

### `telemetry_retention_floors` (Devices domain)

| Column | Type | Notes |
| --- | --- | --- |
| id | | |
| organization_id | fk, cascade | |
| days | integer | the period that applied before the reduction |
| until | timestamptz | change time + 30 days |
| reason | string(64) | `plan_changed`, `plan_edited`, `override`, `organization_moved`, `trial` |
| warned_at | timestamptz null | the 7-day warning was sent |
| created_at | | |

The cleanup days sent in `/state` are the effective days raised to the highest floor
whose `until` is still ahead. Floors are pruned once expired.

`RetentionService::effective` returns `source` ∈ `organization`, `billing_account`,
`platform` or `default`, plus `pending_reduction` (`{days, from}`) when a floor is
active.

## Billing accounts (spec 023 table, changed)

| Change | Notes |
| --- | --- |
| drop `organization_limit` | migrated to `billing_allowance_overrides` (kind `organizations`) when not 1 |
| add `billing_address` text null | shown on invoices |
| add `tax_number` string(64) null | |
| add `billing_tax_rate_id` fk null | `NULL` = no tax |
| add `stripe_id` string null, index | Cashier customer |
| add `pm_type` string null, `pm_last_four` string(4) null, `pm_expires` string(7) null | display only (brand, last four, `YYYY-MM`) |
| add `past_due_since` timestamptz null | set when an invoice passes its due date unpaid, cleared when none remain |

## Settings and tax

### `billing_settings`

A single row with `legal_name`, `address`, `tax_registration_number`,
`invoice_footer`, `invoice_prefix` (default `INV-`), `credit_note_prefix` (default
`CN-`), `revision`, `updated_by` and `updated_at`. The currency comes from config
(`BILLING_CURRENCY`), not from this row, so it cannot change under issued invoices.

### `billing_tax_rates`

`id`, `uuid`, `name` (unique), `basis_points` (0–10,000), `archived_at` and
timestamps. An archived rate stays on the accounts that have it and cannot be newly
chosen.

## Invoices

### `billing_invoices`

| Column | Type | Notes |
| --- | --- | --- |
| id, uuid | | |
| billing_account_id | fk, restrict | an account with issued invoices cannot be deleted (029 FR-037) |
| month | date | unique with the account |
| status | string(16) | `draft`, `issued` |
| number | string(32) null | set at issue; unique |
| usage_incomplete | boolean | drafted before usage was final |
| draft_note | text null | why it was drafted early |
| currency | char(3) | |
| operator_details, account_details | jsonb null | snapshots taken at issue |
| tax_rate_name | string null | snapshot at issue |
| tax_basis_points | integer null | snapshot at issue |
| subtotal, tax, total, credit_applied, amount_due | bigint | |
| due_at | timestamptz null | issue + 14 days (D8) |
| payment_status | string(24) | `pending`, `paid`, `failed`, `credited`, `paid_outside` |
| drafted_by | user id null | null when the platform drafted it |
| drafted_at | timestamptz | |
| issued_by | user id null | |
| issued_at | timestamptz null | |

Once `status = issued`, no column except `payment_status` changes.

### `billing_invoice_lines`

`invoice_id`, `position`, `kind` (`base_price`, `trial`, `alert_overage`,
`data_point_overage`, `adjustment`, `credit`), `description`, `quantity`
(numeric(18,4)), `unit_price` (bigint null), `amount` (bigint; negative for credits),
`period_start`, `period_end`, `plan_assignment_id` null, `note` (adjustments) and
`created_by`.

### `billing_invoice_usage`

`invoice_id`, `organization_uuid`, `organization_name`, `kind` and `count`. This is
each organization's usage, snapshotted when drafted or recalculated.

### `billing_credit_notes`

`id`, `uuid`, `invoice_id`, `number` (unique), `amount` (gross, > 0, at most the
invoice total minus earlier credit notes), `reason`, `issued_by` and `issued_at`.

### `billing_account_credits`

A ledger with `billing_account_id`, `amount` (+ credit, − applied), `credit_note_id`
null, `invoice_id` null and `created_at`. The balance is the sum of `amount`.

### `billing_number_sequences`

`name` is the primary key (`invoice`, `credit_note`), with a `next` bigint. Issuing
locks the row (research R13).

## Payments

### `billing_payments`

| Column | Type | Notes |
| --- | --- | --- |
| id, uuid | | |
| invoice_id | fk | |
| amount | bigint | |
| method | string(16) | `card`, `checkout`, `outside` |
| provider_reference | string null, unique | PaymentIntent id |
| attempt | smallint | 1 at issue, 2 on the due date, 3 seven days after |
| status | string(16) | `pending`, `succeeded`, `failed` |
| failure_reason | text null | the provider's message |
| note | text null | outside payments |
| recorded_by | user id null | |
| status_at, created_at, updated_at | | |

Status only moves forward: `pending` → `failed` | `succeeded`, and `failed` →
`succeeded`.

### `billing_provider_events`

`provider_event_id` is the primary key, with `type` and `received_at`. The webhook
listener inserts it first and acts only when it inserted. Rows are pruned after 30
days, beyond Stripe's three-day redelivery window (constitution VII).

## Notices

### `billing_notices`

`billing_account_id`, `kind`, `key` and `sent_at`, unique on (billing_account_id,
kind, key). The kinds are `usage_threshold`, `trial_reminder`, `trial_ended`,
`retention_reduction`, `retention_warning`, `invoice_issued`, `credit_note_issued`,
`receipt`, `payment_failed` and `payment_reminder`. Example keys:
`data_points:2026-11:80` and `invoice:{uuid}:due`. `billing:prune` deletes rows
older than 13 months (constitution VII). Every key includes its month or a one-off
subject (an invoice, a trial assignment, a floor), so a pruned key is never due
again.

## Runtime (`device_runtime` schema, Go)

### `usage_data_points`

| Column | Type | Notes |
| --- | --- | --- |
| organization_uuid | uuid | |
| hour | timestamptz | `date_trunc('hour', now())` of the storage transaction |
| count | bigint | stored readings (observations + diagnostics, calculated included) |
| reported_count | bigint | last count put in a report |
| reported_final | boolean | the bucket was reported as final |

The primary key is (organization_uuid, hour). `Store.PersistResult` upserts `count`
in its transaction, and the reporter updates `reported_count` and `reported_final` in
the transaction that writes the outbox event. Rows are pruned 40 days after the hour.

## Audit events (ActivityCatalogue)

The new events are:

- `billing_plan.created`, `.updated`, `.archived`, `.restored`, `.deleted`;
- `billing_plan.prices_set`;
- `billing_account.plan_assigned`, `.plan_removed`;
- `billing_account.allowance_overridden`, `.allowance_override_removed`;
- `billing_account.price_overridden`;
- `billing_account.trial_started`, `.trial_changed`, `.trial_ended`;
- `billing_account.payment_method_changed`;
- `billing_account.billing_details_updated`;
- `billing_settings.updated`;
- `billing_tax_rate.created`, `.updated`, `.archived`;
- `billing_invoice.drafted`, `.adjusted`, `.issued`;
- `billing_credit_note.issued`;
- `billing_payment.recorded`.

Each records its actor. Account events use the account's uuid as `resource_uuid`, so
the account history (spec 023) shows them.
