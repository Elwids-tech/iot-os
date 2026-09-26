# Core platform priorities for vertical applications

**Status:** Draft delivery plan; user-directed priority, detailed behavior proposed
**Date:** 2026-09-23
**First use case:** Cattle location and geofence alerts
**Scope:** Extend the existing IoT core; no cattle application implementation or customer commitment is implied.

## Objective

Deliver a reliable location-to-alert workflow that an independent cattle application can consume. Keep the standard portal useful for customers who need only device monitoring, dashboards, rules, alerts, and reporting. Use subsequent customer requirements to justify additional generic capabilities.

This plan builds on the accepted [responsibility boundaries](../architecture/responsibility-boundaries.md), [target architecture](../architecture/target-architecture.md), and [definition lifecycle](../contracts/definition-activation.md). It sequences a focused subset of the broader roadmap; it does not mark other planned protocols or infrastructure as implemented.

## Current baseline and remaining gaps

Repository inspection on 2026-09-23 establishes source presence. Existing guides record earlier local verification; runtime tests were not rerun for this planning-only change. Older task statuses are not a reliable inventory of everything currently delivered.

**Delivery update, 2026-09-25:** P0's [committed telemetry events](../tasks/committed-telemetry-events.md) and [location contracts/fixtures](../tasks/location-contracts-and-fixtures.md) are implemented and verified locally. Evidence includes real database/broker recovery, the full Devices regression suite and 30 location scenarios through the rebuilt runtime. P1 rules/geofencing remains next. The baseline table below records the original planning assessment, not a claim that completed P0 work remains absent.

**P1 progress, 2026-09-25:** The [geofence evaluator/simulation slice](../tasks/geofence-evaluator.md) now provides typed definitions, polygon validation, sustained evidence and deterministic serialized-state replay, verified against the rebuilt runtime. P1 still requires Laravel authoring/activation and durable live execution; simulated transitions are not operational alerts.

| Capability | Current evidence | Remaining work for this outcome |
| --- | --- | --- |
| Organizations, users, permissions | `apps/api/app/Domain/Administration`, `Authentication`, and `Shared`; [Sanctum ADR](../decisions/ADR-008-laravel-sanctum-authentication.md) | Explicit application identities, tenant grants, token ability enforcement, rotation/revocation and quotas |
| Profiles and immutable device configuration | `apps/api/app/Domain/DeviceProfiles`, `Devices`; [Devices v1 delivery record](../tasks/devices-v1.md) | Location binding semantics and compatibility validation; preserve existing parameter and configuration identities |
| Sparkplug ingestion, history, state and manual commands | `services/runtime/internal/app`, `storage`, `devices`; [Devices guide](../../docs/devices-v1.md) | Committed telemetry events and location fixtures; real tag adapter after hardware discovery |
| Dashboards and device controls | `apps/portal/src/dashboards/registry.tsx`; [dashboards](../../docs/dashboards.md), [controls](../../docs/device-controls.md) | Location/alert views and later extraction of reusable components |
| Alarm templates | Profile models/compiler expose `alarm_templates` | Instantiated rules, runtime evaluation, state transitions and operational alert lifecycle |
| Stateful rules and geofencing | Assigned to Go in accepted architecture | Executable rule contracts, activation, durable state/timers, spatial operator and authoring UI |
| External integration events | Internal `iot.telemetry.device` precedes `Store.Persist`; `contracts/events/README.md` is a placeholder | Stable committed-event schema, reliable publication, delivery/recovery and tenant filtering |
| SDK | `packages/api-client/src/index.ts` uses browser cookie/session behavior | Server authentication/transport support and one independently consumable SDK |
| AI profile assistant | `apps/api/app/Domain/Assistant`; [assistant guide](../../docs/ai-assistant-v1.md) | Rule assistance is later work; existing tools do not establish an implemented rule engine |

Profile alarm templates are suggestions, dashboard thresholds are visual settings, and protocol presence is not GPS freshness. None substitutes for a server-side alert engine.

## Ownership boundaries

- **Laravel core:** Public APIs, tenant authorization, rule/geofence definitions and versions, activation, alert workflow, notification delivery, audit and command authorization.
- **Go runtime:** Ingestion, committed telemetry publication, deterministic rule evaluation, persisted rule state and timers, and authorized command transport. No per-observation calls to a vertical database.
- **React portal:** Generic rule/geofence authoring, simulation, live status and alert management using shared shadcn interactions.
- **Independent cattle application:** Animals, ranches, paddocks, time-bounded animal/tag assignments, customer workflows, business incidents and ERP transaction meaning. Own database and release lifecycle.
- **Application interface:** Tenant-scoped versioned APIs/events. No shared database writes or browser access to NATS, EMQX, runtime services or infrastructure credentials.

