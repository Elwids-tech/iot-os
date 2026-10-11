# Research: Canonical Telemetry and Internal Event Contracts

**Feature**: [spec.md](spec.md) | **Date**: 2026-10-11 | **Baseline**: `main` at `4f854bf`

A factual inventory of how telemetry enters the platform today and how the control
plane (Laravel, `apps/api`) and the runtime (Go, `services/runtime`) exchange
messages, with the existing contracts, the archived original design, the gaps
between them, and what the later specs will need. Paths are relative to the
repository root and line numbers refer to the baseline commit. Technology options
for the plan step are in section 8; nothing here is a decision.

## 1. Key findings

1. **Correction to the feature description.** The per-tenant Mosquitto broker is the
   vendor-facing *ingress* broker. The adapter's re-encoded Sparkplug goes to the
   **shared platform broker** (`apps/api/app/Domain/DeviceAdapters/Services/AdapterService.php:185`,
   `apps/api/config/devices.php:9`, `services/adapters/nodes/adapter.js:164-167`). The
   runtime never connects to tenant brokers; it connects only to `SparkplugConnection`
   rows, all carrying `config('devices.broker_url')`
   (`apps/api/app/Domain/Devices/Http/Controllers/RuntimeController.php:43-46`). Laravel
   pushes to the adapter manager; the manager does not poll
   (`apps/api/app/Domain/DeviceAdapters/Jobs/DeployAdapter.php:23-44`).
2. **The published contracts already disagree with what is sent**, and nothing catches
   it, because PHP and Go tests compare against fixtures rather than validating against
   the schemas, and the Python checker validates only fixtures (section 5.3). Four
   cases: committed telemetry provenance fields, the internal telemetry message, the
   activation payload, and the command payload; plus the adapter binding inside device
   configurations.
3. **Neither PHP nor Go has a JSON Schema validator.** `services/runtime/go.mod` and
   `apps/api/composer.json` have no schema library; only `tooling/verify-devices-contracts.py`
   (Python `jsonschema==4.26.0`, `tooling/simulators/requirements.txt`) validates, in the
   CI `tooling` job (`.github/workflows/ci.yml:214`).
4. **Type-level version refusal already exists at runtime on both sides.** Go
   dead-letters an unknown control type (`services/runtime/internal/app/application.go:644`);
   Laravel refuses an unknown runtime event type with 422 (`RuntimeController.php:93-95`),
   which Go classifies as permanent and dead-letters
   (`services/runtime/internal/app/deadletter.go:53-81`). Payload content is not
   validated: Laravel checks only `payload` is an array, so a missing key becomes a 500
   that Go retries forever with one message in flight, blocking every later runtime
   event including heartbeats (`RuntimeController.php:93-95`, `services/runtime/internal/app/control.go:197-199`).
5. **Unknown-field policy is inconsistent.** Every schema in `contracts/` is closed
   (`additionalProperties: false`), but the runtime's control decoder ignores unknown
   fields (`services/runtime/internal/storage/store.go:120-124`, no
   `DisallowUnknownFields`), while some nested decoders are strict
   (`services/runtime/internal/devices/conversion.go:21`, `services/runtime/internal/rules/workflow.go:46`,
   `services/runtime/internal/app/dag.go:22,43`). Laravel reads arrays and ignores extras.
   `contracts/README.md:25-27` promises additive changes within a major version, which
   closed schemas cannot honour.
6. **The adapter path loses information the envelope must carry**: adapter receipt
   time (merged into the source timestamp), the decoder's `messageId`, units, quality,
   historical flag, and the raw topic (section 2.3).
7. **The data model past the decoder is Sparkplug-shaped**: device configuration
   `source` is group/edge/device (`services/runtime/internal/devices/types.go:8-14`),
   mappings use Sparkplug metric names and datatype names (`types.go:18-26`,
   `services/runtime/internal/devices/profile.go:100-103`). A canonical envelope needs a
   protocol-neutral source address and mapping, which the ingestion spec must add.
8. **Deduplication is weaker than the constitution implies.** The ingest telemetry UUID
   is random per packet (`application.go:441`), Sparkplug subscriptions are QoS 0 with
   clean sessions (`application.go:203-222`), a failed JetStream hand-off is not retried
   (`application.go:449-456`), and only good, source-timestamped readings are
   content-deduplicated (`services/runtime/internal/storage/store.go:263-274`).
   `ReplayOutcome` re-emits stored outcomes under a new event UUID, so the inbox cannot
   recognise them (`store.go:1124-1146`).

## 2. Telemetry ingestion today

### 2.1 Native Sparkplug B path (runtime)

