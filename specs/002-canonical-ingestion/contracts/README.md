# Contract layout and naming conventions

**Feature**: [spec.md](../spec.md) | **Fields**: [data-model.md](../data-model.md) | **Decisions**: [research.md §10](../research.md#10-decisions-plan-step-2026-10-11)

This folder describes how the contracts are laid out in the repository's top-level
`contracts/` directory once this feature is implemented. The JSON files under
[`examples/`](examples) are illustrative instances for review: the canonical golden
examples are written in `contracts/` during implementation, and these files become the
first valid cases there.

## Directory layout (target)

```text
contracts/
├── README.md                       # updated rules: tolerant internal, strict envelope, live checks
├── devices/v1/                     # existing; activation, command, telemetry, configuration corrected (FR-022)
├── devices/v2/configuration…       # existing; corrected (adapter binding)
├── events/v1/telemetry-committed…  # existing; corrected (provenance fields)
├── rules/v1/deployment…, transition…  # existing; referenced by internal control and event contracts
├── ingestion/v1/                   # NEW: canonical envelope family (strict)
│   ├── catalogue.json
│   ├── common.schema.json          # $defs: trusted context, source, address union, provenance, identity, value
│   ├── telemetry.envelope.v1.schema.json | .fixture.json | .cases.json
│   ├── source.presence.v1.schema.json    | .fixture.json | .cases.json
│   ├── source.announcement.v1.schema.json| .fixture.json | .cases.json
│   ├── ingestion.rejection.v1.schema.json| .fixture.json | .cases.json
│   └── MAPPING.md                  # FR-016 field-by-field mapping from Sparkplug and the vendor decoder
└── internal/                       # NEW: control-plane ↔ runtime protocol (tolerant)
    ├── catalogue.json
    ├── common.schema.json          # $defs: uuid, date-time, generation, control and event message shells
    ├── control/<type>.schema.json | .fixture.json | .cases.json    # e.g. device.deactivate.v1
    ├── events/<type>.schema.json  | .fixture.json | .cases.json    # 16 runtime event types
    ├── wrappers/internal.<name>.v1.schema.json | .fixture.json | .cases.json
    └── state/internal.control-state.v1.schema.json | .fixture.json | .cases.json
```

`device.activate.v1` keeps its existing schema at `devices/v1/activation.schema.json`;
the catalogue points there. Other existing schemas are referenced with `$ref` from the
new message schemas rather than copied.

## Naming

| Thing | Rule | Example |
| --- | --- | --- |
| Contract id | Control and event types: the wire `type`. Wrappers and snapshot: `internal.<name>.v<major>`. Envelope family: the `schema_version` value | `device.applied.v1`, `internal.control-state.v1`, `telemetry.envelope.v1` |
| File stem | The contract id | `events/device.applied.v1.schema.json` |
| Golden example | `<id>.fixture.json`, one canonical valid instance | `events/device.applied.v1.fixture.json` |
| Cases | `<id>.cases.json`, valid and invalid cases | `events/device.applied.v1.cases.json` |
| `$id` | `https://iot-os.local/contracts/<path from contracts/>` | `https://iot-os.local/contracts/internal/events/device.applied.v1.schema.json` |
| Dialect | `"$schema": "https://json-schema.org/draft/2020-12/schema"` | |
| Field names | `snake_case`, platform identities end in `_uuid`, user references are integer `user_id` | `organization_uuid` |
| Secret fields | `"$comment": "secret"` on the property; examples use values starting `placeholder-` (checker enforces) | snapshot `connections[].password` |

## Schema rules

- Every object schema sets `additionalProperties: false`. Producers are tested against
  the schema as written (closed). Consumers of internal contracts read tolerantly: the
  validators drop `additionalProperties` and `unevaluatedProperties` errors (research
  D5). Envelope-family readers keep them (strict).
- `oneOf` branches are told apart by a `const` property, never by
  `additionalProperties`.
- Limits (`maxItems`, `maxLength`, numeric ranges) are part of the contract; limits that
  JSON Schema cannot express are listed in the schema `description` and enforced by the
  reference reader.
- A schema `description` names producers, consumers, delivery guarantee, deduplication
  key and fencing fields (FR-023), matching the catalogue entry.

## Cases file format

JSON-Schema-Test-Suite shape, one array per contract:

```json
[
  { "description": "activation with a v2 configuration", "valid": true, "data": { "...": "..." } },
  {
    "description": "missing generation",
    "valid": false,
    "error": { "keyword": "required", "instance_location": "/payload" },
    "data": { "...": "..." }
  }
]
```

- At least one valid and one invalid case per contract; every invalid case names the
  keyword and instance location it must fail on, so it cannot pass for another reason.
- Envelope-family invalid cases may instead name a reader code
  (`"error": {"code": "duplicate_value"}`) for rules JSON Schema cannot express; only
  the Go reference reader evaluates those.
- Internal-contract cases with an unknown property are marked `"tolerant_valid": true`:
  invalid for producers (closed), valid for tolerant consumers.

## Catalogue format

See [data-model.md §7.4](../data-model.md#74-catalogue-entry-contractsinternalcatalogue.json).
A sketch of one entry:

```json
{
  "id": "device.applied.v1",
  "group": "event",
  "schema": "internal/events/device.applied.v1.schema.json",
  "producer": "runtime",
  "consumer": "control_plane",
  "dedup": "uuid",
  "fences": ["generation", "operation_uuid", "configuration_uuid"],
  "reading": "tolerant",
  "live_check": "control_plane:events",
  "producer_tests": ["services/runtime/internal/storage/contracts_events_integration_test.go"],
  "consumer_tests": ["apps/api/tests/Feature/Domain/Devices/RuntimeEventContractTest.php"]
}
```

## Examples in this folder

| File | Shows |
| --- | --- |
| [`examples/sparkplug-ddata.envelope.json`](examples/sparkplug-ddata.envelope.json) | The `ddata-alias.bin` fixture after alias resolution: `session_sequence` identity, per-value source time |
| [`examples/sparkplug-dbirth.announcement.json`](examples/sparkplug-dbirth.announcement.json) | A DBIRTH as a source announcement with `parameters_hash` |
| [`examples/sparkplug-ndeath.presence.json`](examples/sparkplug-ndeath.presence.json) | An NDEATH as presence `offline` for the edge node (`device_id` empty) |
| [`examples/vendor-water-meter.envelope.json`](examples/vendor-water-meter.envelope.json) | The water-meter decoder output with adapter provenance, `source_message_id` identity, receipt time and units kept |
| [`examples/http-json-meter.envelope.json`](examples/http-json-meter.envelope.json) | A future HTTP JSON device with a per-device credential (`device.basis: credential`), `observed_time` identity and a value that failed to decode |

The `message_id` values are computed with the rule in
[data-model.md §1.4](../data-model.md#14-message-identity), except the presence example,
which uses `ingress_assigned`.
