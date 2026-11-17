# Data Model: Installable Portal and Push Alerts

PostgreSQL 17. New tables and columns only; nothing existing is renamed. User
references are the integer `user_id` (ADR-013). Rationale in [research.md](research.md).

## kept_sign_ins (new, Authentication domain)

One per **Keep me signed in** sign-in on one browser or installed app (FR-011a).

| Column | Type | Rules |
| --- | --- | --- |
| `id` | bigint PK | |
| `uuid` | uuid, unique | Public id |
| `user_id` | bigint FK `users`, cascade on delete | Indexed |
| `secret_hash` | char(64) | SHA-256 of the cookie's secret; the secret is never stored |
| `label` | varchar(120) | Browser and system, from the user agent at sign-in |
| `created_at` | timestamptz | Sign-in time |
| `expires_at` | timestamptz | `created_at` + 30 days; never extended. Indexed |
| `last_used_at` | timestamptz, null | Stamped at most once a minute |
| `ended_at` | timestamptz, null | |
| `end_reason` | varchar(32), null | `signed_out`, `password_reset`, `device_removed` |

- **Live** means `ended_at` is null and `expires_at` is in the future.
- **Transitions**: live → ended (sign-out on that device, password reset for all of
  the person's records, or removal of the push device linked to it). Live → expired,
  by time. Nothing comes back to life.
- **Pruning**: rows ended or expired more than 30 days ago are deleted daily.
- **The session** holds `kept_sign_in_id` while it was started or resumed from a
  record, and the middleware checks it on each request (R11).

## push_devices (new, Notifications domain)

One per browser where a person turned on push (FR-020, FR-028).

| Column | Type | Rules |
| --- | --- | --- |
| `id` | bigint PK | |
| `uuid` | uuid, unique | Public id |
| `user_id` | bigint FK `users`, cascade on delete | Indexed |
| `endpoint` | text, encrypted cast | Push service URL |
| `endpoint_hash` | char(64), unique | SHA-256 of `endpoint`, for lookup and uniqueness |
| `public_key` | text, encrypted cast | Browser's `p256dh` key |
| `auth_token` | text, encrypted cast | Browser's `auth` secret |
| `content_encoding` | varchar(16) | `aes128gcm` (default) or `aesgcm` |
| `label` | varchar(60) | For example *Safari on iPhone* |
| `kept_sign_in_id` | bigint FK `kept_sign_ins`, null on delete | The kept sign-in this browser used when last registered or synced |
| `session_id` | text, encrypted cast, null | The session it was last registered or synced from |
| `created_at` | timestamptz | Added |
| `last_synced_at` | timestamptz | Last register or sync from the browser |
| `last_reached_at` | timestamptz, null | Last push the push service accepted |
| `last_failed_at` | timestamptz, null | |
| `last_failure` | varchar(255), null | Status and reason from the push service |

- **Encrypted columns are `text`.** Laravel's encrypted value is base64 JSON holding
  the IV, ciphertext and MAC, so an 88-character key becomes about 340 characters,
  which `varchar(255)` would reject.
- **At most 10 per person.** Registering an eleventh deletes the one with the oldest
  `coalesce(last_reached_at, created_at)` in the same transaction and reports its
  label (FR-020).
- **Ownership moves only by deletion.** Registering or syncing an endpoint held by
  another person deletes that person's row first (R18).
- **Removed** when:
  - the owner removes it, which also ends its kept sign-in and destroys its session;
  - the person signs out on that browser (matched by the current session or kept
    sign-in);
  - a password reset happens (every device: the reset signs the person out everywhere);
  - the push service answers 404 or 410, or 403 for a key mismatch;
  - a restored database is quarantined;
  - the user is deleted.
- **Never returned by the API**: `endpoint`, `public_key`, `auth_token`, `session_id`.

## notification_preferences (existing, three new columns)

| Column | Type | Rules |
| --- | --- | --- |
| `push_enabled` | boolean, default false | **Turn off push everywhere** is `false` |
| `push_levels` | jsonb, null | `{"critical":bool,"warning":bool,"info":bool,"recovery":bool}`; null until push is first turned on, then `critical`, `warning` and `info` on and `recovery` off (FR-019) |
| `push_revision` | integer, default 0 | Optimistic lock for push saves, separate from `revision` (email) |

- A person without a row gets a row on first push registration, with the email
  defaults `Preferences::view()` already applies.
- **Allowed** when `push_enabled` and `push_levels[level]` and the organization is not
  muted. `level` is `warning` for workflow activations and `recovery` for clears until
  spec 011 adds a severity (R14).

## push_organization_mutes (new, Notifications domain)

An organization whose pushes a person switched off (FR-019). No row means on, which
covers organizations joined later.

| Column | Type | Rules |
| --- | --- | --- |
| `user_id` | bigint FK `users`, cascade on delete | PK part |
| `organization_id` | bigint FK `organizations`, cascade on delete | PK part |
| `created_at` | timestamptz | |

## automation_alert_deliveries (existing, two new columns)

Push deliveries are rows with `channel = 'push'`, one per alert, transition (`type`)
and recipient. The existing unique key covers them.

| Column | Type | Rules |
| --- | --- | --- |
| `devices_total` | smallint, null | Push only: devices tried in the latest attempt |
| `devices_reached` | smallint, null | Push only: devices whose push service accepted it |
| `push_summary_id` | bigint FK `push_summaries`, null on delete, null | Push only: the summary that carried it; set with status `summarised`. Added in the `push_summaries` migration |

- **Statuses**: the existing `pending`, `sent`, `failed` and `cancelled`, plus
  `summarised` for push only (sent as part of a summary; terminal, never retried).
- **Push `sent`** means at least one device's push service accepted it. `failed`
  means no device accepted it after the cycle's attempts, or every device was gone.
- **Retry** (`POST …/deliveries/{delivery}/retry`) works for failed push deliveries
  exactly as for email: same generation fence, dispatches by channel.

## automation_alert_delivery_attempts (existing, two new columns)

A push send writes one row per device tried.

| Column | Type | Rules |
| --- | --- | --- |
| `device_label` | varchar(60), null | Snapshot of the device's label; the device may be deleted later |
| `response_status` | smallint, null | Push service HTTP status, null on a transport failure |

Attempt `status` values for push: `accepted`, `transport_failed`, `rejected`, `gone`.

## push_summaries (new, Notifications domain)

One summary push per person, organization and burst window (FR-024).

| Column | Type | Rules |
| --- | --- | --- |
| `id` | bigint PK | |
| `uuid` | uuid, unique | |
| `user_id` | bigint FK `users`, cascade on delete | |
| `organization_id` | bigint FK `organizations`, cascade on delete | |
| `window_started_at` | timestamptz | When the first delivery joined it |
| `window_ends_at` | timestamptz | `window_started_at` + 60 s; the summary is **open** while this is in the future |
| `alert_count` | integer | Deliveries linked to it (`push_summary_id`), counted when sent |
| `status` | varchar(16) | `pending`, `sent`, `failed`, `cancelled` |
| `attempts` | smallint, default 0 | All attempts |
| `cycle_attempts` | smallint, default 0 | Attempts in this cycle; `failed` at 5, as deliveries |
| `devices_total`, `devices_reached` | smallint, null | As for deliveries |
| `sent_at` | timestamptz, null | |
| `diagnostic` | varchar(255), null | |
| timestamps | | |

- **Unique** (`user_id`, `organization_id`, `window_started_at`).
- **Joining, under a lock**: `DeliverAlertPush` locks the person's
  `notification_preferences` row (every person with push has one), so one person's
  deliveries are decided one at a time.
  - An activation joins the person's open summary for that organization, if there is
    one.
  - Otherwise, when 3 or more of their push deliveries for that organization were sent
    in the last 60 s, it opens a new summary from now.
  - Otherwise it is sent on its own.

  A joined delivery gets status `summarised` and `push_summary_id`. Windows never
  overlap, and an alert is counted in exactly one summary.
- **Cancelled** when the person no longer passes the access and preference checks at
  send time, or when every linked alert has cleared.
- **Pruning**: rows older than 90 days are deleted with the bell's notification prune.

## Relationships

```text
users 1─* kept_sign_ins
users 1─* push_devices *─0..1 kept_sign_ins
users 1─0..1 notification_preferences
users *─* organizations  via push_organization_mutes
automation_alerts 1─* automation_alert_deliveries (channel email | push) 1─* automation_alert_delivery_attempts
users, organizations 1─* push_summaries 1─* automation_alert_deliveries (push_summary_id, status summarised)
```

## Organization and user deletion

- Organization deletion (`OrganizationDeletion`): mutes and summaries go by cascade.
  Push deliveries go with their alerts, as email deliveries do.
- User deletion: kept sign-ins, devices, mutes and summaries go by cascade.
