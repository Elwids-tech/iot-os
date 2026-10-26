# Events and messaging

Every asynchronous hand-off in the platform: NATS JetStream inside the runtime,
control messages from Laravel to Go, runtime events from Go to Laravel, the
committed telemetry feed, and public integration events. How the pieces connect is
in [ADR-014](../adr/ADR-014-control-plane-data-plane-http-integration.md).

All of these are **at least once**. Every consumer deduplicates by a stable ID and
fences by generation where applicable.

## NATS JetStream

Only the Go runtime connects to NATS; Laravel has no NATS client. Streams are
created at runtime startup ([`internal/app/control.go`](../../services/runtime/internal/app/control.go),
[`internal/app/committed.go`](../../services/runtime/internal/app/committed.go),
[`internal/app/streams.go`](../../services/runtime/internal/app/streams.go)). All use
file storage, limits retention, a **seven-day maximum age** and **discard-new**.

| Stream | Subjects | Carries | Byte limit (code default → Compose/release default) | Env var |
| --- | --- | --- | --- | --- |
| `IOT_DEVICE_CONTROL` | `iot.control.<type>` | Laravel outbox rows claimed by the runtime | 64 MiB → 64 MiB | `IOT_NATS_CONTROL_MAX_BYTES` |
| `IOT_DEVICE_EVENTS` | `iot.runtime.<type>` | Runtime events on their way to Laravel | 256 MiB → 4 GiB | `IOT_NATS_EVENTS_MAX_BYTES` |
| `IOT_DEVICE_TELEMETRY` | `iot.telemetry.>` (published as `iot.telemetry.device`) | Mapped readings before storage ([schema](../../contracts/devices/v1/telemetry.schema.json)) | 768 MiB → 12 GiB | `IOT_NATS_TELEMETRY_MAX_BYTES` |
| `IOT_COMMITTED_TELEMETRY` | `iot.committed.telemetry.v1` | Readings after they are stored | 768 MiB → 4 GiB | `IOT_NATS_COMMITTED_MAX_BYTES` |
| `IOT_DEAD_LETTERS` | `iot.deadletter.<consumer>` | Messages a consumer could not process | | |

Limits accept 1 MiB to 1 TiB. Startup may grow an existing stream's limit but never
shrinks it, changes retention or purges messages. The NATS server store budget is
`IOT_NATS_STORE_MAX_BYTES` (24 GiB in the Devices overlay and release). When a
stream is full, new work stays in the database outboxes; expired history needs
reconciliation ([incident runbook](../ops/incident-runbook.md)).

| Consumer | Stream | Does |
| --- | --- | --- |
| `devices-control` | `IOT_DEVICE_CONTROL` | Applies activations, deactivations, commands and deployments |
| `devices-control-inbox` | `IOT_DEVICE_EVENTS` | POSTs each runtime event to Laravel |
| `devices-storage` | `IOT_DEVICE_TELEMETRY` | Writes observations, latest values, diagnostics and the committed outbox in one transaction |
| `workflow-evaluator-v1` | `IOT_COMMITTED_TELEMETRY` | Evaluates geofence rules and DAGs; state, timers, transitions, intents and checkpoint commit together |
| `committed-demo` (example) | `IOT_COMMITTED_TELEMETRY` | [`cmd/committed-consumer`](../../services/runtime/cmd/committed-consumer), a reference consumer with a file checkpoint |

The first three are push consumers with explicit acknowledgement and one message in
flight. `GET /internal/status` on the runtime reports consumer health and the
`dead_letters` count.

## Control messages (Laravel → Go)

Written to `device_outbox` in the same transaction as the change, claimed by the
runtime over `POST /api/internal/devices/outbox/claim` (30-second lease, 100 rows),
republished to `IOT_DEVICE_CONTROL`, then acknowledged.

