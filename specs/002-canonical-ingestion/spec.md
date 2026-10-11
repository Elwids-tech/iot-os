# Feature Specification: Canonical Telemetry and Internal Event Contracts

**Feature Branch**: `spec/002-canonical-ingestion`

**Created**: 2026-10-11

**Status**: Draft

**Input**: User description: "Today the only way telemetry enters the platform is Sparkplug B over MQTT. Vendor devices with native payloads go through a per-tenant Node-RED runtime whose QuickJS decoder output is re-encoded as Sparkplug and published to a per-tenant Mosquitto broker, only so the Go runtime can ingest it. Internal messages between Laravel and Go (control events from Laravel's outbox, ~16 runtime event types posted back to Laravel, the full `/state` snapshot) are untyped maps on both sides (`map[string]any` in Go; Laravel only validates that `payload` is an array). The original architecture planned a canonical ingestion contract that was never built (ADR-005, ADR-010, ADR-014 in docs/adr record what was built instead). Outcome wanted for THIS spec (contracts only — a bounded first step): (a) a versioned canonical telemetry envelope — the single shape every protocol adapter (Sparkplug, vendor MQTT decoders, and future HTTP JSON, OPC UA or polling adapters) hands to the platform's ingestion — covering tenant and device identity derived from authenticated connections (never from payload), source/protocol provenance, observed vs received time, per-parameter values with quality, units, sequence/dedup identity, and versioning rules; (b) versioned schemas for every internal Laravel↔Go message (control events, runtime events, the reconciliation snapshot) with golden fixtures; and (c) the requirement that both the PHP and Go sides validate against these contracts in their test suites and in CI, rejecting versions they don't support. It must not change runtime behaviour yet: existing Sparkplug ingestion, adapters and the internal HTTP protocol keep working; later specs (canonical ingestion in Go; a multi-tenant Go adapter service replacing per-tenant Node-RED; incremental control-plane sync) build on these contracts. Respect the constitution (Laravel owns intent, Go executes; tenant identity from authenticated connections; contracts first; at-least-once with idempotent consumers; durable messaging principle)."

## Context

Telemetry reaches the platform only as Sparkplug B. Devices that speak their
manufacturer's own payload publish to a per-tenant ingress broker (or a vendor
broker), are decoded by a sandboxed tenant decoder, and are then re-encoded as
Sparkplug and published to the shared platform broker purely so the runtime can
ingest them. That forces every future protocol through the same detour and loses
information the decoder had: receipt time, the decoder's message identifier and
units are dropped, and provenance rides in Sparkplug metric properties. The
messages the control plane and the runtime exchange (control messages, runtime
events and the reconciliation snapshot) have no enforced shape on either side, and
the few contracts that exist have already drifted from what is sent (see
[research.md](research.md)).

This feature defines the contracts only. Three later specs build on it: canonical
ingestion in the runtime, a multi-tenant adapter service that replaces the
per-tenant adapter runtimes, and incremental control-plane synchronisation. Apart
from logging and counting contract violations in the running system, nothing that runs
today changes behaviour as a result of this feature.

**Terms used in this spec**

- **Control plane**: the platform component that owns definitions, authorization and
  public APIs, and sends intent (activations, commands, deployments) to the runtime.
- **Runtime**: the platform component that ingests telemetry, evaluates automation and
  reports observed state back to the control plane.
- **Adapter**: anything that turns a device protocol into platform telemetry: the
  runtime's own Sparkplug handling, tenant vendor decoders, and future HTTP JSON,
  OPC UA or polling adapters.
- **Trusted ingress boundary**: the platform-owned point where a message arrives over
  an authenticated connection (broker credential, adapter deployment, token) and where
  organization identity is established. Tenant-written decoder code is never part of
  it.
- **Contract**: a versioned, machine-readable description of a message with golden
  examples that must validate (valid examples) or must fail (invalid examples).

## Clarifications

### Session 2026-10-11

