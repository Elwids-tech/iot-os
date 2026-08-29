# Canonical Ingestion Contract

**Status:** Canonical contract complete; runtime implementation pending  
**Version:** `iot.telemetry.v1`  
**Last updated:** 2026-08-29

## Purpose

The canonical ingestion contract separates MQTT and future protocol adapters from deterministic Go ingestion. Native JSON, Sparkplug B, Node-RED, and future adapter runtimes must converge on one normalized value contract.

The executable schema is [`contracts/definitions/canonical-telemetry/v1/schema.json`](../../contracts/definitions/canonical-telemetry/v1/schema.json).

## Value model

Each canonical record contains one typed value for one stable logical-Device parameter. It includes:

- Organization UUID derived from trusted tenant context;
- authenticated Gateway UUID;
- matched Gateway Route UUID;
- logical Device UUID;
- stable parameter UUID;
- exact Profile and Binding Version UUIDs;
- source and received timestamps;
- typed value and quality;
- message identity; and
- Runtime Bundle hash.

TimescaleDB series identity is `(device_uuid, parameter_uuid)`. Labels, keys, units, constraints, presentation hints, and formulas remain definition metadata joined for display; they are not copied into every telemetry value.

## Identity and trust

Organization and Gateway identity come from authenticated connection or adapter configuration, never from untrusted payload claims.

Before emitting canonical telemetry, the runtime must verify that:

- the authenticated Gateway is active for the Organization;
- an enabled Gateway Route matches the topic and payload scope;
- the route points to the exact Device, Profile Version, and Binding Version in the Runtime Bundle;
- the mapping targets a known stable parameter UUID;
- extraction, conversion, calibration, constraints, and missing/invalid policies pass; and
- message size, rate, timestamp, and idempotency limits pass.

## Types

Initial value types are:

- `float64`
- `int64`
- `uint64`
- `boolean`
- `string`
- `bytes`
- `state`

Complex structures should be decomposed into governed parameters or stored as referenced artifacts instead of arbitrary nested telemetry.

## Processing order

1. Authenticate Gateway and resolve Organization.
2. Match one or more enabled Gateway Routes.
3. Select the route-pinned Runtime Bundle.
4. Extract records and mapped values with restricted JSONPath.
5. Convert types and apply ordered calibration operations.
6. Apply constraints plus explicit missing/invalid policies.
7. Evaluate same-Device derived parameters in topological order.
8. Emit one canonical value per successful measured or derived parameter.
9. Publish structured diagnostics for rejected messages or values.

One Gateway payload may therefore produce canonical values for several logical Devices when several routes match.

## Time and quality

- `observed_at` is source event time when a validated Binding timestamp mapping is available.
- `received_at` is assigned at the trusted ingress boundary.
- Quality records whether the value is good, uncertain, or bad and may include bounded diagnostic detail defined by the schema.
- Clock skew and missing source time produce explicit diagnostics or quality changes rather than silent substitution.

## Idempotency

The runtime must derive deterministic message/value identity from trusted Gateway context, route, source message identity, record position, and parameter UUID. Consumers must tolerate JetStream redelivery.

## Invalid input

Invalid messages or values produce structured diagnostics containing stage, code, safe explanation, exact definition identities, message identity, and a permitted raw-payload reference. They do not silently disappear or enter validated telemetry storage.

## Evolution

This is the first supported contract. Additive changes may extend `v1` only when old consumers remain valid. Incompatible changes after production require a new major wire identity and an explicit migration/support policy.

Static schema and fixture validation do not prove live broker ingestion, Runtime Bundle execution, TimescaleDB persistence, or deployed behavior.
