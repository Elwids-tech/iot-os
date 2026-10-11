# Data Model: Canonical Telemetry and Internal Event Contracts

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Decisions**: [research.md §10](research.md#10-decisions-plan-step-2026-10-11)

These are message shapes, not database tables, apart from the violation record in §6.
Field types use JSON terms. "uuid" means an RFC 9562 UUID string; "date-time" means an
RFC 3339 UTC timestamp with millisecond or finer precision and a `Z` suffix. Limits are
part of the contract and are enforced by the schema unless marked *(reader)*, which
means JSON Schema cannot express them and the reference reader enforces them.

## 1. Canonical telemetry envelope (`telemetry.envelope.v1`)

One message per source device per report (FR-002). Strict reading: unknown properties
are rejected at every level (FR-030).

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `schema_version` | const `"telemetry.envelope.v1"` | yes | Readers refuse other values with `unsupported_version` |
| `message_id` | uuid | yes | Derived as in §1.4 |
| `identity` | object (§1.4) | yes | How `message_id` was derived |
| `trusted` | Trusted context (§2) | yes | Set only by the trusted ingress boundary |
| `source` | Source (§3) | yes | Protocol and source address |
| `provenance` | Provenance (§1.2) | yes | |
| `received_at` | date-time | yes | Assigned at the trusted ingress boundary |
| `observed_at` | date-time | no | Source time for the whole report |
| `values` | array of Value (§1.1) | yes | 1 to 2,000 items |

*(reader)* Encoded size at most 1 MiB. *(reader)* No two values with the same `name` and
the same effective observation time (`values[].observed_at`, else envelope
`observed_at`, else `received_at`).

### 1.1 Value

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `name` | string | yes | 1 to 256 characters; a protocol metric name or a profile parameter key (FR-007) |
| `type` | enum `boolean`, `integer`, `number`, `string`, `timestamp`, `bytes` | yes | |
| `value` | per `type` | no | `boolean`: JSON boolean. `integer`: JSON integer within ±9,007,199,254,740,991. `number`: finite JSON number. `string`: up to 65,536 characters. `timestamp`: date-time. `bytes`: base64, decoded size up to 65,536 bytes |
| `no_value_reason` | enum `null_reported`, `decode_failed`, `out_of_range`, `unsupported_type` | when `value` is absent | Present if and only if `value` is absent |
| `quality` | enum `good`, `uncertain`, `bad` | yes | Must not be `good` when `value` is absent |
| `quality_code` | string | no | 1 to 64 characters, the source's native code (for example an OPC UA status) |
| `quality_reason` | string | no | 1 to 256 characters, safe text |
| `unit` | object `{symbol, custom}` | no | `symbol` 1 to 32 characters; `custom: false` means a symbol from `contracts/units/v1/units.json` *(checker validates the fixtures; readers do not convert)* |
| `observed_at` | date-time | no | Per-value source time |
| `time_source` | enum `source`, `receipt`, `corrected_future`, `derived` | yes | Where the effective time came from (FR-006) |
| `historical` | boolean | yes | `true` for backfilled or buffered values (FR-010) |

`time_source` must be `receipt` when neither `observed_at` is present; this is a schema
rule (`if`/`then`).

### 1.2 Provenance

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `transport` | enum `mqtt`, `http`, `opcua`, `poll` | yes | |
| `topic` | string | no | 1 to 512 characters, MQTT only |
| `qos` | integer 0 to 2 | no | MQTT only |
| `retained` | boolean | no | MQTT only |
| `raw_payload_ref` | string | no | 1 to 256 characters, an opaque reference to a retained raw payload; never the payload |

No credentials, URLs with user information, headers or payload fragments (FR-005).

### 1.3 Source

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `protocol` | enum `sparkplug_b`, `vendor_mqtt`, `http_json`, `opcua`, `polling` | yes | Adding a protocol is an additive enum change; strict readers update first (research D4) |
| `address` | Source address (§3) | yes | Always required (FR-004) |

### 1.4 Message identity

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `basis` | enum `session_sequence`, `source_message_id`, `observed_time`, `ingress_assigned` | yes | The first basis whose facts exist, in this order (FR-012) |
| `session` | string | for `session_sequence` | 1 to 128 characters (Sparkplug: the `bdSeq` session) |
| `sequence` | integer ≥ 0 | for `session_sequence` | May wrap (Sparkplug `seq` is 0 to 255) |
| `source_timestamp` | date-time | for `session_sequence` | Disambiguates a wrapped sequence (Sparkplug payload timestamp) |
| `source_message_id` | string | for `source_message_id` | 1 to 128 characters (vendor `messageId`, HTTP idempotency key) |

`message_id` = UUIDv5 with namespace `8fb29609-1d16-49c4-b21f-e75dec46ea03` over the
UTF-8 string `<family>\n<organization_uuid>\n<ingress.uuid>\n<canonical source address>\n<basis>\n<basis facts>`
where `<family>` is `telemetry`, `presence` or `announcement`, the canonical source
address is `scheme` followed by the address fields in schema order, joined with `\n`
(an empty field stays empty), and the basis facts, joined with `\n`, are:

| Basis | Facts |
| --- | --- |
| `session_sequence` | `session`, `sequence`, `source_timestamp` (RFC 3339, milliseconds) |
| `source_message_id` | `source_message_id` |
| `observed_time` | envelope `observed_at` (milliseconds) and the sorted value names joined with `,`, so two partial reports at the same time stay distinct |
| `ingress_assigned` | a random UUID generated once at first receipt (duplicates before the ingress cannot be recognised) |

*(reader)* The reference reader recomputes `message_id` for every basis except
`ingress_assigned` and rejects a mismatch (`identity_mismatch`).

## 2. Trusted context

Shared by the envelope, presence and announcement. Never produced by decoder code
(FR-003).

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `organization_uuid` | uuid | yes | From the authenticated connection |
| `ingress` | object `{kind, uuid}` | yes | `kind`: `broker_connection`, `adapter_deployment`, `device_credential`, `api_token`; `uuid` of that platform record |
| `adapter` | object `{adapter_uuid, revision_uuid}` | when an adapter decoded the report | Both uuid |
| `installation_uuid` | uuid | no | Known hardware installation |
| `device` | object `{device_uuid, basis}` | no | `basis`: `credential` (the credential identifies the device) or `binding` (the ingress resolved a platform binding). Ingestion re-verifies and rejects a mismatch with `device_mismatch` (FR-004) |

Organization and device identifiers appear nowhere else in the message: the observed
parts (`source`, `values`, `provenance`) have closed schemas without such fields, and
the invalid cases include an attempt to add them (rejected as `unknown_field`).

## 3. Source address

A closed union discriminated by `scheme` (each branch has a distinct `scheme` const).

| `scheme` | Fields | Used by |
| --- | --- | --- |
| `sparkplug` | `group_id` (1 to 128), `edge_node_id` (1 to 128), `device_id` (0 to 128; empty means the edge node itself) | Native Sparkplug |
| `device_key` | `key` (1 to 128), the manufacturer serial or device identifier the decoder reports | Vendor decoders (`sourceDeviceId`) |
| `topic` | `topic` (1 to 512), for devices addressed only by their topic | Topic-per-device MQTT |
| `endpoint` | `endpoint` (1 to 512, no user information or query secrets), optional `path` (1 to 256) | HTTP polling, OPC UA (`path` = node id) |

Binding a source address to a platform device stays with platform configuration; the
ingestion spec generalises today's Sparkplug-only `source` in device configurations.

## 4. Lifecycle messages (FR-017)

Both share `schema_version`, `message_id`, `identity`, `trusted`, `source`,
`provenance` and `received_at` with the envelope, and are read strictly.

### 4.1 Source presence (`source.presence.v1`)

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `presence` | enum `online`, `offline`, `unknown` | yes | |
| `reason` | string | no | 1 to 256 characters, safe text |
| `session` | string | no | 1 to 128 characters; the session the change refers to (Sparkplug `bdSeq`) |
| `observed_at` | date-time | no | Source time of the change |

### 4.2 Source announcement (`source.announcement.v1`)

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `parameters` | array of `{name, type, unit?, writable?}` | yes | 1 to 2,000; `name` and `type` as in §1.1; `writable` boolean (accepts commands); names unique *(reader)* |
| `parameters_hash` | string | yes | Lowercase hex SHA-256 of the sorted `name\ttype` lines joined with `\n`; changes exactly when names or types change *(reader recomputes)* |
| `session` | string | no | 1 to 128 characters |

No values are carried; a birth that also contains values produces an announcement and
a telemetry envelope.

## 5. Rejection diagnostic (`ingestion.rejection.v1`)

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `schema_version` | const | yes | |
| `stage` | enum `decode`, `version`, `schema`, `semantic`, `identity`, `binding`, `policy` | yes | |
| `code` | enum (below) | yes | |
| `explanation` | string | yes | 1 to 512 characters, safe text without values |
| `message_id` | uuid | no | When readable |
| `declared_version` | string | no | 1 to 64 characters |
| `organization_uuid` | uuid | no | From the trusted context when readable |
| `adapter_revision_uuid` | uuid | no | |
| `locations` | array of JSON Pointer strings | no | Up to 10 |
| `raw_payload_ref` | string | no | As in provenance |
| `rejected_at` | date-time | yes | |

Codes: `malformed`, `too_large`, `unsupported_version`, `schema_violation`,
`unknown_field`, `identity_in_content`, `identity_mismatch`, `duplicate_value`,
`too_many_values`, `device_mismatch`, `parameters_hash_mismatch`. Codes are a closed
list within the major version; adding one is additive.

## 6. Contract violation record (control plane table `contract_violations`)

Written by the live checks (FR-031, research D5). One row per (side, contract).

| Column | Type | Rules |
| --- | --- | --- |
| `side` | varchar(16) | `control_plane` (checked by Laravel) or `runtime` (reserved; the runtime keeps its counts in memory) |
| `contract` | varchar(128) | A catalogue id, or `unknown` |
| `count` | bigint | Incremented atomically by upsert |
| `first_seen_at`, `last_seen_at` | timestamptz | |
| `last_message_id` | uuid null | Message identity of the latest violation |
| `last_locations` | jsonb | Up to 10 `{keyword, instance_location}`; never values |

Primary key (`side`, `contract`). No tenant data; no pruning needed because the table
is bounded by the catalogue.

## 7. Internal message catalogue

Contract ids, where their schemas live, and how consumers deduplicate and fence. Paths
are under `contracts/`. "New" means created by this spec; "corrected" means fixed under
FR-022. All are at least once; every reading mode here is tolerant (FR-030).

### 7.1 Control messages (control plane → runtime)

Message shape: `{uuid, type, payload, lease_token?}`. Deduplication: `uuid` (outbox row,
JetStream `Nats-Msg-Id`). Producer tests in `apps/api`, consumer tests in
`services/runtime`. Live check: runtime `devices-control` consumer.

| Contract id | Schema | Payload | Fences |
| --- | --- | --- | --- |
| `device.activate.v1` | `devices/v1/activation.schema.json` (corrected) | `organization_uuid, device_uuid, generation, operation_uuid, definition` (configuration v1 or v2) | generation, operation |
| `device.deactivate.v1` | `internal/control/device.deactivate.v1.schema.json` (new) | `organization_uuid, device_uuid, generation, operation_uuid` | generation, operation |
| `device.command.v1` | `internal/control/device.command.v1.schema.json` (new message; payload `$ref` `devices/v1/command.schema.json`, corrected) | command fields incl. `generation`, nullable `session_id` | generation, command uuid |
| `workflow.deploy.v1` | `internal/control/workflow.deploy.v1.schema.json` (new message; payload `$ref` `rules/v1/deployment.schema.json`) | `operation_uuid, rule_uuid, organization_uuid, generation, target, definition` | generation, operation |
| `workflow.deploy.v2` | `internal/control/workflow.deploy.v2.schema.json` (new; definition `$ref` `rules/v2/workflow.schema.json`) | same six keys | generation, operation |
| `connection.changed.v1` | `internal/control/connection.changed.v1.schema.json` (new) | `connection_uuid` | none (triggers a full re-sync) |
| `settings.retention.changed.v1` | `internal/control/settings.retention.changed.v1.schema.json` (new) | `scope, revision` | none (no-op today) |

### 7.2 Runtime events (runtime → control plane)

Message shape: `{uuid, type, payload}`. Deduplication: `uuid` (`device_inbox`).
Producer tests in `services/runtime`, consumer tests in `apps/api`. Live check: control
plane middleware on `POST /events`. All schemas new under `internal/events/`.

| Contract id | Payload (from research §4.4) | Fences applied by the control plane |
| --- | --- | --- |
| `connection.presence.v1` | `connection_uuid, presence, diagnostic` | none |
| `discovery.presence.v1` | `connection_uuid, edge_node_id, device_id, session_id, received_at, presence` | session |
| `discovery.birth.v1` | as above with `metrics[]` instead of `presence` | session |
| `gateway.presence.v1` | `connection_uuid, edge_node_id, session_id, presence, last_seen_at` | session |
| `device.presence.v1` | `organization_uuid, device_uuid, configuration_uuid, generation, presence, diagnostic, last_seen_at` | generation, configuration |
| `device.applied.v1` | `device_uuid, organization_uuid, configuration_uuid, generation, presence, operation_uuid` | generation, operation, configuration |
| `device.failed.v1` | `device_uuid, organization_uuid, generation, configuration_uuid, diagnostic, operation_uuid?` | generation, operation, configuration |
| `device.deactivated.v1` | as applied plus `uncertain_command_uuids` | generation, operation |
| `command.status.v1` | `organization_uuid, device_uuid, command_uuid, status, diagnostic, sent_at` | command uuid, terminal status |
| `runtime.heartbeat.v1` | `at` | none |
| `retention.cleanup.v1` | `organization_uuid, status, deleted_rows, diagnostic` | none |
| `workflow.deployment.v1` | `operation_uuid, rule_uuid, organization_uuid, generation, target, status, diagnostic` | generation, operation |
| `workflow.suspended.v1` | `operation_uuid, rule_uuid, organization_uuid, reason` | operation |
| `workflow.transition.v1` | `operation_uuid, rule_uuid, organization_uuid, transition` (`$ref` `rules/v1/transition.schema.json`) | transition id |
| `workflow.membership.v1` | same shape, transition type `entered` or `exited` | transition id |
| `automation.intent.v1` | `id, workflow_uuid, operation_uuid, organization_uuid, node_id, correlation_key, kind, trigger, occurred_at, expires_at, config, episode, transition?` | intent id |

Optionality and value sets (for example `presence` values, `command.status` statuses)
are taken from the emitters and handlers cited in research §4.4 when the schemas are
written; where the emitter and the handler disagree, the schema follows the emitter and
the difference is listed in the contract's description.

### 7.3 Wrappers and snapshot

| Contract id | Schema (new, `internal/`) | Producer → consumer | Live check |
| --- | --- | --- | --- |
| `internal.outbox-claim.request.v1` | `wrappers/internal.outbox-claim.request.v1.schema.json` (empty object) | runtime → control plane | control plane middleware |
| `internal.outbox-claim.response.v1` | `wrappers/internal.outbox-claim.response.v1.schema.json` (`data[]` of `{uuid, type, payload, lease_token}`, at most 100) | control plane → runtime | runtime client |
| `internal.outbox-ack.request.v1` | `wrappers/internal.outbox-ack.request.v1.schema.json` (`lease_token`) | runtime → control plane | control plane middleware |
| `internal.outbox-ack.response.v1` | `wrappers/internal.outbox-ack.response.v1.schema.json` (`ok`; the 409 stale-lease outcome is documented, its body is the framework error) | control plane → runtime | runtime client |
| `internal.runtime-event.response.v1` | `wrappers/internal.runtime-event.response.v1.schema.json` (`ok`, optional `duplicate`, `stale`, `ignored: "unknown_reference"`) | control plane → runtime | runtime client |
| `internal.automation-command-check.request.v1` | `wrappers/…request.v1.schema.json` (`action_id` 64 hex, `command_uuid`) | runtime → control plane | control plane middleware |
| `internal.automation-command-check.response.v1` | `wrappers/…response.v1.schema.json` (`allowed`) | control plane → runtime | runtime client |
| `internal.control-state.v1` | `state/internal.control-state.v1.schema.json` (`connections[]`, `devices[]`, `retention[]` as in research §4.5; `password` marked secret) | control plane → runtime | runtime background checker |

### 7.4 Catalogue entry (`contracts/internal/catalogue.json`)

| Field | Meaning |
| --- | --- |
| `id` | Contract id |
| `group` | `control`, `event`, `wrapper`, `state` |
| `schema` | Path under `contracts/` |
| `producer`, `consumer` | `control_plane` or `runtime` |
| `dedup` | The field consumers deduplicate on, or `none` |
| `fences` | List of fencing fields |
| `reading` | `tolerant` (all internal entries) |
| `live_check` | Where the live check runs |
| `producer_tests`, `consumer_tests` | Test files that reference the id; the checker requires both to exist and mention it |

The envelope family is listed in `contracts/ingestion/v1/catalogue.json` with
`reading: strict`, `producer: adapter`, `consumer: ingestion`, and the reference
reader's test file as the consumer test.