- Q: Are source lifecycle signals (online/offline, parameter announcement for discovery) part of this contract set, or do they stay protocol-specific until the ingestion spec? → A: Part of this spec: companion contracts for source presence and source announcement, under the same trusted-context rules as the telemetry envelope.
- Q: Should consumers check message content against the contracts in the running system now, or only in tests? → A: Live checking that logs and counts violations but never refuses or changes processing; refusal comes in later specs.
- Q: Within a supported major version, should readers ignore unknown fields or reject them? → A: Tolerate unknown fields in internal control-plane/runtime messages; reject them in the canonical envelope and its companion lifecycle messages.
- Q: Where may a platform device identity appear in an envelope? → A: The source address is always required; a platform device identity is optional and appears only in the trusted context, when the authenticated credential identifies the device or the ingress resolved a platform binding; ingestion re-verifies it.
- Q: Does "every internal message" include the runtime read endpoints the control plane calls (latest values, history, captures, compile/simulate, timelines)? → A: No. They are out of scope and remain a separate roadmap item (typed runtime gateway).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Adapter authors target one versioned telemetry envelope (Priority: P1)

An adapter author (a platform or integration engineer building or maintaining any
adapter) describes what a source reported (one source device's parameter values with
their times, quality, units and provenance) in a single versioned canonical telemetry
envelope. They check their output against the contract and learn the rules from
worked examples for every source that exists today (native Sparkplug and vendor
decoder output) and for at least one future protocol (HTTP JSON).

**Why this priority**: The envelope is the foundation the later ingestion and adapter
specs build on. Without it each adapter keeps inventing its own shape, and vendor
data keeps detouring through Sparkplug and losing information on the way.

**Independent Test**: Using only the published envelope contract, its documentation
and its examples: every valid example validates, every invalid example fails with a
stated reason, and every existing source has an equivalent envelope example plus a
field-by-field mapping that shows nothing the platform uses today is lost.

**Acceptance Scenarios**:

1. **Given** the existing native Sparkplug golden fixtures (birth, data with aliases,
   death), **When** their data messages are expressed as envelopes, **Then** each
   envelope validates and every piece of information ingestion uses today (source
   address, metric name and value, datatype, per-metric timestamp, historical flag,
   sequence and session) has a defined place in the envelope.
2. **Given** a vendor decoder output (source device identifier, metrics with units,
   optional observed time and message identifier), **When** it is expressed as an
   envelope, **Then** it validates and carries the adapter, adapter revision and
   installation provenance in typed fields rather than protocol-specific property
   bags.
3. **Given** an envelope whose decoded content claims an organization or a platform
   device identity, **When** it is validated, **Then** it is rejected, because
   organization and platform identity can only appear in the trusted context set by
   the trusted ingress boundary.
4. **Given** a source that reports no clock time, **When** its observation is expressed
   as an envelope, **Then** the envelope is valid, carries the received time assigned
   at the trusted ingress boundary, and states that its effective time comes from
   receipt.
5. **Given** an envelope that declares a contract version the reader does not support,
   **When** it is checked, **Then** it is refused with an "unsupported version" reason
   and nothing in it is applied.
6. **Given** the same source message delivered twice, **When** the two envelopes are
   built under the documented identity rules, **Then** both carry the same message
   identity.
7. **Given** the native Sparkplug birth and death fixtures and a vendor source seen for
   the first time, **When** they are expressed with the companion lifecycle contracts,
   **Then** births become source announcements (parameters, types, units), deaths
   become source presence changes, and both validate under the same trusted-context
   rules as the envelope.
8. **Given** an envelope or lifecycle message with a field its contract version does
   not define, **When** it is validated, **Then** it is rejected.

---

### User Story 2 - Every internal control-plane and runtime message has a versioned contract (Priority: P2)

A platform maintainer can look up the exact shape of every message the control plane
and runtime exchange today: each control message type, each runtime event type, the
wrappers used to hand control messages over and to deliver runtime events, and the
reconciliation snapshot. Each has a version identifier, golden valid examples and
invalid examples.

