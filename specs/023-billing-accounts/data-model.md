# Data Model: Billing Accounts

PostgreSQL 17. Migration `2026_10_31_000000_create_billing_accounts.php`.

## `billing_accounts`

| Column | Type | Rules |
| --- | --- | --- |
| `id` | bigint, primary key | |
| `uuid` | uuid, unique | Set on `creating`. Route key. |
| `name` | string(255) | Required. Not unique: two customers may share a name. |
| `contact_email` | string(255), nullable | A valid email when present. Need not belong to a user. |
| `notes` | text, nullable | At most 2,000 characters. |
| `organization_limit` | unsigned smallint, default 1 | From 0 to 1000. Binds owners only (R6). |
| `created_at`, `updated_at` | timestampTz | |
| `deleted_at` | timestampTz, nullable | Soft delete, allowed only with no organizations (R4). |

Relations:

- `owners`: users through `billing_account_owners`.
- `organizations`: `organizations.billing_account_id`.
- `assignments`: `billing_account_assignments.billing_account_id`.

## `billing_account_owners`

| Column | Type | Rules |
| --- | --- | --- |
| `billing_account_id` | FK `billing_accounts`, cascade on delete | |
| `user_id` | FK `users`, cascade on delete | Integer user id (ADR-013). |
| `added_by` | FK `users`, nullable, set null on delete | The platform administrator who added the owner. |
| `created_at` | timestampTz | |

Primary key `(billing_account_id, user_id)`, plus an index on `user_id` for "accounts I
own". Adding an existing owner changes nothing. Owners of a soft-deleted account keep
their rows but see nothing.

## `organizations` (changed)

| Column | Type | Rules |
| --- | --- | --- |
| `billing_account_id` | FK `billing_accounts`, restrict on delete, indexed | `NOT NULL` after the backfill. Not mass-assignable. Filled by the `creating` hook when unset (R2). |

## `billing_account_assignments`

| Column | Type | Rules |
| --- | --- | --- |
| `id` | bigint, primary key | |
| `billing_account_id` | FK `billing_accounts`, restrict on delete | Accounts are only soft-deleted. |
| `organization_id` | FK `organizations`, nullable, set null on delete | Listed in `OrganizationDeletion::KEPT`. |
| `organization_uuid` | uuid | A snapshot that outlives the organization. |
| `organization_name` | string(255) | The name when the assignment started. |
| `started_at` | timestampTz | |
| `ended_at` | timestampTz, nullable | Null while current. |
| `assigned_by` | FK `users`, nullable, set null on delete | Null for the backfill and for creation outside a request. |
| `ended_by` | FK `users`, nullable, set null on delete | Who moved or deleted the organization. |

Indexes:

- unique `(organization_uuid) where ended_at is null`, one current assignment per
  organization;
- `(organization_uuid, started_at)`;
- `(billing_account_id, started_at)`.

### Lifecycle

```text
organization created ──▶ open (started_at = now, assigned_by = actor)
          │
          ├─ moved to another account ──▶ closed (ended_at, ended_by)
          │                                + new open row on the target account
          └─ organization deleted ──────▶ closed (ended_at, ended_by),
                                          then organization_id → null
```

Invariants, checked by `BillingAssignmentHistoryTest`:

1. For each organization, the rows ordered by `started_at` do not overlap, and each
   row's `ended_at` equals the next row's `started_at`.
2. An existing organization has exactly one open row, whose account equals
   `organizations.billing_account_id`.
3. A deleted organization has no open row.

Moving to the account the organization already has writes nothing. A move takes one
timestamp and uses it for both the old row's `ended_at` and the new row's
`started_at`. The columns keep microseconds, so two separate `now()` calls would
leave a gap and break invariant 1.

## `device_audit_events` (index only)

A new index on `(resource_uuid, created_at)` for the account history (R11). Actions,
all with a null `organization_id`:

| Action | `resource_uuid` | `details` |
| --- | --- | --- |
| `billing_account.created` | account | `name`, `organization_limit` |
| `billing_account.updated` | account | `changes`: `{field: {from, to}}` for each changed field |
| `billing_account.deleted` | account | `name` |
| `billing_account.owner_added` | account | `user_id`, `user_name` |
| `billing_account.owner_removed` | account | `user_id`, `user_name` |
| `organization.billing_account_changed` | organization | `from` and `to`: `{uuid, name}` |

## Validation summary

| Input | Rule |
| --- | --- |
| Billing account `name` | Required, string, at most 255 characters, trimmed. |
| `contact_email` | Nullable, email, at most 255 characters. |
| `notes` | Nullable, string, at most 2,000 characters. |
| `organization_limit` | Integer from 0 to 1000. |
| `billing_account_uuid` (create organization, move) | A uuid of an account that has not been deleted. |
| `new_billing_account` | An object with `name` (as above) and an optional `contact_email`. It cannot be sent together with `billing_account_uuid`. |
| Owner-created organization `name` | Required, string, at most 255 characters. |
| Owner-created organization `slug` | Optional; `alpha_dash`, at most 255 characters, unique among all organizations including trashed ones. Generated when absent. |
