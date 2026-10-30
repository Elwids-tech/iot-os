# Contract: runtime messages

Each message below lands in `contracts/internal/` as `<id>.schema.json` with a
`.fixture.json` and a `.cases.json`, and gets an entry in `contracts/internal/
catalogue.json` naming its producer, consumer and the tests that load it
([ADR-015](../../../docs/adr/ADR-015-internal-contract-validation.md): internal readers
are tolerant, schemas are closed). These are the first entries in that catalogue.

## `device.connectivity.v1` (event, runtime → Laravel)

Written to `device_runtime.outbox` in the same transaction as the `connectivity` row
change, relayed like every runtime event, posted to `/api/internal/devices/events`.

The envelope `uuid` is a UUID v5 of `<subject_key>#<episode>#<transition>` under a
fixed namespace, so a replayed or re-emitted transition deduplicates in
`device_inbox`.

```json
{
  "type": "device.connectivity.v1",
  "uuid": "6f1c0e3a-…",
  "payload": {
    "organization_uuid": "…",
    "subject": {
      "kind": "gateway",
      "device_uuid": null,
      "connection_uuid": "…",
      "edge_node_id": "edge-7",
      "adapter_uuid": null
    },
    "episode": 4,
    "transition": "opened",
    "cause": "death_certificate",
    "offline_since": "2026-10-25T14:02:11Z",
    "at": "2026-10-25T14:04:11Z",
    "last_heard_at": "2026-10-25T14:02:09Z",
    "last_observed_at": "2026-10-25T14:01:58Z",
    "offline_after_seconds": 900,
    "offline_after_automatic": true,
    "reporting_interval_seconds": 60,
    "poll_interval_seconds": null,
    "grace_seconds": 120,
    "settings_generation": 12,
    "affected_device_uuids": ["…", "…"],
    "stop_reason": null
  }
}
```

| Field | Rules |
| --- | --- |
| `subject.kind` | `device` (needs `device_uuid`), `gateway` (needs `connection_uuid` and `edge_node_id`), `source` (needs `adapter_uuid`) |
| `transition` | `opened`, `cleared`, `stopped` |
| `cause` | `death_certificate`, `missed_check_in`, `gateway_offline`, `source_disconnected`; required on `opened` |
| `stop_reason` | `device_deactivated`, `monitoring_disabled`, `definition_removed`; required on `stopped`, else null |
| `affected_device_uuids` | 1–10,000 device uuids; for a device subject, exactly its own |
| `offline_after_seconds` | the threshold used; with `offline_after_automatic` true it was computed from `reporting_interval_seconds` and `poll_interval_seconds` (D16), which are otherwise informational and may be null |
| times | RFC 3339 UTC, receipt times (never device timestamps), except `last_observed_at`, the newest reading's observed time as reported (null for gateways and sources) |

Laravel: a `cleared` or `stopped` without its `opened` creates the alert as historical
(no notices), as late workflow clears do today. An `opened` for a `(subject, episode)`
that already exists is ignored.

## `device.connectivity-settings.v1` (control, Laravel → runtime)

Written to `device_outbox` whenever a device's effective settings change (its own
override, its profile's settings, the platform defaults, or its adapter's poll
interval), claimed and relayed like other control messages. A profile change, or an
adapter deploy that changes the poll interval, writes one message per affected device in the
same transaction.

```json
{
  "type": "device.connectivity-settings.v1",
  "payload": {
    "organization_uuid": "…",
    "device_uuid": "…",
    "generation": 12,
    "enabled": true,
    "style": "connects_to_report",
    "offline_after_seconds": null,
    "poll_interval_seconds": 900,
    "grace_seconds": 120
  }
}
```

`offline_after_seconds` null means automatic (D16). `poll_interval_seconds` is the
running adapter revision's interval, or null when the device is not polled. Laravel
already resolved `style` to `connects_to_report` for adapter devices (D5).

The runtime ignores a generation lower than the one it holds and applies an equal
one, so a snapshot or message whose content changed without a new generation (pull
request 2, before generations exist) still takes effect. Turning `enabled` off
stops an open episode (`monitoring_disabled`); turning it on restarts monitoring
(waiting for the next packet).

## `internal.control-state.v1` (state snapshot, changed)

Each device entry in `GET /api/internal/devices/state` gains `connectivity`, the same
fields as the control message without `organization_uuid`. The catalogue has no
snapshot entry yet, so this adds `internal.control-state.v1`, describing the snapshot
as it is today plus that field. A runtime that starts or
resynchronises applies any higher generation it finds there.

## `GET /connectivity` (runtime internal HTTP, read by Laravel)

`?organization=<uuid>&devices=<uuid>,…` (≤ 500 devices) returns, per device:

```json
{
  "device_uuid": "…",
  "state": "monitored",
  "monitoring_since": "…",
  "last_heard_at": "…",
  "last_observed_at": "…",
  "anchor_at": "…",
  "reporting_interval_seconds": 62,
  "readings_counted": 64,
  "poll_interval_seconds": 300,
  "offline_after_seconds": 900,
  "offline_after_automatic": true,
  "suppressed_by_gateway": false
}
```

`state` is `waiting`, `learning`, `monitored`, `pending`, `offline`, `recovering`,
`interrupted` or `disabled`. `reporting_interval_seconds` is null until two gaps are
known.

## `device.presence.v1` (changed behaviour, no schema change)

An adapter edge's NDEATH reports each of its devices `unknown` with the diagnostic
"Adapter restarting; waiting for it to reconnect." instead of `offline` (D3). Every
other NDEATH and DDEATH is reported as today. The endpoint is internal (`RuntimeClient`), never exposed publicly; the
portal reads it through the device and profile endpoints in [api.md](api.md).
