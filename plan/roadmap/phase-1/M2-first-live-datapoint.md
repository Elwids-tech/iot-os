# P1-M2: First Live Datapoint

**Status:** Planned
**Outcome:** A tenant-scoped device can publish JSON through MQTT or HTTP, the Go runtime validates and persists it using the activated profile version, and an operator can see the live value and diagnostics.
**Dependencies:** P1-M0 and the P1-M1 definition-activation path

## P1-M2-E1: Secure Native Ingress

### P1-M2-E1-S1 — Provision device-facing MQTT identity

**User story:** As an integrator, I want scoped MQTT credentials and a documented topic contract so that a device can publish without gaining access to another tenant or internal messaging.

**Acceptance criteria:** EMQX authenticates the connection, authorizes only assigned topics, derives tenant/device scope from trusted credentials, and cannot expose NATS or platform database credentials.

**Engineering tasks:**

- [ ] T1 — Define canonical and mapped JSON topic conventions plus versioning rules.
- [ ] T2 — Implement credential issuance, rotation, revocation, and redacted display in Laravel.
- [ ] T3 — Configure EMQX authentication, authorization, TLS-ready listeners, limits, and audit events.
- [ ] T4 — Add positive, cross-tenant, revoked, malformed-topic, and rate-limit tests.
- [ ] T5 — Publish copyable connection guidance in the admin experience.

### P1-M2-E1-S2 — Accept MQTT JSON telemetry

**User story:** As a device integrator, I want to publish canonical or simply mapped JSON so that standards-based devices use the shortest supported ingestion path.

**Acceptance criteria:** A valid message reaches the canonical ingestion boundary with trusted device identity, explicit profile version, receive timestamp, trace identifier, and bounded protocol metadata; invalid messages produce safe diagnostics.

**Engineering tasks:**

- [ ] T1 — Implement the EMQX-to-Go ingestion path and message-size/rate limits.
- [ ] T2 — Support canonical envelope JSON and governed path-based mapped JSON.
- [ ] T3 — Reject payload-supplied tenant authority and unknown device/profile identities.
- [ ] T4 — Emit structured diagnostics and permitted raw-payload references.
- [ ] T5 — Add fixtures for types, units, timestamps, invalid JSON, oversize data, and unknown signals.

### P1-M2-E1-S3 — Accept HTTP JSON telemetry

**User story:** As an API-based device integrator, I want an HTTPS ingestion endpoint with the same data semantics as MQTT so that transport choice does not change the platform model.

**Acceptance criteria:** The dedicated Go ingress authenticates the caller, applies tenant/device scope and rate policy, returns stable acceptance/error responses, and produces the same canonical event contract as MQTT.

**Engineering tasks:**

- [ ] T1 — Define device HTTP authentication, idempotency, batching, timeout, and response contracts.
- [ ] T2 — Implement the Go HTTP ingress with request limits and trusted receive time.
- [ ] T3 — Share validation and canonicalization behavior with the MQTT path.
- [ ] T4 — Add replay-safe idempotency and correlation identifiers.
- [ ] T5 — Add contract, load-boundary, cross-tenant, duplicate, and malformed-request tests.

## P1-M2-E2: Deterministic Go Telemetry Runtime

### P1-M2-E2-S1 — Validate and map canonical telemetry

**User story:** As an operator, I want telemetry interpreted by the exact active profile so that values remain deterministic and explainable.

**Acceptance criteria:** The Go runtime selects an explicit activated profile/mapping version, validates signal types and units, applies permitted transformations, and records the version and trace used for every accepted or rejected event.

**Engineering tasks:**

- [ ] T1 — Finalize the canonical ingestion contract, idempotency key, compatibility range, and diagnostic codes.
- [ ] T2 — Implement event decoding, identity checks, profile lookup, type/unit validation, and bounded transformations.
- [ ] T3 — Implement duplicate detection and JetStream redelivery tolerance.
- [ ] T4 — Separate accepted telemetry, invalid-event diagnostics, and dead-letter/replay flows.
- [ ] T5 — Add cross-language golden fixtures and deterministic replay tests.

### P1-M2-E2-S2 — Persist telemetry and current state

**User story:** As an operator, I want recent history, latest value, quality, and presence state so that I can understand whether equipment is reporting normally.

**Acceptance criteria:** Accepted points are stored idempotently in TimescaleDB; latest values and presence are queryable through scoped internal capabilities; restart and redelivery do not create incorrect duplicates or state.

**Engineering tasks:**

- [ ] T1 — Define telemetry, diagnostic, latest-value, and presence storage ownership and retention.
- [ ] T2 — Implement batched TimescaleDB persistence and safe retry behavior.
- [ ] T3 — Implement latest-value and heartbeat/presence state with explicit quality.
- [ ] T4 — Expose narrowly scoped internal query and health interfaces to Laravel.
- [ ] T5 — Test restart, out-of-order time, late data, duplicate delivery, clock skew, and database unavailability.

## P1-M2-E3: Operator Live-Data Experience

### P1-M2-E3-S1 — See device status and latest values

**User story:** As an operator, I want a device operations page showing connectivity, last report, quality, and latest signals so that I can identify a problem quickly.

**Acceptance criteria:** The portal presents authorized latest state and status in operational language, distinguishes broker connection from telemetry presence, and handles loading, stale, never-seen, degraded, and unavailable states.

**Engineering tasks:**

- [ ] T1 — Add Laravel query services and public API resources over scoped runtime capabilities.
- [ ] T2 — Build the portal device overview from shared shadcn Card, Badge, Alert, Empty, Skeleton, and Table patterns.
- [ ] T3 — Show active profile version, last observation/receipt, clock skew, and quality.
- [ ] T4 — Add authorized curated realtime updates through NATS and Laravel Reverb.
- [ ] T5 — Add responsive, accessibility, tenant, stale-state, and unavailable-runtime tests.

### P1-M2-E3-S2 — Inspect telemetry history and ingestion failures

**User story:** As an operator or integrator, I want to inspect recent measurements and safe ingestion diagnostics so that I can distinguish device, mapping, and platform failures.

**Acceptance criteria:** Authorized users can query bounded history, select signals and time range, see quality and gaps, and trace a rejected sample without exposing secrets or unsafe payload data.

**Engineering tasks:**

- [ ] T1 — Define bounded query, aggregation, pagination, and retention-aware API contracts.
- [ ] T2 — Build governed chart components in `packages/charts` using the shared shadcn Chart foundation.
- [ ] T3 — Build diagnostic list/detail views with stage, code, profile version, adapter version, and trace ID.
- [ ] T4 — Add CSV/export deferral messaging rather than an ungoverned data dump.
- [ ] T5 — Test large ranges, empty data, gaps, poor quality, unavailable storage, and redaction.

## Milestone Demonstration

An administrator activates a device profile, provisions MQTT credentials, publishes valid and invalid JSON, and sees the live value and rejection diagnostic in the portal. The same signal is then accepted through HTTP with identical semantics. Restarting the Go runtime rebuilds its definitions and current state without duplicate telemetry.

## Exit Criteria

- MQTT and HTTP share one canonical contract and diagnostic model.
- Tenant identity is derived from authenticated context, never trusted from payload data.
- Every stored point is traceable to an explicit profile/mapping version.
- Presence is not inferred solely from broker connection.
- The portal exposes live state without direct access to Go, NATS, EMQX, or TimescaleDB.