| Aspect | Behaviour | Evidence |
| --- | --- | --- |
| Broker connections | One paho client per ready connection from `/state`; TLS only; client ID = `host_id`; clean session; added but never updated or removed | `application.go:165-179`, `195-252` |
| Subscriptions | `spBv1.0/STATE/<host>` QoS 1; `spBv1.0/<group>/{N,D}{BIRTH,DATA,DEATH}/...` **QoS 0** | `application.go:215-222` |
| Tenant identity | From the connection configuration; a topic whose group differs from the connection's `group_id` is dropped | `application.go:276-280` |
| Device identity | Active definition whose `source.connection_uuid`, `edge_node_id`, `device_id` match the topic | `application.go:358-363` |
| Org cross-check | Definition organization is not compared with the connection organization on the packet path (only when starting a capture) | `services/runtime/internal/app/telemetry.go:37-40` |
| Session engine | NBIRTH needs `seq=0` and Int64 `bdSeq`; data needs the next `seq` mod 256; repeat `seq` is a duplicate; gap marks node offline and requests rebirth; aliases resolve via birth; datatype changes require rebirth | `services/runtime/internal/sparkplug/session.go:87-237` (`108-131`, `156-166`, `204-222`) |
| Rejection blast radius | Any rejected packet sets presence `unknown` for every device on the connection and requests a rebirth (30 s throttle) | `application.go:323-328`, `482-496`, `259-274` |
| Value decoding | Integers as JSON numbers; >2^53, NaN/Inf, out-of-range unsigned → `nil` + diagnostic; DataSet/Template kept as base64 + diagnostic | `session.go:239-340` |
| Time | `received` = MQTT callback time; metric timestamp, else payload timestamp; reading `timestamp_source` = `source`/`receipt`; >5 min future → `corrected_future`; no lower bound | `application.go:276`, `session.go:224,258-265`, `profile.go:145-160` |
| Quality | Sparkplug quality properties ignored; readings are `good` or `invalid`; `stale` only at read time | `session.go:250-255`, `profile.go:151,211-215`, `services/runtime/internal/app/http.go:156-158` |
| Units | Always the profile parameter unit; Sparkplug `engUnit` not read; `contracts/units/v1/units.json` not referenced by Go | `profile.go:151`, `services/runtime/internal/devices/conversion.go:38-40` |
| Adapter provenance | Read from metric properties `installation_uuid`, `adapter_revision_uuid`; mismatch with enrollment → invalid; revision only checked for UUID shape | `session.go:241-257`, `profile.go:163-171`, `services/runtime/internal/devices/adapter.go:5-12` |
| Hand-off | `devices.Telemetry` (random UUID, full definition incl. `profile_canonical_json`) published to `iot.telemetry.device`; failure is not retried | `application.go:438-458`, `types.go:169-176` |
| Storage | `devices-storage` re-checks fences, writes `telemetry_outbox` (dedup ledger, `ON CONFLICT(telemetry_uuid)`), observations or diagnostics, `latest`, in one transaction | `control.go:166-193`, `store.go:226-294` |
| Committed feed | Relay publishes `telemetry.committed.v1` with `Nats-Msg-Id = event_id` | `services/runtime/internal/app/committed.go:33-84` |

### 2.2 Vendor adapter path

```text
vendor device ──▶ tenant ingress Mosquitto (per org, TLS port) ─┐
vendor broker  ────────────────────────────────────────────────┤
                                                                ▼
                     tenant Node-RED: decoder node (QuickJS) ──▶ managed Sparkplug publisher
                                                                ▼
              shared platform broker  spBv1.0/adapters-<org>/…/adapter-<adapter>/src-<hash>
                                                                ▼
                         runtime (ordinary Sparkplug connection, section 2.1)
```

- **adapter-manager** (`services/adapters/manager.cjs`) runs two containers per tenant
  through the Docker socket: Mosquitto 2.0.22 ingress with TLS, Dynamic Security and
  default-deny ACLs (`manager.cjs:278-315`), and Node-RED with no host port and
  `--cap-drop ALL` (`manager.cjs:328-355`). Private HTTP API with bearer
  `IOT_ADAPTER_MANAGER_TOKEN` (`manager.cjs:645-693`); no tenant deprovisioning.
- **Tenant identity** travels in each manager request body from Laravel
  (`AdapterService.php:130-133`); the runtime's reporter calls back with
  `X-Adapter-Tenant` and a per-tenant bearer (`services/adapters/nodes/adapter.js:371-377`,
  `apps/api/app/Domain/DeviceAdapters/Http/Controllers/AdapterController.php:228-256`).
- **Decoder sandbox**: fresh worker and QuickJS context per message, 100 ms, 16 MiB,
  500 ms deadline, 1 MiB raw input, 64,000-character decoder
  (`services/adapters/lib/decoder.cjs:10,27-51`, `services/adapters/lib/decoder-worker.cjs:5-27`).
- **Decoder input**: `{payload, bytes, payloadBase64, topic, receivedAt, retained, qos}`
  (`decoder.cjs:15-23`).
- **Decoder output** (`decoder.cjs:70-145`): `sourceDeviceId` (≤128), `metrics[1..2000]`
  each `{name: <profile parameter key>, value, unit?}` with unit equal to the profile
  unit, optional `observedAt` (not >5 min ahead), optional `messageId` (≤128). Only
  number, integer, boolean and string parameters; null rejected; one bad metric rejects
  the whole message.
- **Managed publisher mapping** (`adapter.js:250-311`, `services/adapters/lib/sparkplug.cjs:2-35`):