**Why this priority**: These messages carry activations, commands, deployments,
presence and alert transitions. They are untyped on both sides today, and drift
between the published contracts and what is actually sent already exists. Typing
them reduces risk immediately and is a prerequisite for incremental synchronisation.

**Independent Test**: Compare the message types the control plane writes and the
runtime emits (and each side handles) with the contract set: every type has exactly
one current contract, and every example validates or fails as labelled.

**Acceptance Scenarios**:

1. **Given** the seven control message types the control plane sends today (device
   activation, deactivation and command; geofence rule deployment; automation
   deployment; connection change; retention settings change), **When** the contract
   set is inspected, **Then** each type has a contract and valid examples that cover
   each variant (for example, activation with each supported device configuration
   version, and deployments that activate and that disable).
2. **Given** the runtime event types the runtime sends today (outcome of activation
   and deactivation; device, gateway and connection presence; discovery birth and
   presence; command status; runtime heartbeat; retention cleanup; workflow deployment,
   suspension, transition and membership; automation intent), **When** the contract
   set is inspected, **Then** each type has a contract and at least one valid and one
   invalid example.
3. **Given** the reconciliation snapshot as it is served today, **When** its contract
   is inspected, **Then** it describes the current full shape (as-is, not redesigned)
   and its example spans at least two organizations, a broker connection, and a device
   with both desired and applied configuration.
4. **Given** a message type that the control plane or the runtime sends or handles but
   that has no contract, **When** the automated checks run, **Then** they fail and name
   the uncovered type.

---

### User Story 3 - Both sides prove conformance automatically and refuse unsupported versions (Priority: P3)

When a maintainer changes a producer or consumer of any contracted message on either
side, the automated test suites of both sides and the pull request checks fail if the
produced output no longer matches its contract, if a contract changes without its
examples, or if a consumer accepts a version it does not support.

**Why this priority**: Contracts that nobody enforces drift; the existing drift shows
it. Enforcement turns the contracts from documentation into a guarantee, but it only
has value once the contracts in Stories 1 and 2 exist.

**Independent Test**: Seed deliberate breaking changes (drop a required field from a
producer, add an undeclared field, rename a message type, change a version identifier,
edit a contract without updating its examples) and confirm the checks of the affected
side catch each one before merge.

**Acceptance Scenarios**:

1. **Given** a producer change that omits a required field, **When** that side's
   automated tests run, **Then** they fail and name the message type and the field.
2. **Given** a contract change whose examples were not updated, or that the other side's
   tests no longer satisfy, **When** the pull request checks run, **Then** they fail.
3. **Given** a message that declares a version its consumer does not support, **When**
   the consumer receives it in its tests, **Then** it is refused with an outcome that is
   distinguishable from other failures, and nothing in it is partially applied.
4. **Given** the committed telemetry event produced for an adapter-sourced reading,
   **When** it is checked against its published contract, **Then** the contract and the
   producer agree (the drift found in research is resolved by correcting the contract to
   describe what is sent today).
5. **Given** an internal message of a supported type whose content breaks its contract,
   **When** a consumer receives it in the running system, **Then** the consumer logs and
   counts one violation for that message type and processes the message exactly as it
   does today.
6. **Given** an internal message with an extra field its contract version does not
   define, **When** a consumer receives it, **Then** the field is ignored and no
   violation is counted.

---

### Edge Cases

- **Identity in the payload.** Decoded content that names an organization, a different
  device or a broker credential is invalid; identity comes only from the trusted
  context. A conformance example proves that one organization's adapter cannot produce
  a valid envelope attributed to another organization.
- **No source time, or untrustworthy source time.** The envelope stays valid with
  received time only and marks the effective time as receipt-derived. Future or very
  old source times are carried as reported and flagged as such; clock policy belongs to
  ingestion, not to the contract.
