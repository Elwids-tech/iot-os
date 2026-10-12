# Contracts

Cross-language contracts: JSON Schemas with golden fixtures, the pinned Sparkplug
protobuf, and shared catalogues. PHP, Go, TypeScript and Python tests read these
files directly; there is no generated `packages/contracts` package. Each schema sits
beside a `.fixture.json` that must validate against it (a schema holding only shared
`$defs` needs none), and new or corrected contracts also have a `.cases.json` file of
valid and invalid examples.

| Directory | Contract | Used by |
| --- | --- | --- |
| [`devices/v1`](devices/v1) | Activation, command, telemetry and configuration v1 schemas; expression-evaluator parity cases | Runtime contract tests, PHP/Go parity tests |
| [`devices/v2`](devices/v2) | `device-configuration.v2` (adds incoming conversions); conversion parity cases | Laravel configuration snapshots, runtime |
| [`events/v1`](events/README.md) | `telemetry.committed.v1` | Runtime committed-telemetry feed and its consumers |
| [`rules/v1`](rules/v1) | Workflow v1, `geofence-rule.v1` definition, state, transition, deployment, simulation request and expected trace | Geofence rules |
| [`rules/v2`](rules/v2) | `automation-workflow.v2` DAG schema and a reference graph | DAG automation |
| [`location/v1`](location/v1) | `location-binding.v1`, `location-fix.v1`, 30 location scenarios | Location resolver, geofences, integration API |
| [`ingestion/v1`](ingestion/v1) | Canonical telemetry envelope family (`telemetry.envelope.v1`, `source.presence.v1`, `source.announcement.v1`, `ingestion.rejection.v1`), read strictly. Only the empty catalogue exists so far | Reference reader in the runtime, not wired into any live path |
| [`internal`](internal) | Control-plane and runtime protocol: control messages, runtime events, delivery wrappers and the `/state` snapshot, read tolerantly. The catalogue and its schema exist; entries are added with each contract | Laravel and the Go runtime ([ADR-014](../docs/adr/ADR-014-control-plane-data-plane-http-integration.md)) |
| [`definitions/device-profiles`](definitions/README.md) | Example compiled profile definitions | Simulator preparation, seeders, tests |
| [`units/v1`](units/v1) | Unit catalogue (`units.json`) | Profile authoring (`GET /api/v1/units`) |
| [`sparkplug`](sparkplug) | Eclipse Tahu `sparkplug_b.proto` pinned in `upstream.json`, binary fixtures with `expected.json` | Runtime decoder, simulators ([Sparkplug](../docs/reference/sparkplug.md)) |

Check them with `.local/devices/python/bin/python tooling/verify-devices-contracts.py`
plus the Go and PHP test suites ([testing](../docs/dev/testing.md)). The checker
walks every `*.schema.json` under a `v<N>/` directory or `internal/`, so a new
contract directory needs no script change. The rules below are recorded in
[ADR-015](../docs/adr/ADR-015-internal-contract-validation.md).

## Rules

- Additive fields stay within a major version; removing or renaming a field,
  adding a required field, removing an enum value, changing a type or `const`, or
  tightening a limit needs a new version (`…v2`). Producers state their version,
  and consumers reject versions they do not support instead of guessing.
- Identity and tenancy never come from a device payload. Contracts carry
  organization, device, configuration and generation identities assigned by the
  platform. User references are the integer `user_id`.
- A change to a contract changes its fixture and cases in the same commit and
  keeps every consumer's tests green.

### Files and naming

| Thing | Rule | Example |
| --- | --- | --- |
| Contract id | Control messages and runtime events: the wire `type`. Wrappers and the snapshot: `internal.<name>.v<major>`. Envelope family: the `schema_version` value | `device.applied.v1`, `internal.control-state.v1`, `telemetry.envelope.v1` |
| File stem under `internal/` and `ingestion/` | The contract id | `internal/events/device.applied.v1.schema.json` |
| Golden example | `<stem>.fixture.json`, one realistic valid instance | `internal/events/device.applied.v1.fixture.json` |
| Cases | `<stem>.cases.json`, valid and invalid cases | `internal/events/device.applied.v1.cases.json` |
| `$id` | `https://iot-os.local/contracts/<path from contracts/>`; the checker assumes it when a schema has none | `https://iot-os.local/contracts/internal/events/device.applied.v1.schema.json` |
| Dialect | `"$schema": "https://json-schema.org/draft/2020-12/schema"` | |
| Field names | `snake_case`; platform identities end in `_uuid` | `organization_uuid` |

Existing schemas keep their paths (`devices/v1/activation.schema.json` is
`device.activate.v1`) and new message schemas reference them with `$ref` instead of
copying them.

### Reading: closed schemas, tolerant internal readers, strict envelope readers

- Every object schema sets `additionalProperties: false`, and producers are tested
  against the schema as written, so they never send an undeclared field.
