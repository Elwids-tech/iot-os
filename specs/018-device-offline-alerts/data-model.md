# Data Model: Device Offline Alerts

Decisions referenced as D*n* are in [research.md](research.md). Contracts for the
messages are in [contracts/](contracts/).

## Runtime (`device_runtime` schema)

### `connectivity` (new table, idempotent DDL in `rt/storage/schema.sql`)

One row per monitored subject. Written only when monitoring starts, an episode opens,
clears or stops, or settings change; never per packet (D1).

| Column | Type | Notes |
| --- | --- | --- |
| `subject_key` | text, primary key | `device:<device uuid>`, `gateway:<connection uuid>/<edge node id>` or `source:<adapter uuid>` |
| `organization_uuid` | uuid | from the definitions |
| `kind` | text | `device`, `gateway`, `source` |
| `monitoring_since` | timestamptz | set when monitoring starts or restarts (D13) |
| `heard_since_monitoring` | boolean | false until the first packet that counts (D2) after `monitoring_since` |
| `settings_generation` | bigint | last applied settings generation (devices only) |
| `episode` | integer | last episode number, starts at 0 |
| `open` | boolean | an episode is open |
| `offline_since` | timestamptz null | when the open episode's condition began |
| `opened_at` | timestamptz null | when it opened (after grace) |
| `cause` | text null | `death_certificate`, `missed_check_in`, `gateway_offline`, `source_disconnected` |
| `updated_at` | timestamptz | |

Retention: rows for subjects with no active definition are deleted by the existing
daily cleanup once no episode is open.

### In memory (tracker)

