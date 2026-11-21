# Data Model: White Labeling and Custom Domains

PostgreSQL. All new tables have `id`, `uuid` (route key) and timestamps. Users are
referenced by integer `user_id` (ADR-013).

## `brands` (new)

One per billing account at most.

| Column | Type | Notes |
| --- | --- | --- |
| `billing_account_id` | FK, unique | Deleting the account deletes the brand |
| `product_name` | varchar(40), nullable | Shown in titles, sign-in, mail sender name |
| `short_name` | varchar(12), nullable | Installed-app name; defaults to the product name cut to 12 |
| `support_url` | varchar(2048), nullable | `https:` or `mailto:` only |
| `logo_asset_id` | FK `brand_assets`, nullable | |
| `logo_dark_asset_id` | FK `brand_assets`, nullable | Used on dark appearance; falls back to the logo |
| `icon_asset_id` | FK `brand_assets`, nullable | Square; tab icon, installed app, notifications |
| `revision` | integer | Bumped on every change; `PUT` with a stale revision answers 409 |
| `updated_by` | FK `users`, nullable | |

A brand **takes effect** only while the account's `branding` allowance is 1 and it has
a product name. Otherwise everything falls back to the platform's, and the row is kept
(FR-037).

## `brand_assets` (new)

One uploaded image and its stored sizes.

| Column | Type | Notes |
| --- | --- | --- |
| `billing_account_id` | FK, nullable | Set for a brand's images |
| `organization_id` | FK, nullable | Set for an organization's logo. Exactly one of the two is set |
| `role` | varchar(16) | `logo`, `logo_dark` or `icon` |
| `content_hash` | char(64) | SHA-256 of the re-encoded original; part of the public URL |
| `variants` | jsonb | Name → `{path, width, height, bytes}`. Logo: `logo`. Icon: `512`, `192`, `180`, `64`, `maskable` |
| `uploaded_by` | FK `users`, nullable | |
| `replaced_at` | timestamptz, nullable | Set when a newer asset takes its place; pruned a day later |

Validation (R2): PNG, JPEG or WebP by content; at most 1 MB; logo at most 2000×2000
before scaling; icon square within 2% and at least 512×512.

## `organizations` (changed)

| Column | Type | Notes |
| --- | --- | --- |
| `logo_asset_id` | FK `brand_assets`, nullable | |
| `logo_dark_asset_id` | FK `brand_assets`, nullable | |

The logo shown for an organization is its own, else its account's brand logo when the
brand takes effect, else none (the portal shows the platform's name) (FR-004). The
logo stays with the organization when it moves to another account.

## `portal_addresses` (new)

| Column | Type | Notes |
| --- | --- | --- |
| `billing_account_id` | FK, nullable | Kept after a release, so a renamed name can redirect and its account can take it back; null once the account is deleted |
| `kind` | varchar(16) | `name` (under the platform's domain) or `domain` (custom) |
| `host` | varchar(253), unique | Lower case, punycode. For `name`, the full host `<name>.DOMAIN` |
| `state` | varchar(16) | See below |
| `claim_token` | varchar(32), nullable | `domain` only; the CNAME target is `c-<token>.DOMAIN` |
| `claimed_by` | FK `users`, nullable | |
| `claimed_at`, `activated_at`, `last_checked_at`, `last_reachable_at` | timestamptz, nullable | |
| `failed_checks` | smallint | Reset by a good check |
| `unreachable_since`, `suspended_at`, `released_at` | timestamptz, nullable | |
| `suspended_by` | FK `users`, nullable | |
| `redirect_to_id` | FK self, nullable | A renamed `name` redirects to its replacement for 30 days |

Rules:

- At most one live `name` and one live `domain` per account (partial unique indexes on
  `billing_account_id, kind` where the state is not `released` or `lapsed`) (FR-012).
- `host` is unique across all rows, so a released name cannot be claimed by another
  account until 30 days after `released_at` (FR-018); the claim that takes it then
  deletes the old row. Its own account can take it back at any time.
- A `name` follows hostname label rules, 3 to 40 characters, not in the reserved list.
- A `domain` has at least three labels, is not under the platform's domain, and is not
  an address literal. An account that has a live domain removes it before asking for
  another.
- A domain that never served (its request was removed or lapsed) is not held: another
  account can ask for it at once. One that served is held for 30 days like a name.

### States

```text
name:    (claim) ──────────────────────────► active
domain:  (claim) ► waiting_dns ─ record found ► active
                       │ 7 days                 │ 3 failed checks      ▲ good check
                       ▼                        ▼                      │
                     lapsed                 unreachable ───────────────┘
any live state ─ staff ► suspended ─ staff ► (previous state, rechecked)
any live state ─ owner removes / account deleted / allowance gone 30 days ► released
```

- **Serves the portal**: `active` and `unreachable` (the certificate and sessions
  stay; only links fall back).
- **`ask` answers 200**: `active` and `unreachable`.
- **Main address** (FR-016): the `domain` when `active`, else the `name` when
  `active`, else the platform's portal address.
- While the account's `branding` allowance is 0, every address behaves as `suspended`
  without its state changing. The same applies to a `domain` while `custom_domain`
  is 0.

## `passkeys` (changed)

| Column | Type | Notes |
| --- | --- | --- |
| `relying_party_id` | varchar(253), indexed | Filled with the deployment's relying party for existing rows |

## `push_devices` (changed)

| Column | Type | Notes |
| --- | --- | --- |
| `portal_address_id` | FK `portal_addresses`, nullable, set null on delete | Null means the platform's own address |

## Allowances (changed)

`AllowanceKind` gains `branding`, `custom_domain` and `hide_powered_by`. They use the
existing `billing_plan_allowances.value` and `billing_allowance_overrides.value`
columns with 0 or 1 only. The defaults in `config/billing.php` are 0.

## Session (changed, no schema)

A session started on a custom domain holds `portal_address`: the address's id and
when it was activated, so the session ends when the domain is removed, suspended or
claimed again. Sessions on the platform's domain hold none.

## Not stored

- The brand an email used. Each mail resolves its brand and link when it is built.
- Certificates. Caddy keeps them in its own data volume.