- **Several values for one parameter.** Buffered or historical uploads may carry the
  same parameter several times with different observation times; this is valid. Two
  values for the same parameter at the same observation time make the envelope
  invalid.
- **Value that could not be decoded.** It is reported with bad quality and a reason,
  never dropped silently and never replaced with zero.
- **Values outside the supported range.** Integers beyond the documented safe range,
  non-finite numbers and nested structures are invalid; complex data must be
  decomposed into separate parameters.
- **Sequence gaps and resets.** Gaps, wraparound and device restarts are expressed with
  a sequence and a session or epoch identifier; deciding what a gap means belongs to
  ingestion.
- **Redelivery.** The same source message produces the same message identity. When a
  source offers no sequence, message identifier or time, the identity is assigned once
  at the trusted ingress boundary, and duplicates created before that point cannot be
  recognised; the documentation states this limit.
- **Oversized envelopes.** More values than the limit, or an encoded size above the
  limit, make the envelope invalid.
- **Unknown version.** A message that declares an unsupported version is refused, never
  guessed at or partially applied.
- **Unknown fields inside a supported version.** Internal control-plane and runtime
  messages: ignored, so additive changes and messages queued across an upgrade keep
  working, and not counted as violations. Canonical envelope and lifecycle messages:
  rejected (FR-030).
- **Malformed internal message in the running system.** Logged and counted as a
  violation, then processed exactly as today; never refused because of the check
  (FR-031).
- **Device identity that does not match the bindings.** An envelope whose trusted
  context names a platform device that the platform's own bindings do not associate
  with that source address and organization is rejected by ingestion with
  `device_mismatch` (FR-004; the check itself ships with the ingestion spec).
- **A type that exists in code but not in the contracts** (or the reverse) fails the
  coverage check.
- **Messages in flight across an upgrade.** Control messages and runtime events queued
  before an upgrade may be read by the newer release; every contract version that can
  still be in flight remains readable until the queues have drained.
- **Lifecycle signals.** A source going online or offline, and a source announcing
  its parameters (which Sparkplug births and deaths provide today), use the companion
  presence and announcement contracts (FR-017). A source that never announces itself
  can still send telemetry; discovery simply has no announcement for it. Presence may
  be `unknown` when the adapter cannot tell.

## Requirements *(mandatory)*

### Functional Requirements

**Canonical telemetry envelope**

- **FR-001**: The platform MUST define one versioned canonical telemetry envelope
  contract that every adapter hands to ingestion, whatever the protocol (native
  Sparkplug, vendor decoders, and future HTTP JSON, OPC UA or polling adapters).
- **FR-002**: An envelope MUST carry observations from exactly one source device; a
  gateway that reports several devices produces one envelope per device.
- **FR-003**: An envelope MUST separate a **trusted context** from its **observed
  content**. The trusted context (organization, the authenticated connection or
  adapter deployment the message arrived through, and adapter and revision identity)
  is set only by the trusted ingress boundary from the authenticated connection and
  platform-owned configuration. The observed content (source address, values, times,
  quality, units) is produced by protocol decoding, which may be untrusted tenant code.
  The contract MUST make it impossible to express organization or platform device
  identity in the observed content.
- **FR-004**: An envelope MUST carry the source address as the protocol knows it (for
  example a Sparkplug group, edge node and device; a manufacturer serial; a topic or
  endpoint) so that platform-owned configuration can bind it to a platform device. The
  source address is always required. A platform device identity MAY appear only in the
  trusted context, and only when the authenticated credential itself identifies the
  device (for example a per-device credential) or the trusted ingress boundary resolved
  a platform-owned binding; the trusted context MUST state which of the two applies.
  Ingestion re-verifies the identity against its own bindings and rejects a mismatch
  with the `device_mismatch` rejection code defined here; because no live component
  consumes the envelope in this feature (FR-033), performing that re-verification is
  delivered by the canonical ingestion spec, and this feature delivers the contract
  rule, the code and an example of the rejection.