Per subject: last heard (receipt), last observed (the newest reading's observed time),
anchor (D3), the time its offline condition began (for grace), the time it came back
(for clear grace), the observed-time gaps of its recent readings (at most 64, none
older than 7 days, D16), the settings and poll interval in effect, and whether a parent
gateway episode suppresses it (D4). Per connection: connected and the time it was
restored. Per adapter edge: alive, and since when it has been dead (its NDEATH), so
its NBIRTH can move its devices' anchors forward by the dead time (D3). Rebuilt from
definitions and the table on start; gaps are seeded from `device_runtime.observations`
(last 7 days); anchors start at `activeSince`.

### Subject state

```text
waiting ──first packet──▶ learning ──third reading──▶ monitored ──condition true──▶ pending
   ▲                     (automatic                      ▲                              │ grace passes
   │                      only; deaths                   │ grace passes                 ▼
   │ monitoring (re)starts  still count)             recovering ◀──condition false── offline (episode open)
   │                                                                                    │
   └──────────────── deactivated / disabled / definition removed ──────────────────────┴─▶ stopped (episode closed)
```

- `learning` applies only while *Offline after* is automatic and the device has fewer
  than three readings in its window (D16). A device whose *Offline after* is set, or
  that already has three readings at start, goes from `waiting` to `monitored`.
  A *stays connected* device in `learning` still goes to `pending` on a death.
- *Condition true* means: stays connected and a death certificate (own or the parent
  edge's, never an adapter's), or silence since the anchor ≥ offline after (set, or
  automatic: `clamp(ceil_to_minute(3 × reporting interval + poll interval), 900,
  604800)`), or (source) customer broker or vendor API disconnected. A parent gateway
  episode keeps a child in `monitored` (suppressed).
- *Condition false* means a packet arrived (and the source reconnected). A *connects to
  report* device goes from `offline` straight to `monitored` on a packet.
- An interruption (D3) freezes evaluation for the affected subjects and moves their
  anchor; it never causes a transition. An adapter's NDEATH is one, until its next
  NBIRTH, which moves its devices' anchors forward by the time it was dead.

## Control plane (Laravel)

### `automation_alerts` (changed, D7)

| Change | Notes |
| --- | --- |
| `kind` string(32), default `workflow` | `workflow`, `device_offline`, `gateway_offline`, `connection_lost` |
| `severity` string(16), default `warning` | workflow alerts keep `warning` (today's behaviour) |
| `automation_workflow_id`, `automation_deployment_id` nullable | check (PostgreSQL): workflow alerts have both, other kinds have neither |
| `episode_key` string(160) null, unique | `<subject_key>#<episode>` for connectivity alerts |
| `subject_device_id` FK devices null | device alerts |
| `subject_gateway_id` FK sparkplug_gateways null | gateway alerts |
| `subject_adapter_id` FK device_adapters null | connection-lost alerts |
| `cause` string(32) null | as in the runtime |
| `offline_since`, `last_seen_at` timestamptz null | |
| `threshold_seconds`, `grace_seconds` integer null | the settings in effect when it opened |
| `threshold_automatic` boolean null | the threshold was automatic (D16) |
| `reporting_interval_seconds`, `poll_interval_seconds` integer null | what an automatic threshold came from |
| `last_observed_at` timestamptz null | the newest reading's observed time (FR-015) |
| `stopped_reason` string(64) null | `device_deactivated`, `monitoring_disabled`, `device_removed` |
| `suppressed_at` timestamptz null | opened while muted (D8) |
| `held` boolean default false, `held_count` integer default 0 | flapping (D10) |

Existing unique `(automation_deployment_id, episode)` stays; PostgreSQL treats nulls as
distinct. All foreign keys `restrictOnDelete`, as today. `OrganizationDeletion` already
lists the table; the new pivot joins the same group.

### `automation_alert_devices` (new)

`automation_alert_id` FK, `device_id` FK, primary key on both. One row per device the
alert concerns. Workflow alerts are backfilled from their bound device, so the device
filter, recipient matching and integration grants have one path for every kind.

### `automation_alert_deliveries` (changed, D9, D10)

| Change | Notes |
| --- | --- |
| `channel` string(32), default `email` | spec 011 adds values |
| `batch_id` FK notification_batches null | set when the delivery joins a summary |
| unique key | becomes (alert, recipient, type, channel) |

### `notification_batches` (new)

`id`, `uuid`, `recipient_id` FK users, `channel`, `opens_at`, `closes_at`, `sent_at`
null, `status` (`open`, `sent`, `cancelled`). One open batch per recipient and channel.

### `device_profiles` (changed, D6)

`connectivity_settings` jsonb null, `connectivity_revision` integer default 0. Not part
of the compiled definition; saving does not call `beginDraft`.

### `devices` (changed, D6)

`connectivity_overrides` jsonb null, `connectivity_revision` integer default 0,
`connectivity_generation` bigint default 0 (incremented whenever the device's effective
settings change, from either source).

Settings shape (each field optional in an override; all present in the effective
settings):

| Field | Type | Range | Default |
| --- | --- | --- | --- |
| `enabled` | boolean | | true |
| `style` | enum | `stays_connected`, `connects_to_report` | `stays_connected`; always `connects_to_report` for a device with an open `device_installations` row (D5) |
| `offline_after_seconds` | integer or null | 60–604,800 | null: automatic (D16) |
| `grace_seconds` | integer | 0–3,600 | 120 |
| `severity` | enum | `critical`, `warning`, `info` | `warning` |

An override cannot set `offline_after_seconds` back to automatic while its profile sets
a value; it clears its own field to inherit, and a profile clears its field to return
its devices to automatic. Effective settings sent to the runtime also carry
`poll_interval_seconds` (from the adapter's running revision, null when not polled).
`connectivity_generation` also increments when an adapter revision with a different
poll interval is deployed for the device's adapter.

### `connectivity_mutes` (new, D8)

`id`, `uuid`, `organization_id`, `target_type` (`device`, `gateway`, `site`,
`profile`), `target_id`, `until` (at most 30 days ahead), `reason` (≤ 500), `created_by`
FK users, `ended_at` null (ended early), timestamps. Active when `now < until` and
`ended_at` is null.

### `connectivity_routes` (new, D9)

`id`, `uuid`, `organization_id`, `name` (≤ 120), `enabled`, `scope` jsonb,
`min_severity`, `recipient_ids` jsonb (integer user ids, ≤ 20, verified members with
`Device.view`), `notify_on_clear`, `revision`, `created_by`, timestamps.

### `connectivity_subscriptions` (new, D9)

`id`, `uuid`, `organization_id`, `user_id`, `scope` jsonb, `notify_on_clear`,
`revision`, timestamps. Unique per (organization, user, scope hash) so a person cannot
save the same subscription twice.

Scope shape (shared): `{ "all": true }` or any of `site_uuids`, `tags`,
`profile_uuids`, `device_uuids` (each ≤ 50). A device matches if it matches any listed
item. A subscription matches only devices its owner can view at match and send time.

### `integration_applications` (changed, D11)

`connectivity_events` boolean default false.

### `notification_preferences.grid` (no migration, D9)

Gains a `connectivity` source with the four levels. Reading a stored grid without it
yields all four on.

### `notifications` (no migration, D17)

The bell's Laravel database notifications (spec 022). A connectivity delivery writes
one of type `alert` with data `{v: 1, source: "connectivity", organization_uuid,
alert_uuid, episode, transition, occurred_at, kind, subject: {type, uuid, name},
device_uuid, device_name, workflow_uuid: null, workflow_name: null}`. The existing
partial indexes on `type = 'alert'` cover it.

### `notification_events` (no migration)

New source `connectivity`; severity from the alert; link to the alert.

## Validation rules

- Settings ranges as above; an override field that is null inherits.
- A route needs at least one recipient while enabled (422), as workflow email does.
- Mutes end in the future and at most 30 days ahead; a target must belong to the
  organization (404 otherwise).
- Every list in a scope must reference the organization's own sites, profiles and
  devices (404 otherwise); tags are free text, ≤ 32 characters, matched
  case-insensitively as device tags are.
- Revisions: stale `revision` on settings, routes and subscriptions returns 409.

## Alert lifecycle (connectivity kinds)

```text
runtime: opened ──▶ alert created (active)
            │          ├─ subject muted → suppressed_at set, no deliveries, no bell
            │          ├─ subject flapping → held, no deliveries, no bell
            │          └─ otherwise → deliveries per matching recipient and channel,
            │                         and one bell notification per recipient
runtime: cleared ─▶ cleared_at set; recovery deliveries to recipients who got the activation and chose recovery
runtime: stopped ─▶ stopped_reason set; pending deliveries cancelled; no recovery
mute ends ───────▶ suppressed and still open → suppressed_at cleared, deliveries created
```