| Type | Written by | Runtime action |
| --- | --- | --- |
| `device.activate.v1` | Device activation, rollback, resume ([`DeviceConfigurationService`](../../apps/api/app/Domain/Devices/Services/DeviceConfigurationService.php), [`DeviceLifecycleService`](../../apps/api/app/Domain/Devices/Services/DeviceLifecycleService.php)) | Apply the inline configuration for that generation |
| `device.deactivate.v1` | Deactivation | Close ingestion and dispatch, cancel unsent commands |
| `device.command.v1` | Command confirmation ([`DeviceCommandService`](../../apps/api/app/Domain/Devices/Services/DeviceCommandService.php)) | Dispatch over Sparkplug (NCMD/DCMD) |
| `workflow.deploy.v1` | Geofence rule deployment ([`WorkflowDeploymentService`](../../apps/api/app/Domain/Automation/Services/WorkflowDeploymentService.php)) | Activate or disable a rule execution |
| `workflow.deploy.v2` | DAG deployment ([`DagDeployment`](../../apps/api/app/Domain/Automation/Services/DagDeployment.php)) | Activate or disable a DAG execution |
| `connection.changed.v1` | Broker provisioning | Re-read `GET /api/internal/devices/state` |
| `settings.retention.changed.v1` | Retention change | No-op; retention is read from state |

Contracts, each with a fixture and cases:

- `device.activate.v1`, the whole message with its optional `lease_token`:
  [`devices/v1/activation.schema.json`](../../contracts/devices/v1/activation.schema.json).
- The `device.command.v1` payload, with `generation` and a `session_id` that is
  null when the command check reported no session:
  [`devices/v1/command.schema.json`](../../contracts/devices/v1/command.schema.json).
- Inline definitions: [`device-configuration.v1`](../../contracts/devices/v1/configuration.schema.json)
  and [`device-configuration.v2`](../../contracts/devices/v2/configuration.schema.json),
  with an `adapter` binding for adapter-backed devices.
- Deployments and workflows: [`contracts/rules`](../../contracts/rules).

The other control messages have no contract yet. Laravel's producer test
([`DriftedControlMessageTest`](../../apps/api/tests/Feature/Domain/Devices/Contracts/DriftedControlMessageTest.php))
asserts claimed rows against these schemas, and the runtime's
[`contracts_drift_test.go`](../../services/runtime/internal/app/contracts_drift_test.go)
feeds every example through its decoders.

## Runtime events (Go → Laravel)

Written to `device_runtime.outbox` with the runtime's own state change, relayed to
`IOT_DEVICE_EVENTS`, and POSTed to `/api/internal/devices/events`
([`RuntimeController`](../../apps/api/app/Domain/Devices/Http/Controllers/RuntimeController.php)).
Laravel inserts the event UUID into `device_inbox` (primary key) and ignores
duplicates, then drops events from older generations, operations or sessions.

| Type | Meaning |
| --- | --- |
| `device.applied.v1`, `device.failed.v1`, `device.deactivated.v1` | Outcome of an activation or deactivation for a generation and operation |
| `device.presence.v1`, `gateway.presence.v1`, `connection.presence.v1` | Online/offline/unknown from births, deaths and broker state. `connection.presence.v1` (every gateway and candidate on the connection) is sent only when the broker connection is lost; a rejected packet sends `gateway.presence.v1` and `device.presence.v1` for its own edge node or device. `device.presence.v1` carries `last_seen_at` only when a packet arrived from the device; presence derived from the broker connection omits it, and Laravel keeps the stored value |
| `discovery.birth.v1`, `discovery.presence.v1` | A source announced metrics (new `birth_revision`) or changed presence |
| `command.status.v1` | Command sent, observed, failed, timed out or uncertain |
| `runtime.heartbeat.v1` | Every 10 seconds; presence becomes unknown after 20 seconds without one |
| `retention.cleanup.v1` | Result of a per-organization cleanup pass |
| `workflow.deployment.v1`, `workflow.suspended.v1` | A deployment applied or failed; an execution was suspended (`binding_changed`) |
| `workflow.transition.v1` | Geofence rule `activated` / `cleared` (becomes an alert episode) |
| `workflow.membership.v1` | Geofence `entered` / `exited` |
| `automation.intent.v1` | A DAG action request, re-authorized by `automation-worker` |