| Decoder / input | Sparkplug | Notes |
| --- | --- | --- |
| `sourceDeviceId` | device id `src-` + sha256[:32]; binding lookup | `adapter.js:252-261` |
| `metrics[].name` | `Metric.name` (no aliases) | `sparkplug.cjs:11` |
| profile `data_type` | Double / Int64 / Boolean / String | `decoder.cjs:118-123` |
| `observedAt`, else `receivedAt` | `Metric.timestamp`, one value for all metrics | `adapter.js:268-273` |
| Laravel binding | metric properties `installation_uuid`, `adapter_revision_uuid` | `adapter.js:259-267`, `sparkplug.cjs:22-29` |
| — | `Payload.timestamp = Date.now()`, `seq` | `sparkplug.cjs:32-35` |
| `unit`, `parameter_uuid`, `messageId`, `topic`, `qos` | **not encoded**; `messageId` only for an in-memory dedup map (10k, cleared on redeploy) | `adapter.js:284-290` |

- Group `adapters-<org uuid>`, edge node `adapter-<adapter uuid>`; `bdSeq` persisted in
  `/data`; DBIRTH on first sight or metric-set change; DDATA only for bound sources;
  **no DDEATH**; retained or offline-upstream messages are preview-only and dropped
  (`adapter.js:150-238`, `274-311`). The inline proto schema in `sparkplug.cjs` is not
  the pinned `contracts/sparkplug/sparkplug_b.proto`.
- **Laravel** owns adapters, revisions (`definition{name, code, fixtures, source,
  artifact_uuid, profile_hash}`, `content_hash`; immutable by convention only),
  installations and deployments
  (`apps/api/database/migrations/2026_10_07_010000_create_device_adapters.php:11-121`,
  `AdapterService.php:102-104,143,192-260`). Activating an adapter device writes a
  native device configuration with an `adapter` binding
  (`apps/api/app/Domain/Devices/Services/DeviceConfigurationService.php:121-127`).
- **Tests**: decoder and flow unit tests (`services/adapters/test/*.test.cjs`); a live
  integration test bypasses `manager.cjs` and feeds captured packets to Go
  (`services/adapters/integration/verify.cjs:313-415`,
  `services/runtime/internal/sparkplug/adapter_capture_test.go:13-63`); Laravel fakes
  manager calls (`apps/api/tests/Feature/Domain/Devices/DeviceAdapterTest.php:51-60`).
  `manager.cjs` and the publisher's seq/bdSeq logic have no unit tests.

### 2.3 Information the envelope must preserve

| Information | Native Sparkplug today | Adapter path today | Envelope need (spec FR) |
| --- | --- | --- | --- |
| Tenant | Connection configuration | Connection (`adapters-<org>`), plus manager tenant | Trusted context (FR-003) |
| Source address | group / edge / device | `sourceDeviceId` hashed into `src-…` | Protocol-neutral source address (FR-004) |
| Provenance | — | Metric properties | Typed provenance (FR-005) |
| Received time | MQTT callback | Adapter `receivedAt` lost; runtime receipt only | Received time at trusted ingress (FR-006) |
| Observed time | Metric or payload timestamp, both labelled `source` | `observedAt` or adapter receipt, always labelled `source` | Optional observed time plus time source (FR-006) |
| Quality | Ignored | None; whole message rejected | Per-value quality (FR-008) |
| Unit | Profile unit | Must equal profile; dropped | Optional source unit (FR-009) |
| Historical | `is_historical` | Never set | Historical flag (FR-010) |
| Several samples per parameter | Allowed (historical) | Names must be unique | Allowed with distinct times (FR-011) |
| Dedup identity | `seq` per session; random telemetry UUID | `messageId` in memory only | Stable message identity (FR-012) |
| Raw evidence | Captures only | Latest preview on candidate | Optional raw reference (FR-005) |
| Lifecycle | Births, deaths, presence | Generated births, no DDEATH | FR-017 (open) |

## 3. Runtime-internal messaging (NATS JetStream)

Laravel has no NATS client (ADR-014). All streams use file storage, limits retention,
seven-day max age and discard-new, except dead letters (30 days, discard-old). No
stream sets a duplicate window, so the server default applies, and `ensureStream`
does not check it (`services/runtime/internal/app/streams.go:25-48`).

| Stream | Subject | Published by (`Nats-Msg-Id`) | Payload type | Consumer | Evidence |
| --- | --- | --- | --- | --- | --- |
| `IOT_DEVICE_CONTROL` | `iot.control.<type>` | Claim relay (outbox row UUID) | `devices.Event` | `devices-control` → `handleControl` | `control.go:66-87`, `135-158` |
| `IOT_DEVICE_EVENTS` | `iot.runtime.<type>` | Runtime outbox relay (event UUID) | `devices.Event` | `devices-control-inbox` → `POST /events` | `control.go:89-116`, `159-165` |
| `IOT_DEVICE_TELEMETRY` | `iot.telemetry.device` | Ingest (random telemetry UUID) | `devices.Telemetry` | `devices-storage` | `application.go:441-447`, `control.go:166-193` |
| `IOT_COMMITTED_TELEMETRY` | `iot.committed.telemetry.v1` | Committed relay (`event_id`) | `devices.CommittedTelemetry` | `workflow-evaluator-v1` (pull), example `committed-demo` | `app/committed.go:13-29,70-74`, `rule_consumer.go:24-35` |
| `IOT_DEAD_LETTERS` | `iot.deadletter.<consumer>` | `settle` (`consumer:stream:seq`) | original bytes + headers | none | `deadletter.go:24-37`, `102-146` |