A cattle application may publish a paddock's geometry and device bindings as an immutable platform rule configuration. The cattle paddock remains its business source of truth; store its external reference/revision and synchronize explicitly. Generic platform geofences can also be authored directly for customers using only the standard portal.

## Delivery sequence

Each stage must be split into reviewable stories using the existing [definition of ready and done](phase-1/definition-of-ready-and-done.md). No calendar estimate is assigned before those stories and hardware requirements are understood.

| Order | Deliverable | Dependencies | Completion evidence |
| --- | --- | --- | --- |
| P0 | Committed telemetry feed and location contract/fixtures | Existing storage and ingestion | Rollback emits nothing; retry/crash recovery preserves one logical event; compatible GPS pairs can be replayed |
| P1 | Rules v1 with a geofencing operator | P0 | Versioned activation, simulated boundary crossings, durable state, stale-data handling and restart recovery |
| P2 | Alert lifecycle and initial notification channel | P1 | One alert per episode; acknowledgement and clearing are separate; delivery retry is observable |
| P3 | External application access and first SDK | P0; P2 for alert consumption | An independently running sample client recovers events and reads authorized state; cross-tenant access fails |
| P4 | Location/alert dashboard integration and reusable UI boundary | P1–P3 | Core portal and sample application use the same data/component contracts without importing portal source |
| P5 | Real tag integration and pilot acceptance | Confirmed hardware/transport plus P0–P4 | Hardware evidence meets agreed reporting, accuracy, loss/recovery and customer-isolation requirements |

**First product milestone:** P0–P2, demonstrated entirely with a deterministic location simulator. P3 turns that capability into an external-application foundation. Vendor protocol discovery can proceed when Laine responds without blocking generic simulator work.

### P0 — Durable data and location semantics

Implement [committed telemetry events](../tasks/committed-telemetry-events.md) first. Use an internal committed feed for rules; expose a separately authorized and projected integration contract in P3. An external delivery outage must not stop ingestion or internal rules.

Define location bindings over existing numeric parameters rather than introducing cattle fields into profiles:

- WGS84 latitude/longitude with explicit axis order, units and valid ranges; optional reported accuracy in metres.
- Both coordinates must come from one source fix with compatible timestamps/configuration and good quality. Never combine unrelated latest values to manufacture a location. A grouped-fix extension is required if a real adapter sends coordinates separately without a usable fix identity.
- Preserve observed time, trusted receipt time, timestamp provenance, historical flag and source event identity. Define behavior for absent, future or unreliable source time.
- Unknown accuracy remains unknown. Define whether it is allowed for a particular rule; never assume zero error.
- Keep device presence, location freshness and geometry result separate.

Add fixtures for inside, outside, boundary, jitter, re-entry, no fix, stale fix, duplicates, delayed/historical fixes, reconnect, configuration change and runtime restart. Reporting cadence and accuracy are configurable fixture inputs, not claims about Laine's tags.

### P1 — Rules engine with a geofencing node

Use a typed node registry and a small validated pipeline so the representation can support a visual editor. Start with source selection, quality/freshness filtering, numeric comparison, geofence membership, sustained-condition/debounce and alert-condition output. The first authoring UI can be structured forms showing that pipeline; an unrestricted drag-and-drop automation canvas is deferred.

Rule lifecycle: **draft → validate → simulate → activate → observe runtime acknowledgement → retire**. Activated artifacts are immutable. Persist desired and applied versions, activation failures and audit history. Profile alarm templates may prefill a draft; they never auto-activate rules.

Proposed v1 spatial scope is a validated simple polygon per geofence. Explicitly reject unsupported self-intersections, holes, multipolygons, polar/antimeridian cases and excessive geometry complexity rather than interpreting them silently. A later requirement can expand this contract.

Required semantics before implementation:

- Define whether an exact boundary is inside; proposal: boundary counts as inside, with a separate configured uncertainty band where accuracy/jitter prevents a reliable decision.
- Key state by tenant, rule version and device/binding revision. Configuration or assignment changes must not inherit an incompatible pending crossing.
- Use fresh eligible observations for live state. Delayed/historical data remains available for history and simulation but must not retroactively send live notifications or commands. Specify the event-time ordering/tie-break and allowed-lateness policy in the rule contract.
- A duration condition represents sustained evidence at an expected reporting cadence, not proof of continuous physical location. Missing or stale evidence changes evaluation to unknown; it must not complete an outside-duration timer or silently resolve an active alert.
- Maintain explicit inside/outside/unknown evaluation state, pending duration, last eligible observation and transition identity. Persist state, recovery checkpoint and emitted transition atomically or with an equivalent tested durable handoff.
- Timer expiry, duplicate delivery and restart must not emit duplicate logical transitions. Restored timers recheck freshness and active definition before firing.
- Pin geometry/binding/rule versions in transitions. A new assignment establishes a fresh baseline; the cattle application retains historical animal/tag identity for delayed records.
- Simulation uses the same evaluator with actions disabled. It cannot change live rule state, notifications or device commands.

Node type, configuration schema, input/output types and evaluator version form the extension boundary. No arbitrary tenant JavaScript, cyclic graphs or tenant-supplied Go code in the first engine.

### P2 — Alerts and notification delivery

Go emits deterministic condition transitions. Laravel owns one alert episode per rule/device occurrence, its acknowledgement, comments, audit and delivery attempts. Clearing the condition and acknowledging an alert are distinct operations. Silence/suppression affects delivery, not underlying condition truth.

Start with an in-app alert list/detail and one queued email channel, verified against the local mail sink. Define deduplication, cooldown/re-notification, recovery messages, recipient permissions and behavior when a rule/device is disabled. Real recipients/provider configuration belong to pilot setup.

Notification retries use a stable logical delivery ID. Internal jobs are idempotent; email providers may not offer exactly-once delivery, so record uncertain outcomes rather than promising duplicate-free email after every crash.

Expose activation failures, stale locations, evaluator lag, active alerts and failed deliveries. Tenant authorization covers alert content, recipients and deep links. Restarting a notification worker must not stop telemetry evaluation.

### P3 — Application access and the first SDK

Implement explicit machine/application identities and per-organization grants consistent with the existing Sanctum decision. Enforce token abilities **and** tenant/resource permissions. Add expiry, revocation/rotation, audit and bounded quotas; a token or organization header alone is not permission. Do not introduce delegated OAuth until a confirmed partner consent/SSO flow requires it.

Publish versioned API and integration-event contracts for device metadata, latest/history, rule activation state, alert lifecycle and command status. Start with signed webhooks and durable queued delivery if pilot throughput permits. Separate raw committed telemetry subscriptions from lower-volume alert/status subscriptions and measure delivery pressure before promising per-point webhooks at scale.

Specify signatures/replay protection, retry/backoff, dead-letter handling, subscriber checkpoints, retention/expiry behavior and historical reconciliation. Revoking access must stop pending delivery. Prevent webhook destination abuse through destination validation and network egress controls. A portal live-update channel is not a durable consumer interface.

Build one SDK selected by the first consuming application: PHP/Laravel or server-compatible TypeScript. Generate or validate request/event types against public contracts, provide pagination/errors, and retry only where operation semantics permit. Commands must retain existing idempotency and uncertain-delivery rules. Build a standalone reference consumer that maintains a projection using only public interfaces and its own storage.

### P4 — Dashboard integration and reusable presentation

Add a generic location/geofence view, location age/quality, alert list/count and rule-runtime status. Reuse the existing dashboard registry, draft/revision handling and device controls. Standard portal users need these without installing a vertical.

Make data access injectable before publishing a React package: renderers consume typed timeseries, location, status and alert data; host backends resolve sources and credentials. No hardcoded portal singleton, router or session dependency in portable components. Decide explicitly whether each dashboard document is core-owned or application-owned; avoid dual ownership.

Use the standalone consumer to prove the package boundary. Defer a public plugin marketplace, arbitrary remote scripts and broad dashboard redesign until justified.

### P5 — Hardware and pilot readiness

Confirm tag model, payload examples, transport/network server, location reporting interval, accuracy, battery tradeoffs, timestamp/fix identity, buffering, connectivity and downlink capabilities. Sparkplug simulator support does not establish LoRaWAN or vendor-payload support. Implement the smallest required authenticated adapter into the canonical ingestion path after this discovery.

Agree the pilot's tenant/device counts, expected event rate, alert latency/freshness targets, retention, notification channel and support model; then test against them. No assumed cattle quantities, geography or commercial delivery dates.