Adapter runtimes report separately to `POST /api/internal/adapters/events` with a
per-tenant token ([adapters](../features/adapters.md)).

## Committed telemetry

`telemetry.committed.v1` ([schema](../../contracts/events/v1/telemetry-committed.schema.json),
[fixture](../../contracts/events/v1/telemetry-committed.fixture.json)) is published
on `iot.committed.telemetry.v1` after readings are stored. It is an internal feed
for trusted services (it mixes organizations), not a tenant API.

- Fields: `schema_version`, `event_id` (equals `telemetry_id`), `sequence`
  (decimal string; gaps allowed; not a global order), `organization_uuid`,
  `device_uuid`, `configuration_uuid`, `generation`, and 1–2000 `readings`. A
  reading has `parameter_uuid`, `key`, `data_type`, `unit`, `value`, `quality`
  (`good` = observation, otherwise a stored diagnostic), optional `diagnostic`,
  `observed_at`, `received_at`, `historical` and optional `timestamp_source`.
  Readings of adapter devices also carry `installation_uuid`,
  `adapter_revision_uuid` and `manufacturer_serial`.
- Written to `device_runtime.telemetry_outbox` in the same transaction as the
  readings; rejected configurations, empty packets and rolled-back writes publish
  nothing. A relay publishes up to 100 rows at a time with the event ID as
  `Nats-Msg-Id`, retrying with backoff up to 30 s.
- Per-device order follows acceptance order (single runtime, per-device lock).
  Deduplicate by `event_id`; a crash between broker acceptance and marking the row
  published can redeliver.
- Historical readings carry `historical: true` and must not count as live evidence.
- Backlog: `GET /internal/telemetry/committed-status` (runtime bearer token)
  returns `pending`, `oldest_age_seconds` and `publication_failures_since_start`.
- Example consumer: `go run ./cmd/committed-consumer -durable <name> -state
  <absolute path>/checkpoint.json` from `services/runtime` (also `/committed-consumer`
  in the runtime image). It refuses a changed stream identity, a broker checkpoint
  ahead of its file, missing history and unknown versions rather than resetting.

## Integration events

`integration-event.v1` envelopes in the per-organization journal
(`integration_events`), read through `GET /api/integration/v1/.../events` and
delivered by webhooks ([integrations](../features/integrations.md#event-feed)). The
[public API contract](../../contracts/openapi/openapi.json) describes the envelope,
each type's `data` (`IntegrationEvent`) and the signed delivery
(`webhooks.integrationEvent`).

```ts
{
  id: string;                  // stable UUID across retries and redelivery
  schema_version: "integration-event.v1";
  type: string;                // see below
  occurred_at: string;         // source transition time
  recorded_at: string;         // journal write time, not commit time
  data: object;                // snapshot at the time of the event
}
```

| Type | Written by | `data` |
| --- | --- | --- |
| `alert.activated.v1`, `alert.cleared.v1`, `alert.acknowledged.v1` | [`AlertProjector`](../../apps/api/app/Domain/Automation/Services/AlertProjector.php), acknowledgement | Alert snapshot: `uuid`, `episode`, `condition`, `activated_at`, `cleared_at`, `acknowledged_at`, `workflow_uuid`, `workflow_name`, `device_uuid`, `execution_stopped_reason` |
| `geofence.entered.v1`, `geofence.exited.v1` | Geofence membership transitions ([`GeofenceEventJournal`](../../apps/api/app/Domain/Geospatial/Services/GeofenceEventJournal.php)) | `uuid`, `geofence_uuid`, `geofence_name`, `assignment_uuid`, `device_uuid`, `type`, `source_event_uuid`, `occurred_at` |
| `geofence.wandering_started.v1`, `geofence.wandering_resolved.v1` | Geofence rule activated / cleared | Same as above |
| `automation.triggered.v1` | DAG `action.event.v1` ([`DagActions`](../../apps/api/app/Domain/Automation/Services/DagActions.php)) | `workflow_uuid`, `action_id`, `name`, `node_id` |

Journal order is commit order, not event time: apply `data` as the authoritative
snapshot. Comments, people, email deliveries and private configuration are never
included.