- Push consumers: durable, explicit ack, `MaxAckPending(1)`, deliver all
  (`control.go:197-199`). Permanent errors are dead-lettered; transient ones back off
  3 s doubling to 60 s (`deadletter.go:84-90,123-146`).
- **Types** (`services/runtime/internal/devices/types.go`): `Event{uuid, type,
  payload (raw), lease_token?}` with no schema version (`:134-139`); `Telemetry{capture_id?,
  generation, uuid, definition, session_id, readings}` with no schema version
  (`:169-176`); `Reading` adds `label`, `last_valid_received_at`, `counter_event` and
  provenance (`:115-133`); `ControlState{connections, devices, retention}` (`:164-168`).
  `CommittedTelemetry` has `schema_version` (`devices/committed.go:28-38`).
- **`map[string]any`**: every runtime event payload except `automation.intent.v1`
  (typed `dag.Intent`, `services/runtime/internal/dag/types.go:96-110`) and the nested
  geofence `rules.Transition` (`services/runtime/internal/rules/evaluator.go:109-123`);
  `ReplayOutcome` decodes and re-emits a map (`store.go:1138-1145`).

## 4. Internal control-plane ↔ runtime protocol

Short Laravel class names below resolve to: `apps/api/app/Domain/Devices/Http/Controllers/RuntimeController.php`;
`apps/api/app/Domain/Devices/Services/{DeviceAudit,DeviceConfigurationService,DeviceLifecycleService,DeviceCommandService,BrokerProvisioner,RetentionService,RuntimeLedgers,RuntimeClient}.php`;
`apps/api/app/Domain/Devices/Models/SparkplugConnection.php`;
`apps/api/app/Domain/Automation/Services/{WorkflowDeploymentService,DagDeployment,DagActions,AlertProjector}.php`;
`apps/api/app/Domain/Geospatial/Services/GeofenceEventJournal.php`. Short Go file names
resolve under `services/runtime/internal/` (`app/`, `storage/`, `devices/`).

### 4.1 Transport

Routes under `/api/internal/devices` with `AuthenticateDeviceRuntime`
(`apps/api/app/Domain/Devices/routes/api.php:76-82`): bearer `DEVICE_RUNTIME_TOKEN`,
≥32 characters, `hash_equals`, 401 on failure
(`apps/api/app/Domain/Devices/Http/Middleware/AuthenticateDeviceRuntime.php:14-15`). No
form requests; validation is inline in `RuntimeController`. Go client: 10 s timeout,
non-2xx → `controlStatusError`, responses read up to 32 MiB with `UseNumber`
(`control.go:18-54`). The same token protects the runtime's `/internal/*` API
(`http.go:87-94`).

### 4.2 Endpoints

| Endpoint | Request | Response | Outcomes | Evidence |
| --- | --- | --- | --- | --- |
| `GET /state` | — | `{connections[], devices[], retention[]}` | 200 | `RuntimeController.php:31-56` |
| `POST /outbox/claim` | body ignored (Go sends `{}`) | `{data: [{uuid, type, payload, lease_token}]}`; 100 rows, 30 s lease, `orderBy('id')`, `lockForUpdate` | 200 | `RuntimeController.php:58-69`, `control.go:69` |
| `POST /outbox/{uuid}/ack` | `{lease_token: uuid}` | `{ok: true}` (idempotent if already published) | 409 stale lease, 404, 422 | `RuntimeController.php:71-82` |
| `POST /automation-command-check` | `{action_id: 64 chars, command_uuid}` | `{allowed: bool}` | 422 | `RuntimeController.php:84-89` |
| `POST /events` | `{uuid, type ∈ 16 types, payload: array}` | `{ok: true}` + `duplicate` / `stale` / `ignored: 'unknown_reference'` | 409, 422, 404 (`firstOrFail`), 500 (missing keys) | `RuntimeController.php:91-265` |

### 4.3 Control messages (Laravel → Go)

All written by `DeviceAudit::enqueue` into `device_outbox` in the same transaction
(`apps/api/app/Domain/Devices/Services/DeviceAudit.php:21-24`; table in
`apps/api/database/migrations/2026_09_06_000000_create_devices_domain.php:115-125`).
Pruned after 8 days (`RuntimeLedgers.php:27`). Go acknowledges once the row is in
JetStream, before processing (`control.go:80-86`).

