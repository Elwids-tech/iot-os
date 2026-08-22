# P1-M3: Industrial Connectivity

**Status:** Planned
**Outcome:** Sparkplug B equipment and at least one Node-RED-managed industrial source can be discovered, approved, mapped, activated, observed, and diagnosed without leaking protocol-specific structure into the operational domain model.
**Dependencies:** P1-M2 canonical ingestion and diagnostics

## P1-M3-E1: Sparkplug B Interoperability

### P1-M3-E1-S1 — Process Sparkplug sessions and metrics

**User story:** As a Sparkplug gateway integrator, I want the platform to understand birth, death, data, aliases, and sequence state so that compatible equipment connects without proprietary JSON conventions.

**Acceptance criteria:** The Go runtime handles namespace topics, Protobuf payloads, NBIRTH/DBIRTH, NDEATH/DDEATH, NDATA/DDATA, aliases, sequence validation, rebirth, and current session state with safe diagnostics.

**Engineering tasks:**

- [ ] T1 — Define supported Sparkplug B version, namespace variants, limits, and test matrix.
- [ ] T2 — Implement topic parsing and Protobuf decoding in the Go runtime.
- [ ] T3 — Implement birth certificate, alias, sequence, rebirth, and presence state machines.
- [ ] T4 — Convert governed metrics to canonical telemetry without losing source traceability.
- [ ] T5 — Add conformance fixtures for reconnect, rebirth, alias reset, missing birth, duplicate sequence, and malformed payloads.

### P1-M3-E1-S2 — Govern Sparkplug discovery and mapping

**User story:** As an integrator, I want discovered nodes, devices, and metrics to remain candidates until approved so that external namespaces do not silently create operational assets.

**Acceptance criteria:** Laravel presents tenant-scoped discovery candidates, supports mapping group/edge/device/metric identifiers to gateways, devices, and signals, and activates an immutable binding version.

**Engineering tasks:**

- [ ] T1 — Define discovery-candidate and namespace-binding contracts.
- [ ] T2 — Publish discovery/runtime state from Go and project it into Laravel-owned records.
- [ ] T3 — Build approval, ignore, merge, and mapping workflows in the admin app.
- [ ] T4 — Reuse profile validation and definition activation for approved bindings.
- [ ] T5 — Add tests preventing unauthorized or accidental domain-resource creation.

## P1-M3-E2: Isolated Node-RED Adapter Runtime

### P1-M3-E2-S1 — Provision a restricted adapter runtime

**User story:** As a platform operator, I want Node-RED isolated behind platform controls so that proprietary onboarding does not grant broad access to the host or platform data.

**Acceptance criteria:** Node-RED runs with bounded compute, restricted network access, no Docker socket or database credentials, an approved pinned node palette, injected secret references, health checks, and versioned flow exports.

**Engineering tasks:**

- [ ] T1 — Build the restricted container and development/single-node profiles.
- [ ] T2 — Define approved nodes, dependency locking, image update, and vulnerability-review policy.
- [ ] T3 — Implement scoped credentials for canonical publish and command consumption.
- [ ] T4 — Export flow artifacts and dependency locks outside mutable runtime storage.
- [ ] T5 — Emit structured logs, metrics, health, revision, and failure status.
- [ ] T6 — Test prohibited database, Docker socket, secret, filesystem, and network access.

### P1-M3-E2-S2 — Deploy versioned adapter revisions

**User story:** As an integrator, I want to test and activate an adapter revision with fixtures so that a changed decoder cannot silently alter live data.

**Acceptance criteria:** Laravel owns the adapter version and desired state; Node-RED applies an immutable artifact, runs its fixture set, publishes observed status, and retains the prior revision for rollback.

**Engineering tasks:**

- [ ] T1 — Finalize the adapter artifact, manifest, configuration, fixture, and health contracts.
- [ ] T2 — Implement draft, validate, test, activate, fail, and rollback lifecycle in Laravel.
- [ ] T3 — Implement Node-RED revision application and readiness acknowledgement.
- [ ] T4 — Route uplink output only through canonical JetStream ingestion subjects.
- [ ] T5 — Test invalid dependencies, fixture failure, partial apply, restart, and rollback.

## P1-M3-E3: Managed Device Onboarding

### P1-M3-E3-S1 — Provide initial industrial adapter templates

**User story:** As an integration developer, I want supported templates for OPC UA, CoAP, API polling, and proprietary decoding so that I can start from governed examples rather than unrestricted blank flows.

**Acceptance criteria:** Each template declares transport mode, configuration schema, secret references, retry/timeout policy, canonical output, fixtures, health behavior, and supported limitations; at least one source is verified against a real or representative endpoint.

**Engineering tasks:**

- [ ] T1 — Create an OPC UA subscription/polling template and fixtures.
- [ ] T2 — Create a CoAP receive/polling template and fixtures.
- [ ] T3 — Create an authenticated HTTP API polling template and fixtures.
- [ ] T4 — Create a proprietary binary/encoded payload decoder example.
- [ ] T5 — Document support boundaries, network requirements, and command/downlink capability.
- [ ] T6 — Run the milestone end-to-end source through canonical ingestion and telemetry storage.

### P1-M3-E3-S2 — Guide managed onboarding in the admin experience

**User story:** As an integrator, I want a guided onboarding workspace so that samples, mappings, tests, activation, status, and diagnostics form one understandable workflow.

**Acceptance criteria:** The admin app supports source details, sample capture/upload, mapping review, fixture results, version activation, runtime status, and safe logs without requiring normal users to enter Node-RED.

**Engineering tasks:**

- [ ] T1 — Build the adapter onboarding step flow from shared shadcn form, step, table, code/sample, Alert, and status patterns.
- [ ] T2 — Add safe sample storage and permitted raw-payload references.
- [ ] T3 — Add mapping and expected-output review using profile and signal definitions.
- [ ] T4 — Expose desired/observed adapter revision and runtime health.
- [ ] T5 — Restrict direct Node-RED editor access to authorized integration developers and audit access.
- [ ] T6 — Add responsive, permission, failure, and rollback browser tests.

## Milestone Demonstration

A Sparkplug gateway publishes birth and data messages, its discoveries are approved and mapped, and the resulting signal appears through the same telemetry experience as native JSON. Separately, an OPC UA or other representative Node-RED-managed source is configured from a template, fixture-tested, activated, and observed without Node-RED writing to a platform database.

## Exit Criteria

- Sparkplug session state is maintained by Go and domain approval remains in Laravel.
- Sparkplug hierarchy does not become the site/asset model.
- Node-RED has no platform database or Docker socket access.
- Adapter artifacts, fixtures, revisions, and health are platform-owned and auditable.
- At least one adapter-managed protocol completes the full canonical ingestion journey.

