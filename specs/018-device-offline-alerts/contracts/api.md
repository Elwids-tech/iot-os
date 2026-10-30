# Contract: public API

All paths are under `/api/v1/organizations/{organization}` unless noted. Every new
operation has a described response in the generated OpenAPI contract (none goes on
`pending-schemas.json`), a method and types in `packages/api-client`, and a
cross-organization test (principle III). User references are integer `user_id`s
(ADR-013). Stale `revision` values return 409; another organization's resources return
404.

## Offline settings

| Method and path | Purpose | Permission |
| --- | --- | --- |
| `GET device-profiles/{profile}/connectivity` | Profile settings, the defaults they fill, and a reporting check (FR-004a) | `Device.view` |
| `PUT device-profiles/{profile}/connectivity` | `{revision, enabled, style, offline_after_seconds, grace_seconds, severity}` (each nullable: null inherits the default; for `offline_after_seconds` the default is automatic) | `Device.manage` |
| `GET devices/{device}/connectivity` | `{revision, overrides, effective, inherited_from, style_locked, state, warning, mute}`; `warning` is the device's reporting check entry (below) or null; `state` from the runtime (`waiting`, `learning`, `monitored`, `offline`, …, with `monitoring_since`, `last_heard_at`, `last_observed_at`, `reporting_interval_seconds`, `poll_interval_seconds`, `offline_after_seconds`, `offline_after_automatic`) or `unknown` when the runtime is unreachable | `Device.view` |
| `PUT devices/{device}/connectivity` | `{revision, overrides}` | `Device.manage` |

`inherited_from` names, per field, `device`, `profile`, `automatic` (only
`offline_after_seconds`) or `default`. `style_locked` is `{reason: "adapter"}` for a
device fed by a device adapter, whose style is always `connects_to_report` (a `style`
in its overrides returns 422), otherwise null. `poll_interval_seconds` comes from the
adapter's running revision, as on `GET workflows/dag/resources`.

Reporting check entry: `{device_uuid, name, reporting_interval_seconds,
poll_interval_seconds, offline_after_seconds, suggested_offline_after_seconds}`, for
devices whose *Offline after* is set (on the device or the profile) and shorter than
their reporting interval plus their poll interval; at most 20, slowest first, with
`total`. The suggestion is the device's automatic value (D16).

## Mutes

| Method and path | Purpose | Permission |
| --- | --- | --- |
| `GET connectivity/mutes` | Active mutes (`?target_type=&target_uuid=`, `include_ended=1`) | `Device.view` |
| `POST connectivity/mutes` | `{uuid, target_type, target_uuid, until, reason}`; client `uuid` makes retries safe | `Device.manage` |
| `POST connectivity/mutes/{mute}/end` | End early | `Device.manage` |

## Routes (administrator-configured)

| Method and path | Purpose | Permission |
| --- | --- | --- |
| `GET connectivity/routes` | List | `Device.manage` |
| `POST connectivity/routes` | `{name, enabled, scope, min_severity, recipient_ids, notify_on_clear}` | `Device.manage` |
| `GET/PUT connectivity/routes/{route}` | Read, update with `revision` | `Device.manage` |
| `DELETE connectivity/routes/{route}` | Remove; pending deliveries it caused are rechecked and cancelled if nothing else matches | `Device.manage` |
| `GET connectivity/routes/recipients` | Eligible recipients (verified members with `Device.view`) | `Device.manage` |

## Personal subscriptions (the signed-in member's own)

| Method and path | Purpose | Permission |
| --- | --- | --- |
| `GET connectivity/subscriptions` | The member's subscriptions in this organization | `Device.view` |
| `POST connectivity/subscriptions` | `{scope, notify_on_clear}` | `Device.view` |
| `PUT/DELETE connectivity/subscriptions/{subscription}` | Own subscriptions only (another member's returns 404) | `Device.view` |

`scope` is `{ "all": true }` or any of `site_uuids`, `tags`, `profile_uuids`,
`device_uuids` (each ≤ 50).

## Alerts (changed)

- `GET alerts` gains `kind=workflow|device_offline|gateway_offline|connection_lost`
  (repeatable) and `muted=0|1` (default 0 hides suppressed alerts). `device` now also
  matches gateway alerts that list the device.
- The alert resource gains `kind`, `severity`, `subject` (`{type, uuid, name}`),
  `cause`, `offline_since`, `last_seen_at`, `last_observed_at`, `threshold_seconds`,
  `threshold_automatic`, `reporting_interval_seconds`, `poll_interval_seconds`,
  `grace_seconds`, `stopped_reason`, `muted`, `held`, `held_count` and `devices`
  (≤ 100, with `devices_total`). `workflow` is null for connectivity kinds. Existing
  fields keep their meaning for workflow alerts.
- `GET devices` rows gain `offline_alert` (`{uuid, kind, cause, since}` or null).

## Alert notifications: the bell (changed, D17)

`GET alert-notifications` items gain `kind` (`workflow`, `device_offline`,
`gateway_offline`, `connection_lost`) and `subject` (`{type, uuid, name}`, null for
workflow alerts). `workflow` becomes nullable: null for connectivity kinds, unchanged
for workflow alerts. `summary` and `read` are unchanged; opening a connectivity alert
marks its notifications read like any alert.

## Notification preferences (no organization prefix, changed)

`GET/PUT /api/v1/notifications/preferences`: `grid` gains the `connectivity` source
(`critical`, `warning`, `info`, `recovery`). `GET /api/v1/notifications/events?source=`
accepts `connectivity`.

## Integration applications (changed)

`GET applications` and `PUT applications/{application}` gain `connectivity_events`
(boolean). Changing it does not rotate tokens, cancel webhook deliveries or change the
grant revision; it applies to events the application reads or receives afterwards.