| Type | Producer | Payload sent | Go consumer | Existing contract |
| --- | --- | --- | --- | --- |
| `device.activate.v1` | `DeviceConfigurationService.php:175-176`; `DeviceLifecycleService.php:43-48` | `organization_uuid, device_uuid, generation, operation_uuid, definition` | `application.go:622-631` (reads definition, generation, operation_uuid) | `contracts/devices/v1/activation.schema.json` (drifted) |
| `device.deactivate.v1` | `DeviceConfigurationService.php:190-191`; `DeviceLifecycleService.php:43-48` | `organization_uuid, device_uuid, generation, operation_uuid` | `application.go:632-642` | none |
| `device.command.v1` | `DeviceCommandService.php:105-108` | `command_uuid, generation, organization_uuid, device_uuid, configuration_uuid, parameter_uuid, value, confirmed_at, expires_at, session_id (nullable), automation_action_id?` | `application.go:616-621` → `commands.go:71-90` | `contracts/devices/v1/command.schema.json` (drifted) |
| `workflow.deploy.v1` | `WorkflowDeploymentService.php:51` | `operation_uuid, rule_uuid, organization_uuid, generation, target, definition` | `application.go:606-611` → `rules.Deployment` | `contracts/rules/v1/deployment.schema.json` |
| `workflow.deploy.v2` | `DagDeployment.php:65` | same six keys, DAG definition | `application.go:600-605` → `storage.DAGDeployment` (`storage/dag.go:15-22`) | definition only: `contracts/rules/v2/workflow.schema.json` |
| `connection.changed.v1` | `BrokerProvisioner.php:62` | `connection_uuid` | `application.go:612-613` → `syncState()` (payload ignored) | none |
| `settings.retention.changed.v1` | `RetentionService.php:54` | `scope, revision` | `application.go:614-615` (no-op) | none |
| other | — | — | `application.go:644` → permanent → dead letter | — |

### 4.4 Runtime events (Go → Laravel), 16 types

Written by `event()` into `device_runtime.outbox` as `devices.Event{UUID: new, Type,
Payload}` (`store.go:127-139`), relayed (`control.go:89-116`) and POSTed. Laravel
inserts the UUID into `device_inbox` with `insertOrIgnore` inside the handler's
transaction (`RuntimeController.php:97-100`), pruned after 8 days. The envelope has no
`occurred_at`, contract version or generation; the id field is `uuid`.

| Type | Go emitter | Payload | Laravel handler |
| --- | --- | --- | --- |
| `connection.presence.v1` | `application.go:483` (always `unknown`) | connection_uuid, presence, diagnostic | `RuntimeController.php:118-127` |
| `discovery.presence.v1` | `application.go:344` | connection_uuid, edge_node_id, device_id, session_id, received_at, presence | `:128-140` (session fence) |
| `discovery.birth.v1` | `application.go:347` | as above + `metrics[]` | `:150-156`, `:165-179` |
| `gateway.presence.v1` | `application.go:352` (NDEATH only, `offline`) | connection_uuid, edge_node_id, session_id, presence, last_seen_at | `:150-164` |
| `device.presence.v1` | `application.go:480` | organization_uuid, device_uuid, configuration_uuid, generation, presence, diagnostic, last_seen_at | `:183-186`, `:200-210` (generation and configuration fences) |
| `device.applied.v1` | `store.go:202-214`; replay `store.go:1145` | device_uuid, organization_uuid, configuration_uuid, generation, presence, operation_uuid | `:211-233`, `:246-248` |
| `device.failed.v1` | `store.go:1107-1119` | device_uuid, organization_uuid, generation, configuration_uuid, diagnostic, operation_uuid | `:211-230`, `:243-246` |
| `device.deactivated.v1` | `store.go:202-214` | as applied + uncertain_command_uuids | `:211-242` |
| `command.status.v1` | `store.go:1038` | organization_uuid, device_uuid, command_uuid, status, diagnostic, sent_at | `:187-199` |
| `runtime.heartbeat.v1` | `application.go:668` (10 s) | at | `:112-117` (fleet-wide update) |
| `retention.cleanup.v1` | `application.go:717` | organization_uuid, status, deleted_rows, diagnostic | `:141-149` |
| `workflow.deployment.v1` | `storage/rules.go:93`, `storage/dag.go:159` | operation_uuid, rule_uuid, organization_uuid, generation, target, status, diagnostic | `WorkflowDeploymentService.php:99-116` |
| `workflow.suspended.v1` | `rules.go:286`, `dag.go:232` | operation_uuid, rule_uuid, organization_uuid, reason | `WorkflowDeploymentService.php:91-98` (reason ignored) |
| `workflow.transition.v1` | `rules.go:328` | operation_uuid, rule_uuid, organization_uuid, transition | `WorkflowDeploymentService.php:81-89`, `AlertProjector.php:19-31`, `GeofenceEventJournal.php:16-39` |
| `workflow.membership.v1` | `rules.go:340` | as transition (entered/exited) | `WorkflowDeploymentService.php:66-79` |
| `automation.intent.v1` | `dag.go:256` (`dag.Intent`) | id, workflow_uuid, operation_uuid, organization_uuid, node_id, correlation_key, kind, trigger, occurred_at, expires_at, config, episode, transition? | `DagActions.php:26-35` |

Laravel-side handlers are in `apps/api/app/Domain/Devices/Http/Controllers/` and
`apps/api/app/Domain/Automation/Services/`. Only `workflow.*` and
`automation.intent.v1` have nested validation (`WorkflowDeploymentService.php:62-99`,
`DagActions.php:28`). The nested geofence transition matches the existing
`rule-transition.v1` contract (`contracts/rules/v1/transition.schema.json`).