- **FR-005**: An envelope MUST carry provenance in typed fields: protocol family; the
  adapter and its immutable revision when an adapter produced it; the installation
  identity when known; a bounded set of safe transport details (for example topic,
  retained flag, delivery quality of service); and an optional reference to a retained
  raw payload. Provenance MUST NOT contain secrets, credentials or raw payload
  content.
- **FR-006**: An envelope MUST carry the received time assigned at the trusted ingress
  boundary; it MAY carry a source observation time for the whole envelope and for each
  value. Each value MUST state where its effective time came from using the platform's
  existing vocabulary (source, receipt, corrected future time, derived). Times MUST be
  expressed in UTC with at least millisecond precision.
- **FR-007**: Each value MUST name the parameter as the adapter reports it (a protocol
  metric name, or a device profile parameter key when the decoder already maps to the
  profile, as vendor decoders do today) and carry a typed value from a closed set
  aligned with the platform's parameter types (boolean, integer, number, string,
  timestamp, bytes), or an explicit "no value" with a reason. Integer ranges,
  finiteness of numbers and maximum string and byte lengths MUST be documented. Nested
  structures are not allowed.
- **FR-008**: Each value MUST carry a source quality from a closed set (good,
  uncertain, bad) and MAY carry the source's native quality code and a reason. Sources
  with no notion of quality report good for values that decoded successfully. A value
  that failed decoding is reported as bad with a reason rather than dropped or
  replaced with zero.
- **FR-009**: Each value MAY carry the unit the source reported. When present it is a
  symbol from the platform unit catalogue or is explicitly marked as a custom unit. The
  envelope never implies a conversion; conversion stays with ingestion and device
  configuration.
- **FR-010**: Each value MUST be markable as historical (backfilled or buffered), so
  that it never counts as live evidence.
- **FR-011**: An envelope MAY carry several values for the same parameter with
  different observation times; two values for the same parameter with the same
  observation time make it invalid.
- **FR-012**: Each envelope MUST carry a message identity that stays the same across
  retries and redelivery of the same source message. The identity MUST be derived
  deterministically from source facts when they exist, in a documented order of
  precedence (source sequence with its session or epoch, source message identifier,
  source observation time). When no source facts exist, the trusted ingress boundary
  assigns it once at first receipt, and the documentation states that duplicates
  created before that point cannot be recognised. An envelope MAY additionally carry
  the source sequence and session or epoch for gap detection.
- **FR-013**: The contract MUST define limits consistent with today's: at most 2,000
  values per envelope and at most 1 MiB encoded size, plus documented maximum lengths
  for identifiers and strings. Exceeding a limit makes the envelope invalid.
- **FR-014**: An envelope MUST declare its contract version. Adding optional fields is
  allowed within a major version; removing a field or changing its meaning requires a
  new major version. Readers declare the versions they support and refuse others with
  an "unsupported version" outcome. Adapter revision and device profile versions stay
  separately traceable from the contract version.
- **FR-015**: The contract set MUST include a structured rejection diagnostic for an
  invalid envelope: the stage that rejected it, a code from a closed list, a safe
  explanation, the envelope's message identity and declared version, and the adapter
  revision. It MUST NOT include raw payload content beyond a reference.
- **FR-016**: The envelope documentation MUST include a field-by-field mapping from
  each existing source (native Sparkplug births, data messages and deaths, and the
  vendor decoder output) to the envelope and the lifecycle contracts, listing any
  source information that is intentionally not carried and why.
- **FR-017**: The contract set MUST include two companion lifecycle contracts that share
  the envelope's trusted context, source address, provenance, received time, message
  identity, versioning and unknown-field rules:
  - **Source presence**: a source became `online`, `offline` or `unknown`, with an
    optional reason, the session or epoch it refers to, and an optional observation
    time.
  - **Source announcement**: the parameters a source says it reports (name, value type,
    optional unit, optional writable flag), with an announcement revision that changes
    whenever the set of names or types changes, so discovery can detect changes as
    Sparkplug births do today.
  Neither carries values; values travel only in telemetry envelopes.