For farm internet outages, the design is unresolved: a cloud-only pilot can report stale data and recover buffered history, but cannot promise timely local alerts or control. If local operation is required, edge rule execution, persisted definitions/state, command ownership and reconnect reconciliation become a prerequisite to the pilot, not an implied feature of cloud restart recovery.

## Device control and later priorities

Keep current manual controls available throughout. Adding a geofence node does not authorize automatic physical actions.

After alert-only behavior is proven and a customer needs automation, add a distinct policy-controlled command action with allowed parameters/values, service identity, approval mode, rate limits, deadline, fresh-state validation and audit. All actions use the existing command service; no direct MQTT action node. Simulation and historical replay cannot execute commands. Current offline rejection and uncertain-send behavior remain authoritative unless separately redesigned and verified.

Later, requirement-driven work includes notification escalation, schedules/windows, broader reporting/export, additional geospatial operators, reusable ERP connectors, AI rule drafting, ML datasets/inference and edge deployment. Predictions retain model/version/provenance and remain separate from observations. SAP transactions stay with the application that owns their business meaning. Do not add Airflow, a feature store or another database solely for anticipated future ML.

## Milestone acceptance scenarios

The first core milestone must demonstrate:

1. A tenant creates a location profile/device mapping and a polygon rule, simulates it, explicitly activates it and sees the applied revision.
2. Eligible outside observations meet the configured evidence/duration policy and create one alert episode with a trace to source observations and rule version.
3. Boundary jitter does not repeatedly open/close episodes; invalid/stale/missing fixes show unknown and do not fabricate a safe location.
4. Acknowledgement does not clear the spatial condition; eligible re-entry clears according to the defined recovery policy.
5. Duplicate messages, database/broker interruptions and runtime/worker restarts neither lose committed transitions nor create duplicate logical episodes.
6. Historical replay does not trigger live actions; definition/binding changes fence old work; disabling a rule has an explicit audited outcome.
7. A second organization cannot query, activate, subscribe to, receive notifications for or control the first organization's resources.
8. Existing device history, dashboard drafts and manual controls retain their behavior.

P3 additionally requires revoked-token/delivery tests, checkpoint recovery and a sample application projection rebuilt without database/broker access. P5 requires actual hardware and agreed load/outage evidence; simulator success alone is insufficient.

For implementation, use focused contract, unit, database/broker integration and browser checks appropriate to each slice. Rebuild affected containers and verify the served application under the repository workflow, preserving unsaved browser edits. Do not equate documentation or source presence with completed runtime acceptance.

## Open decisions

- First external application framework and therefore first SDK language; this does not block P0–P2.
- Cloud-only versus local operation during farm connectivity loss; blocks a hardware pilot commitment, not simulator work.
- Real tag transport, fix semantics and customer alert tolerances; simulator defaults remain explicit test parameters until confirmed.
- Exact rule event-time, uncertainty and geometry limits; resolve in versioned contracts before P1 implementation.
- Application identity lifecycle and customer grants; resolve before P3 exposes external access.

**Delivered follow-up:** Laravel workflow drafts and immutable activation snapshots,
runtime acknowledgements, committed-event evaluation, atomic state/checkpoint/
transition persistence and restart-safe timers are implemented. See
[durable workflow execution](../../docs/durable-workflow-execution.md) for behavior,
verification and operational limits.

**P2 progress:** [Alert episodes and initial email delivery](../../docs/workflow-alerts.md)
are implemented, including portal review, acknowledgement/comments and durable
queued delivery to opted-in members. Portal notification settings and audited, generation-fenced terminal-delivery retry are also implemented.

**P3 progress:** [Scoped application access and the TypeScript/Node SDK](../../docs/application-access.md) provide organization/device grants, token lifecycle and read-only device/alert APIs. Verified using a separately installed package against the rebuilt API. The [durable alert-event journal and consumer recovery](../../docs/integration-events.md) are also implemented; [signed webhooks](../../docs/integration-webhooks.md) are delivered. [Latest telemetry and chart history](../../docs/integration-telemetry.md) are delivered in SDK 0.4.0.

**Next task:** P3 integration management UI. [Raw telemetry and paired location reads](../../docs/integration-raw-location.md) are delivered in SDK 0.5.0. Cooldown/escalation policies remain requirement-led.
The visual builder is deferred at the user's request. Keep Laine's customer
workflow and hardware choices open while making the generic core demonstrable.