### 4.5 Reconciliation snapshot (`GET /state`)

- `connections`: ready `SparkplugConnection` rows across **all organizations** with
  decrypted `password` (`RuntimeController.php:43-46`, `SparkplugConnection.php:17`).
- `devices`: every non-archived device across all organizations with `uuid,
  organization_uuid, generation, operation_uuid, lifecycle, deployment_status, desired,
  applied` (full definitions including `profile_canonical_json`) (`:47-52`).
- `retention`: per organization, `RetentionService::effective()` (`:54`,
  `RetentionService.php:24-36`).
- No version, generation or ETag. Device queries are fixed; retention costs two queries
  per organization. Go reads only some fields; `DeviceState.review_required` is declared
  but never sent (`types.go:149-163`). Fetched at startup (fatal on failure), every 30 s
  and on `connection.changed.v1` (`application.go:136,165-194,646-674`); `syncState`
  only adds connections and replays pending devices.

### 4.6 Other internal interfaces (proposed out of scope)

- Laravel → runtime `/internal/*` reads and tools through `RuntimeClient`
  (`apps/api/app/Domain/Devices/Services/RuntimeClient.php:20-38`; routes
  `services/runtime/internal/app/http.go:34-86`): captures, validate, command-check,
  measurements (latest, history, records, state-history, increase), locations, rules and
  DAG compile/simulate/execution/timeline, status.
- `POST /api/internal/adapters/events` (adapter runtimes, per-tenant token) and the
  adapter manager's private API (`manager.cjs:563-693`).
- `/api/internal/notifications/*` (`apps/api/app/Domain/Notifications/routes.php:12-16`).

## 5. Existing contracts

### 5.1 Inventory

| Contract | Version id | Validated by script | Read by Go tests | Read by PHP tests |
| --- | --- | --- | --- | --- |
| `devices/v1/activation` | type `device.activate.v1` (no `$id`) | yes | — | — |
| `devices/v1/command` | none | yes | — | — |
| `devices/v1/configuration` | `device-configuration.v1` | yes | `devices/contracts_test.go:37` | — |
| `devices/v1/telemetry` (internal `iot.telemetry.device`) | none | yes | `devices/committed_test.go:11` | — |
| `devices/v1/expressions.fixture` | no schema | no | `devices/contracts_test.go:11` | `DeviceExpressionContractTest.php:14` |
| `devices/v2/configuration` | `device-configuration.v2` | yes | — | — |
| `devices/v2/conversions.fixture` | no schema | no | `devices/conversion_test.go:14` | `IngressConversionTest.php:15` |
| `events/v1/telemetry-committed` | `telemetry.committed.v1` | yes, plus negative checks | `devices/committed_test.go:26` | — |
| `rules/v1/*`, `rules/v2/workflow` | `geofence-rule.v1`, `rule-transition.v1`, `automation-workflow.v1/v2`, … | yes (except `simulation.expected.json`) | `rules/*_test.go`, `app/rules_test.go`, `app/workflows_test.go` | `WorkflowTest.php:42` |
| `location/v1/*` | `location-binding.v1`, `location-fix.v1`, `location-scenarios.v1` | yes | `location/location_test.go:29,74` | — |
| `sparkplug/*` | pinned Tahu proto (sha256) | proto hash only | `sparkplug/session_test.go:16` | — |
| `definitions/device-profiles/*` | `device-profile.v1` | no | `devices/profile_test.go:15,102` | `DeviceProfileDomainTest.php:147,162` |

### 5.2 How they are enforced

- `tooling/verify-devices-contracts.py` checks each schema is valid Draft 2020-12 and each
  fixture validates (`:13-53`), plus three negative checks for the committed event
  (`:32-35`), the profile hash (`:54-55`), command expiry (`:56-57`) and the proto hash
  (`:58-59`). It hard-codes the directories it scans, so a new contract directory needs a
  script change. CI runs it in the `tooling` job (`.github/workflows/ci.yml:214`).
- Go and PHP tests read fixtures and assert behaviour or equality
  (`services/runtime/internal/devices/committed_test.go:10-40` compares a projection with
  the fixture), but never validate produced output against a schema. No test asserts
  that a consumer refuses an unsupported version.
- `docs/dev/testing.md:18` says the script validates "every contract fixture"; fixtures
  without a schema (expressions, conversions, `simulation.expected.json`) are not.

### 5.3 Drift between contracts and code