**Internal control-plane and runtime messages**

- **FR-018**: Every control message type the control plane sends to the runtime today
  MUST have a versioned contract with valid examples that cover each variant and at
  least one invalid example: device activation (with each supported device
  configuration version), device deactivation, device command, geofence rule
  deployment, automation deployment, connection change, and retention settings change.
- **FR-019**: Every runtime event type the runtime sends to the control plane today
  MUST have a versioned contract with at least one valid and one invalid example: device
  applied, device failed, device deactivated, device presence, gateway presence,
  connection presence, discovery birth, discovery presence, command status, runtime
  heartbeat, retention cleanup, workflow deployment, workflow suspended, workflow
  transition, workflow membership, and automation intent (16 types).
- **FR-020**: The delivery wrappers and the remaining runtime-to-control-plane request
  MUST be contracted as they exist today: the request and response used to claim
  control messages, the acknowledgement of a claimed message (including the stale-lease
  outcome), the envelope used to deliver a runtime event and its possible outcomes
  (accepted, duplicate, stale, unknown reference, refused), and the automation command
  authorization check. Where a wrapper lacks something later specs need (for example,
  the runtime event envelope has no occurrence time or contract version of its own),
  the gap is documented rather than changed here.
- **FR-021**: The reconciliation snapshot as served today MUST have a versioned contract
  that describes its current full shape, with an example spanning at least two
  organizations. It describes the existing snapshot; the incremental model belongs to a
  later spec and will be a new version. Fields that carry secrets (broker credentials)
  MUST be marked as secret in the contract, and golden examples MUST use placeholder
  values only.
- **FR-022**: Where an existing contract disagrees with what is sent today, the contract
  MUST be corrected to describe the current behaviour. Known cases: committed telemetry
  readings and the internal telemetry message carry adapter provenance fields (and the
  telemetry message a generation) that their contracts forbid; the device activation
  message carries organization, device and operation identities its contract forbids;
  the device command message carries a generation its contract lacks and may carry an
  empty session its contract rejects; and device configurations for adapter-backed
  devices carry an adapter binding that both configuration contracts forbid. A
  behaviour judged to be a defect is recorded for a later spec rather than changed
  here.
- **FR-023**: Each contract MUST state its producers and consumers, its delivery
  guarantee (at least once), the identity consumers deduplicate on, and the fencing
  fields (generation, operation, session) they compare.
- **FR-024**: Internal contracts MUST use platform-assigned identities only, and any
  user reference MUST be the integer user identifier.

**Enforcement**

- **FR-025**: The control plane's automated tests MUST prove that every message it
  produces conforms to its closed contract (each control message type, claim and
  acknowledgement responses, the reconciliation snapshot), that it consumes every
  valid runtime event example successfully, and that its live check (FR-031) counts a
  violation for every invalid runtime event example while processing continues as
  today.
- **FR-026**: The runtime's automated tests MUST prove the mirror: every message it
  produces conforms to its closed contract (runtime events, claim and acknowledgement
  requests), it consumes every valid control message and snapshot example
  successfully, and its live check counts a violation for every invalid example. A
  reference reader for the canonical envelope and lifecycle contracts MUST accept every
  valid example and refuse every invalid one with the documented diagnostic code.
- **FR-027**: The automated checks MUST fail when a message type is produced or handled
  in code without a contract, or when a contract lacks either producer-side or
  consumer-side conformance tests.
- **FR-028**: A contract change MUST update its examples in the same change. The checks
  MUST fail when an example no longer validates as labelled, and when a change that
  removes a field or changes its meaning keeps the same major version.
- **FR-029**: The pull request checks MUST run contract validation and both sides'
  conformance tests on every pull request, and a failure MUST block merging.
