# Contracts

Cross-language contracts: JSON Schemas with golden fixtures, the pinned Sparkplug
protobuf, and shared catalogues. PHP, Go, TypeScript and Python tests read these
files directly; there is no generated `packages/contracts` package. Each schema sits
beside a `.fixture.json` that must validate against it.

| Directory | Contract | Used by |
| --- | --- | --- |
| [`devices/v1`](devices/v1) | Activation, command, telemetry and configuration v1 schemas; expression-evaluator parity cases | Runtime contract tests, PHP/Go parity tests |
| [`devices/v2`](devices/v2) | `device-configuration.v2` (adds incoming conversions); conversion parity cases | Laravel configuration snapshots, runtime |
| [`events/v1`](events/README.md) | `telemetry.committed.v1` | Runtime committed-telemetry feed and its consumers |
| [`rules/v1`](rules/v1) | Workflow v1, `geofence-rule.v1` definition, state, transition, deployment, simulation request and expected trace | Geofence rules |
| [`rules/v2`](rules/v2) | `automation-workflow.v2` DAG schema and a reference graph | DAG automation |
| [`location/v1`](location/v1) | `location-binding.v1`, `location-fix.v1`, 30 location scenarios | Location resolver, geofences, integration API |
| [`definitions/device-profiles`](definitions/README.md) | Example compiled profile definitions | Simulator preparation, seeders, tests |
| [`units/v1`](units/v1) | Unit catalogue (`units.json`) | Profile authoring (`GET /api/v1/units`) |
| [`sparkplug`](sparkplug) | Eclipse Tahu `sparkplug_b.proto` pinned in `upstream.json`, binary fixtures with `expected.json` | Runtime decoder, simulators ([Sparkplug](../docs/reference/sparkplug.md)) |

Check them with `.local/devices/python/bin/python tooling/verify-devices-contracts.py`
plus the Go and PHP test suites ([testing](../docs/dev/testing.md)).

## Rules

- Additive fields stay within a major version; removing a field or changing its
  meaning needs a new version (`…v2`). Producers state their version, and consumers
  reject versions they do not support instead of guessing.
- Identity and tenancy never come from a device payload. Contracts carry
  organization, device, configuration and generation identities assigned by the
  platform.
- A change to a contract changes its fixture in the same commit and keeps every
  consumer's tests green.

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
