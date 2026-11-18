# Data Model: Self Sign-Up

Two new tables. Users, billing accounts, organizations, memberships and push devices
are the existing ones, created through the existing services ([research R5](research.md)).

## `sign_ups`

One attempt to sign up ([spec](spec.md) Key Entities).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | bigint | primary key |
| `uuid` | uuid | unique; the only id that leaves the API |
| `name` | string(120) | the person's name |
| `email` | string(255) | lowercased |
| `organization_name` | string(80) | |
| `password` | string, nullable | bcrypt hash; null on `refused`, cleared once completed |
| `state` | string(16) | `waiting`, `completed`, `refused` |
| `refusal_reason` | string(32), nullable | `honeypot`, `too_fast`, `form_expired`, `paused`, `account_exists` |
| `token_hash` | char(64), nullable | SHA-256 of the current link's token; kept after use so a second opening answers `used` |
| `token_expires_at` | timestamptz, nullable | 24 hours after the link was sent |
| `sends` | smallint | links sent, for the admin list |
| `last_sent_at` | timestamptz, nullable | |
| `ip_address` | inet, nullable | for abuse review |
| `user_agent` | string(255), nullable | truncated |
| `confirmed_at` | timestamptz, nullable | when the link was opened |
| `completed_at` | timestamptz, nullable | same transaction as `confirmed_at` |
| `signed_in_at` | timestamptz, nullable | when the waiting browser was signed in (once) |
| `user_id` | bigint FK users, nullable | null on delete |
| `organization_id` | bigint FK organizations, nullable | null on delete |
| `billing_account_id` | bigint FK billing_accounts, nullable | null on delete |
| `created_at`, `updated_at` | timestamptz | |

Indexes: a partial unique index on `email` where `state = 'waiting'` (one waiting
sign-up per address, FR-015); `token_hash` unique where not null; `(state,
created_at)` for the admin list and the daily ceiling.

**States**

```text
            submit (checks pass)            open link (valid)
 (none) ───────────────────────▶ waiting ─────────────────────▶ completed
    │                              │  │ new submit, same email: row updated
    │ submit (bot, ceiling)        │  │ (new name, hash, organization, token)
    ▼                              │  └ older than 7 days: deleted (prune)
 refused ◀─────────────────────────┘ account exists when the link is opened
    └ older than 30 days: deleted (prune)
```

The admin list shows `waiting` with an expired token as **Expired** (computed,
not stored).

**Rules**

- `name`: 1 to 120 characters; `organization_name`: 2 to 80; neither may contain `<`,
  `>`, `://` or `www.` (FR-043).
- `email`: RFC address, at most 255, stored lowercased (Fortify's
  `lowercase_usernames`).
- The token is 40 random characters, sent only in the email (in the link's fragment);
  a new send replaces `token_hash` and `token_expires_at` (FR-009).

## `sign_up_settings`

One row (`id = 1`), created by its migration with the defaults.

| Column | Type | Default | Notes |
| --- | --- | --- | --- |
| `open` | boolean | false | FR-025 |
| `free_beta` | boolean | true | FR-031, FR-033 |
| `notify_push` | boolean | true | FR-024 |
| `notify_email` | boolean | false | FR-024 |
| `daily_limit` | integer | 50 | 1 to 10,000 (FR-042) |
| `revision` | integer | 1 | stale saves get 409 |
| `updated_by` | bigint FK users, nullable | null | |
| `updated_at` | timestamptz | | |

Every change writes `sign_up_settings.updated` to the activity log with the changed
fields, no organization, and the super administrator as actor (FR-027).

## What a completed sign-up creates

| Record | Through | Values |
| --- | --- | --- |
| `users` | `User::forceCreate` | name, email, the sign-up's hash, `email_verified_at` now |
| `billing_accounts` | `BillingAccounts::create` | name = organization name, `contact_email` = email, no plan |
| `billing_account_owners` | `BillingAccounts::addOwner` | the person, added by themself |
| `organizations` | `OwnerOrganizations::create` | name, free slug, under the account |
| membership + role | `OwnerOrganizations::create` | the person as `organization-admin` |
| `billing_account_assignments` | `Organization::created` hook | from now |

Activity log entries, all with the person as actor: `billing_account.created`,
`billing_account.owner_added`, `organization.created` (new for the owner path, with
`source: "sign_up"` or `"owner"`), and `sign_up.completed` (with the sign-up's uuid,
no email in an organization's log).