- **FR-030**: Within a supported major version, unknown fields MUST be handled as
  follows:
  - **Internal control-plane and runtime messages**: readers ignore fields they do not
    know, and the live check does not count them as violations. Producers are tested
    against the closed contract, so they never send a field the contract does not
    define.
  - **Canonical envelope and lifecycle contracts**: readers reject fields their
    supported version does not define. A new optional field becomes usable only after
    every reader supports the version that adds it.
- **FR-031**: Consumers MUST keep refusing message types and versions they do not
  support, as both sides already do in the running system (the runtime dead-letters an
  unknown control message type; the control plane refuses an unknown runtime event type,
  which the runtime then dead-letters), and automated tests MUST prove it for every
  consumer. In addition, every consumer of an internal message, including control
  messages, every control-plane response and the reconciliation snapshot in the
  runtime, and runtime events and every runtime request in the control plane, MUST
  check each received message against its contract in the running system and, on a
  violation:
  - write one structured log entry naming the message type, contract version, message
    identity and the failing locations, without message values or secrets;
  - increment a violation count per message type and contract version that operators
    can read from the side's existing status or metrics output;
  - process the message exactly as it would without the check. The check MUST NOT
    refuse, delay, retry or alter a message, and a failure inside the check itself is
    counted and logged, never propagated.
  Refusing non-conforming content is left to later specs.

**Compatibility**

- **FR-032**: This feature MUST NOT change what flows on any live path: native Sparkplug
  ingestion, the adapter runtimes and the Sparkplug they publish, the interfaces between
  the control plane and the runtime (their operations, outcomes and message content),
  the runtime's internal message streams, and stored telemetry stay as they are, except
  for the violation logging and counting in FR-031.
- **FR-033**: No component emits or consumes the canonical telemetry envelope on a live
  path as part of this feature.
- **FR-034**: Native Sparkplug devices and vendor devices behind an adapter MUST keep
  delivering telemetry, verified in the rebuilt local stack with the Sparkplug and
  vendor simulators before and after the change.

### Key Entities *(include if feature involves data)*

- **Canonical telemetry envelope**: what one adapter reports for one source device at
  one moment. Has a contract version, message identity, trusted context, source
  address, provenance, received time, optional observation time, and one or more
  values.
- **Trusted context**: organization, authenticated connection or adapter deployment,
  adapter and revision, and optionally the platform device with the basis for it
  (credential or binding). Set only by the trusted ingress boundary.
- **Source address**: how the protocol names the device (Sparkplug hierarchy,
  manufacturer serial, topic, endpoint). Bound to a platform device by platform-owned
  configuration.
- **Value**: source parameter name, typed value or explicit "no value", quality,
  optional unit, optional observation time, time source, historical flag.
- **Message identity**: the deduplication key for an envelope, stable across retries and
  redelivery, plus optional sequence and session for gap detection.
- **Rejection diagnostic**: stage, code, safe explanation, message identity, declared
  version and adapter revision for an envelope that was refused.
- **Source presence**: a lifecycle message saying a source is online, offline or
  unknown, with reason and session; shares the envelope's trusted context and identity
  rules.
- **Source announcement**: a lifecycle message listing the parameters a source reports
  (name, type, unit) with an announcement revision; carries no values.
- **Contract violation record**: the log entry and count produced when a live check
  finds a received internal message that breaks its contract.
- **Control message**: intent from the control plane (activation, deactivation, command,
  deployment, connection change, retention change), identified by a unique id and
  fenced by generation or operation.
- **Runtime event**: observed state from the runtime (outcomes, presence, discovery,
  command status, heartbeat, cleanup, workflow events, automation intent), identified by
  a unique event id and fenced by generation, operation or session.
- **Delivery wrapper**: the claim, acknowledgement and event-delivery messages that move
  control messages and runtime events between the two sides.
- **Reconciliation snapshot**: the runtime's periodic full view of connections, devices
  and their desired and applied configuration across organizations.