| Contract | Contract says | Code sends | Evidence |
| --- | --- | --- | --- |
| `telemetry.committed.v1` reading | closed, no provenance | `installation_uuid`, `adapter_revision_uuid`, `manufacturer_serial` when set | `contracts/events/v1/telemetry-committed.schema.json:118`; `services/runtime/internal/devices/committed.go:11-26,49` |
| `devices/v1/telemetry` | closed; no `generation` | always `generation`; `capture_id`, provenance, `counter_event`, `last_valid_received_at` when set | `contracts/devices/v1/telemetry.schema.json:101,111`; `types.go:115-133,169-176` |
| `device.activate.v1` payload | `{generation, definition}` only, closed | adds `organization_uuid`, `device_uuid`, `operation_uuid`; envelope has `lease_token` | `contracts/devices/v1/activation.schema.json:12-42`; `DeviceConfigurationService.php:175-176` |
| `device.command.v1` | no `generation`; `session_id` non-empty | `generation` (required by Go); `session_id` may be null | `contracts/devices/v1/command.schema.json:5-61`; `DeviceCommandService.php:105-108`; `commands.go:84-88` |
| `device-configuration.v1/v2` | closed; no `adapter` | `adapter {installation_uuid, adapter_uuid, manufacturer_serial}` for adapter devices | `contracts/devices/v1/configuration.schema.json:124`, `contracts/devices/v2/configuration.schema.json:136`; `DeviceConfigurationService.php:123-127`; `types.go:27-46` |

`docs/reference/events.md:61-63` points to these schemas as the payload contracts.

## 6. The archived design versus what exists

Archived design: `docs/archive/2026-10/plan/contracts/canonical-ingestion.md` (Draft
0.1, 2026-08-22) and `docs/archive/2026-10/plan/architecture/data-ingestion-and-adapters.md`.

| Archived element | What exists | Gap |
| --- | --- | --- |
| Envelope `iot.telemetry.v1` (`canonical-ingestion.md:13-47`) | None; `iot.telemetry.device` carries Sparkplug-shaped `devices.Telemetry` | Whole envelope |
| `adapter_id`, `adapter_version` | Adapter UUID only in the Sparkplug edge node id; revision in metric properties | Typed provenance |
| `source_device_id` + `device_id` | Sparkplug address; device bound by configuration | Protocol-neutral source address; rule for resolved device id |
| `profile_version_id` | Configuration carries profile hash and artifact UUID inline | Whether the envelope references profile versions (probably not; ingestion owns it) |
| `observed_at` / `received_at` | Present on readings; adapter receipt time lost | Envelope-level and per-value times plus time source |
| `sequence` | Sparkplug `seq` checked in the session engine only | Sequence plus session or epoch in the envelope |
| `trace_id` | None (captures use a capture id) | Tracing identity (optional) |
| Envelope and per-signal `quality` | `good`/`invalid` after validation only | Source quality vocabulary |
| Signal types incl. `uint64`, `state` (`:63-75`) | Profile types boolean, integer, number, string, timestamp, bytes, enum | Align with profile types; decide on unsigned 64-bit and `state` |
| `raw_payload_reference` | None | Optional reference and retention policy |
| `protocol_metadata` | None downstream | Bounded typed transport details |
| Identity checks at ingestion boundary (`:51-61`) | Partly in the session engine and profile parsing | Moves to canonical ingestion |
| Idempotency key (`:83-85`) | Random telemetry UUID per packet | Deterministic key rules |
| Structured invalid-event diagnostics (`:87-89`) | Reading diagnostics, captures | Rejection diagnostic contract |
| Evolution rules (`:91-97`) | Same text in `contracts/README.md:23-32`, unenforced | Enforcement and compatibility checks |
| "Wire format may become Protobuf" (`:49`) | JSON everywhere except Sparkplug | Decide in plan |
| Native MQTT/HTTP JSON ingress, mapped JSON (`data-ingestion-and-adapters.md:16-40`) | Not built (`docs/architecture/overview.md:198-219`) | Later ingestion spec |
| Node-RED never writes to the database (`:70`) | True | — |
| Adapter manifest and health contracts (`:128`) | Laravel revision `definition` JSON; manager API untyped | Later adapter-service spec |

## 7. What the later specs need from these contracts

**Canonical ingestion in the runtime.**
- The envelope and rejection diagnostic as a stable, versioned input; a reference reader
  (FR-026) that the ingestion code can reuse.
- A protocol-neutral source address and mapping in the device configuration (today
  `source` and `mappings` are Sparkplug-specific, `contracts/devices/v2/configuration.schema.json`),
  plus a decision on lifecycle messages (FR-017) so discovery and presence work
  without Sparkplug births and deaths.
- A deterministic message identity (FR-012) so deduplication stops depending on random
  telemetry UUIDs and observed-time-plus-value matching.
- An explicit unknown-field policy (FR-030) and version range, since an ingestion
  service and many adapters will not always deploy in lockstep.
- Native Sparkplug must map onto the envelope without loss (FR-016), including
  historical metrics, nulls, per-metric timestamps, and session (`bdSeq`) identity.

**Multi-tenant adapter service replacing per-tenant Node-RED.**
- Trusted-context rules (FR-003): the service holds many tenants in one process, so
  the envelope must make tenant identity a property of the authenticated connection and
  never of decoder output. Today one tenant device can claim another device's serial
  inside the same tenant because hardware credentials share the adapter's topic filters
  (`manager.cjs:398-405,461-463`).
- Typed provenance (adapter, revision, installation) replacing Sparkplug metric
  properties; quality and partial messages instead of rejecting the whole message.