- Consumers of internal messages (`internal/` and the schemas they reference) read
  tolerantly: they ignore fields they do not know, and validators drop
  `additionalProperties` and `unevaluatedProperties` errors.
- Readers of the canonical envelope family (`ingestion/`) are strict: they reject
  any field their supported version does not define, so readers ship support for a
  new optional field before any producer sends it.
- `oneOf` branches are told apart by a `const` property that every branch requires
  (for example `schema_version` or `type`), or by disjoint JSON types (an object or
  `null`), never by `additionalProperties`. Tolerant filtering then cannot change
  which branch matches. The checker enforces this after resolving `$ref`.
- Limits (`maxItems`, `maxLength`, numeric ranges) are part of the contract. Limits
  JSON Schema cannot express are listed in the schema `description` and enforced by
  the reader.
- A message schema's `description` names its producers, consumers, delivery
  guarantee (at least once), deduplication key and fencing fields, matching its
  catalogue entry.

### Secret fields

Mark a property that carries a credential with `"$comment": "secret"`. Every
example value at that location (fixture and cases) must be a string starting with
`placeholder-`, or `null`; the checker fails on anything else and never prints the
value. Real credentials never enter git.

### Cases files

A cases file is an array in the JSON-Schema-Test-Suite shape:

```json
[
  { "description": "applied with a v2 configuration", "valid": true, "data": {} },
  {
    "description": "missing generation",
    "valid": false,
    "error": { "keyword": "required", "instance_location": "/payload" },
    "data": {}
  },
  {
    "description": "a field added by a newer producer",
    "valid": false,
    "tolerant_valid": true,
    "error": { "keyword": "additionalProperties", "instance_location": "/payload" },
    "data": {}
  }
]
```

- `valid` cases must validate against the closed schema.
- Every invalid case names the `keyword` and `instance_location` (a JSON Pointer,
  `""` for the root) it fails on. The checker accepts it only when every error it
  produces is that one (or contains it, for `oneOf` and similar), so a case cannot
  pass for another reason.
- `tolerant_valid: true` marks an unknown-field case: invalid for producers
  (closed), valid for tolerant consumers. Its keyword must be
  `additionalProperties` or `unevaluatedProperties`, and it must pass once those
  errors are dropped. Every other invalid case of a tolerant contract must still
  fail in tolerant mode, so an unknown-field case there must be marked.
- Envelope-family cases may instead name a reader code
  (`"error": {"code": "duplicate_value"}`) for a rule JSON Schema cannot express.
  The checker requires such a case to be valid against the schema; only the
  reference reader evaluates the code.
- Schemas no catalogue lists are judged as tolerant, except under `ingestion/`,
  which is strict.

### Catalogues

[`internal/catalogue.json`](internal/catalogue.json) lists every internal message
contract and [`ingestion/v1/catalogue.json`](ingestion/v1/catalogue.json) the
envelope family. Both follow
[`internal/catalogue.schema.json`](internal/catalogue.schema.json):

| Field | Meaning |
| --- | --- |
| `id` | Contract id, unique across both catalogues |
| `group` | `control`, `event`, `wrapper` or `state` for internal messages; `envelope` for the envelope family |
| `schema` | Path under `contracts/` |
| `producer`, `consumer` | `control_plane` or `runtime`; `adapter` and `ingestion` for the envelope family |
| `dedup` | The field consumers deduplicate on, or `none` |
| `fences` | Fields consumers compare to drop stale messages (generation, operation, session) |
| `reading` | `tolerant` for internal messages, `strict` for the envelope family |
| `live_check` | Where the running system checks it (`<side>:<location>`), or `none` |
| `producer_tests`, `consumer_tests` | Test files, from the repository root, that exercise the contract on each side |

The checker fails when an entry's schema, fixture or cases file is missing, when
the cases lack a valid or an invalid example (a `tolerant_valid` case does not count
as invalid), or when a listed test file does not exist or does not mention the id. Envelope-family entries may leave
`producer_tests` empty while no component produces the envelope.

## Not contracts here

- **Public HTTP API.** There is no OpenAPI description; see the
  [API surface](../docs/reference/api.md).
- **Canonical ingestion.** No canonical telemetry envelope or native JSON ingestion
  was built; the runtime ingests Sparkplug B only, and adapters translate vendor
  payloads into Sparkplug ([overview](../docs/architecture/overview.md#what-was-not-built)).
- **Definition activation.** There is no `definition.activated.v1` event; device
  configurations and workflow deployments carry their definitions inline through the
  Laravel outbox ([ADR-014](../docs/adr/ADR-014-control-plane-data-plane-http-integration.md)).
- **Integration events.** `integration-event.v1` is defined by the Laravel journal and
  the SDK's validators ([events](../docs/reference/events.md#integration-events)).