- **Golden example**: a stored example labelled valid or invalid that every producer and
  consumer test reads.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of the messages exchanged between the control plane and the runtime
  today (7 control message types, 16 runtime event types, the delivery wrappers, the
  automation command check and the reconciliation snapshot) have a versioned contract
  with at least one valid and one invalid example.
- **SC-002**: 100% of the information today's ingestion and discovery use from each
  existing source (every field in the Sparkplug golden fixtures, including births and
  deaths, and in the vendor decoder output) has a documented place in the envelope or
  the lifecycle contracts; anything not carried is listed with a reason, and nothing is
  dropped silently.
- **SC-003**: In a seeded-fault exercise of at least 10 deliberate breaking changes
  spread across the control plane, the runtime and the envelope (missing required
  field, undeclared field, renamed type, unsupported version, contract edited without
  its examples), 100% are caught by the pull request checks before merge.
- **SC-004**: 100% of consumers refuse a message that declares an unsupported version in
  their tests, with an outcome distinguishable from other failures.
- **SC-005**: Zero behaviour change: existing test suites pass with no changed
  expectations other than the contract corrections under FR-022, and in the rebuilt
  stack telemetry from the Sparkplug simulator and from the vendor simulator through an
  adapter is stored and shown exactly as before.
- **SC-006**: An engineer who has not worked on the platform can write a valid envelope
  for a new HTTP JSON device using only the contract documentation and examples in under
  30 minutes, confirmed by a reviewer walkthrough.
- **SC-007**: Every case of contract drift listed in FR-022 is reported by the new checks
  before the correction and passes after it, showing the checks would have prevented
  it.
- **SC-008**: The added checks keep every continuous integration job within its current
  time limit and report in the same pull request check run as the code change.
- **SC-009**: In the rebuilt stack, after the contract corrections, running the Sparkplug
  and vendor simulators through activation, commands, a deployment and a deactivation
  produces zero live contract violations on either side, and a deliberately malformed
  runtime event raises the matching violation count by exactly one without changing how
  the event is handled.
- **SC-010**: The live checks add no more than 5% to the time each consumer spends
  handling a message, measured with the simulators before and after.

## Assumptions

- The control plane and the runtime are released together from one repository and run
  as a single runtime instance, so changing a contract and both sides in one pull
  request is acceptable. Mixed versions occur only for messages already queued when an
  upgrade happens.
- "Every internal message" means the control messages, runtime events, delivery
  wrappers, automation command check and reconciliation snapshot named in the
  description (confirmed in clarification). Out of scope: the runtime query endpoints the control plane calls for reads (latest values, history,
  captures, validation, workflow compile and simulate, timelines); the adapter manager's
  private interface and the adapter runtime's event reporting; and the public API, which
  spec 001 covers. The committed telemetry feed is already contracted and is only
  corrected (FR-022).
- Envelope value types follow the platform's parameter types and the Sparkplug datatypes
  the runtime supports today. Sparkplug data sets, templates and custom codecs remain
  unsupported.
- Envelope limits follow existing limits: 2,000 readings per telemetry message and 1 MiB
  decoder input.
- One envelope covers one source device. Gateway fan-out produces several envelopes.
- Command downlink (encoding commands for vendor devices) is out of scope; adapters are
  uplink-only today.
- Both sides already refuse unknown message types (and therefore unknown type versions)
  in the running system; this feature keeps that behaviour. Live content checks only
  log and count (FR-031); they never change how a message is processed.
- New contracts live with the existing contracts and follow the existing contract rules
  (versioned identifiers, golden examples, consumers refuse unsupported versions).
  Contract technology, code generation and file layout are decided in the plan, using
  the options in [research.md](research.md).
- The later specs this feature enables are: canonical ingestion in the runtime, a
  multi-tenant adapter service replacing the per-tenant adapter runtimes, and incremental
  control-plane synchronisation replacing the full snapshot poll.