- Received time from the ingress, `messageId` carried as dedup identity, units carried.
- Possibly a contract for decoder input and output (today `decoder.cjs:15-23,70-145`)
  and the manager's deploy API; out of scope here.

**Incremental control-plane synchronisation.**
- A versioned snapshot contract (FR-021) as the baseline, and wrapper contracts (FR-020)
  that can grow an occurrence time, contract version and cursor.
- Per-organization scoping and secret handling: the snapshot ships every
  organization's decrypted broker password every 30 s.
- Stable event identities across replays (`ReplayOutcome` uses new UUIDs).
- Contracts for `connection.changed.v1` and `settings.retention.changed.v1` so they can
  carry real change information instead of triggering a full poll or nothing.

## 8. Technology options for the plan step

### 8.1 Contract language

| Option | For | Against |
| --- | --- | --- |
| A. JSON Schema 2020-12 for everything (status quo) | Already used, CI-checked, readable fixtures; works for HTTP JSON internal messages | No standard breaking-change tool; PHP and Go need validator libraries |
| B. Protobuf for the envelope, JSON Schema for internal messages | Compact typed wire format for high-volume ingestion; `buf breaking` detects incompatible changes; Go and Node already use protobuf for Sparkplug | Two contract languages; proto3 JSON maps 64-bit integers to strings and defaults to camelCase names, unlike existing snake_case JSON |
| C. A source language (TypeSpec, CUE or AsyncAPI) generating JSON Schema | One source for docs and schemas; AsyncAPI can describe channels | New toolchain; little gain at the current number of contracts |

The archived design anticipated B ("JSON representation remains available for
diagnostics", `canonical-ingestion.md:49`). A defensible split is A now for every
contract in this spec, with the envelope designed so a protobuf encoding can be added
in the ingestion spec without changing field meaning.

### 8.2 Validators in the test suites (candidates; versions to be checked in the plan)

- **PHP**: `opis/json-schema` (supports 2019-09 and 2020-12); `justinrainbow/json-schema`
  (older drafts). Dev dependency only.
- **Go**: `github.com/santhosh-tekuri/jsonschema` (2020-12, actively maintained);
  `github.com/xeipuuv/gojsonschema` (draft 7 only, unmaintained). Test-only import.
- **Node** (adapter tests, if needed): `ajv` with the 2020 dialect.
- Python `jsonschema` stays the cross-language reference in CI.

### 8.3 Code generation

No generated types exist today by decision (`docs/architecture/overview.md:211-212`).
Options: keep hand-written structs and DTOs and prove them with schema validation in
tests (smallest change, matches FR-025 and FR-026); generate Go structs from schemas
(for example `omissis/go-jsonschema`); generate TypeScript for the SDK later. PHP has
no mainstream generator. Recommendation for the plan: no generation in this spec.

### 8.4 Compatibility checking

- Cheap and effective for JSON Schema: within a major version, every valid example of
  the previous release must still validate under the new schema, and every field present
  on `main` must still be present. A small script compares against `main`'s copy.
- Protobuf, if chosen for the envelope: `buf breaking` against `main`.

### 8.5 Coverage registry

A manifest in `contracts/` mapping each message type to its schema, producers and
consumers. Each side's test suite asserts that the set of types in code equals the
manifest: Laravel's `Rule::in` list (`RuntimeController.php:93-95`) and outbox types;
Go's `handleControl` cases and emitted types (string literals today, which would
become constants).

### 8.6 Unknown-field policy (input to FR-030)

A tolerant reader within a major version (producers are tested against the current
closed schema so they never emit undeclared fields, while consumers ignore fields they
do not know) supports additive changes and messages queued across an upgrade. Strict
reading matches the current schemas and catches typos, but forces lockstep releases
and turns every additive change into a breaking one. Today the runtime's control
decoder is already tolerant (`store.go:120-124`) and Laravel ignores extra keys, so
"strict" would be the behaviour change, not "tolerant".

## 9. Notes and risks for the owner

- **Pilot adapter tenant.** Nothing in the repository names a pilot organization using
  adapters; the pilot exposes the adapter broker port range (`docs/ops/pilot.md:25,43`)
  and whether `IOT_ADAPTERS_ENABLED` is on lives in private environment files. Any
  adapter tenant depends on the managed publisher's Sparkplug output and on Go's
  provenance check (`profile.go:163-171`). This spec must not change either; the
  contract corrections (section 5.3) describe current output, so adapter devices'
  committed events and configurations become valid rather than changing.
- **Behaviour-change temptation.** Several defects surface here (500 retry loop on
  malformed events, 404 retry loops, QoS 0 subscriptions, non-retried hand-off,
  `ReplayOutcome` UUIDs, ignored `workflow.suspended.v1` reasons). Fixing them belongs
  to later specs or bug fixes unless FR-031 is resolved in favour of live validation.
- **Secrets in fixtures.** The snapshot contract includes broker passwords; golden
  examples must use obvious placeholders.
- **ADR implications.** If the plan chooses protobuf for the envelope or changes the
  unknown-field rule in `contracts/README.md`, record it in an ADR that amends ADR-005
  (canonical model independent of Sparkplug) and relates to ADR-010 and ADR-014.
