# ADR-014: Control Plane and Data Plane Integrate over Internal HTTP

**Status:** Accepted (recorded retroactively)
**Date:** 2026-10-11; built during Devices v1, September 2026
**Relates to:** [ADR-002](ADR-002-laravel-control-plane.md), [ADR-003](ADR-003-go-data-plane.md)

## Context

The original plan had Laravel publish versioned activation events to NATS
JetStream from a transactional outbox, with Go fetching immutable artifacts by
URI and hash ([archived draft](../archive/2026-10/plan/contracts/definition-activation.md)).
What was built keeps the outbox and the "Laravel owns intent, Go executes" split,
but connects the two processes over private HTTP instead.

## Decision

Laravel has no NATS client (no NATS package in
[`apps/api/composer.json`](../../apps/api/composer.json); it only scrapes the NATS
HTTP monitoring endpoint for metrics). All Laravel-to-Go and Go-to-Laravel traffic
is internal HTTP authenticated with the shared `DEVICE_RUNTIME_TOKEN` bearer
(at least 32 characters, constant-time compare).

**Laravel to Go (intent).**
- Domain services write rows to `device_outbox` in the same transaction as the
  state change ([`DeviceAudit::enqueue`](../../apps/api/app/Domain/Devices/Services/DeviceAudit.php)).
  Types: `device.activate.v1`, `device.deactivate.v1`, `device.command.v1`,
  `workflow.deploy.v1` (geofence rules), `workflow.deploy.v2` (DAGs),
  `connection.changed.v1`, `settings.retention.changed.v1`.
- Go polls `POST /api/internal/devices/outbox/claim` every second. Laravel leases
  up to 100 unpublished rows for **30 seconds** each. Go republishes each row to
  its own JetStream stream `IOT_DEVICE_CONTROL` (`iot.control.<type>`, row UUID as
  `Nats-Msg-Id`) and then calls `POST /api/internal/devices/outbox/{uuid}/ack`
  with the lease token. A stale lease returns 409
  ([`RuntimeController`](../../apps/api/app/Domain/Devices/Http/Controllers/RuntimeController.php),
  [`control.go`](../../services/runtime/internal/app/control.go)).
- Definitions travel **inline**. A device configuration carries the compiled
  profile (`profile_canonical_json`, `profile_hash`), and Go checks the hash before
  use ([`devices/profile.go`](../../services/runtime/internal/devices/profile.go)).
  Workflow deployments carry their immutable snapshot.
- Go also fetches `GET /api/internal/devices/state` at startup, every 30 seconds
  and on `connection.changed.v1`. It returns every ready broker connection and
  every non-archived device in **all organizations** with desired and applied
  configuration. Go uses it to connect new broker connections and to replay
  pending device operations.

**Go to Laravel (observed state).**
- Go writes runtime events to `device_runtime.outbox` in the same transaction as
  its own state change, relays them to JetStream `IOT_DEVICE_EVENTS`
  (`iot.runtime.<type>`), and a durable consumer POSTs each one to
  `POST /api/internal/devices/events`.
- Laravel deduplicates on the event UUID with `device_inbox` (UUID primary key,
  `insertOrIgnore`) and drops stale events by generation, operation and session.
  Types include device applied/failed/deactivated, presence, discovery birth,
  command status, heartbeat, retention cleanup, workflow
  deployment/transition/membership/suspension and `automation.intent.v1`
  ([events reference](../reference/events.md#runtime-events-go-to-laravel)).

**Laravel queries Go.** Reads that need runtime data (latest values, history,
telemetry captures, validation, workflow compile/simulate, execution timelines)
go to the runtime's `/internal/*` HTTP API through
[`RuntimeClient`](../../apps/api/app/Domain/Devices/Services/RuntimeClient.php).

**JetStream is internal to Go.** All four streams are created and consumed by the
runtime: `IOT_DEVICE_CONTROL` and `IOT_DEVICE_EVENTS` buffer the HTTP hand-offs
above; `IOT_DEVICE_TELEMETRY` and `IOT_COMMITTED_TELEMETRY` connect its ingestion,
storage and evaluation stages ([events reference](../reference/events.md#nats-jetstream)).

## Differences from the planned definition-activation contract

- There is no `definition.activated.v1` envelope on the wire.
  [`PublishDeviceProfile`](../../apps/api/app/Domain/DeviceProfiles/Actions/PublishDeviceProfile.php)
  still writes rows shaped like it to `device_profile_activation_outbox`, but
  nothing consumes them.
- There is no artifact URI or object-store fetch; payloads are inline.
- Activation is acknowledged per device or per workflow deployment through runtime
  events, not per definition.

## Consequences

- Laravel can be offline briefly without stopping ingestion; Go retries claims
  and keeps its own outbox until Laravel accepts events.
- Delivery is at least once in both directions; both sides are idempotent on
  UUIDs and fence by generation.
- Go acknowledges an outbox row once it is in JetStream, before it is processed.
  The control consumer handles one message at a time, so an unknown control type
  blocks the stream until fixed.
- Known scaling limits, recorded as follow-up work in the
  [roadmap](../roadmap.md#next):
  - The 30-second state poll loads every connection, device and configuration
    across all organizations, with per-row queries, and Go caps the response at
    32 MiB with a 10 s timeout. Its cost grows with the whole fleet.
  - The claim loop moves at most about 100 control rows per second.
  - Nothing prunes `device_outbox`, `device_inbox` or `device_runtime.outbox`.
  - One runtime instance only, enforced by a Postgres advisory lock.
- The boundary leaks in two places: Laravel reads `device_runtime.*` tables for
  operations metrics and writes `device_runtime.commands` during restore
  quarantine.
