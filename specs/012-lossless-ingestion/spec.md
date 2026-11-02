# Feature Specification: Lossless, Deduplicated Ingestion

**Feature Branch**: `spec/012-lossless-ingestion`

**Created**: 2026-10-17

**Status**: Draft

**Input**: Owner request: make Sparkplug ingestion lossless and deduplicated. Give each
message a stable identity derived from the message instead of a random one; subscribe
with QoS 1 on persistent broker sessions (Mosquitto and EMQX); retry the hand-off and
receive it idempotently in the control plane; replay stored outcomes under their
original event IDs; show operators counters and alerts for drops and duplicates; and
measure loss and duplicates with the simulators. The four defects come from
[spec 002's research](../002-canonical-ingestion/research.md) (key finding 8 and
section 3).

## Context

Telemetry enters as Sparkplug B over MQTT. The runtime (`services/runtime`) keeps one
MQTT connection per broker connection, passes each packet through its Sparkplug
session engine, and hands the readings for each bound device to its durable telemetry
stream. A storage consumer then writes observations, latest values and the
committed-telemetry ledger in one transaction, and workflows read the committed feed.
Telemetry never goes to the control plane (constitution I). What the runtime reports
to the control plane (presence, discovery births, activation outcomes, command
statuses, workflow transitions) travels as runtime events. Each event is written to
the runtime's outbox, relayed to a durable stream and posted to the control plane,
which records the event's identity in its inbox before applying it
([ADR-014](../../docs/adr/ADR-014-control-plane-data-plane-http-integration.md)).

Every hop is meant to be at least once with an idempotent consumer (constitution VII).
Four defects recorded in spec 002's research break that promise. All four are still
present on `main` at `4a59f5d`:

1. **Random telemetry identity.** The ingest path gives each device's readings a
   fresh random UUID (`services/runtime/internal/app/application.go:441`, generated
   by `services/runtime/internal/storage/store.go:111-119`). That UUID becomes the
   stream message ID (`application.go:446`), the storage ledger key (`store.go:250`)
   and the committed event's `event_id`
   (`services/runtime/internal/devices/committed.go:42`). The same MQTT message
   delivered twice therefore becomes two telemetry records, two committed events and
   two workflow inputs. A later content match catches only good, source-timestamped
   readings (`store.go:263-274`). Readings timestamped on receipt, and diagnostics,
   are stored twice.
2. **QoS 0 subscriptions on a clean session.** The runtime subscribes to N/D BIRTH,
   DATA and DEATH at QoS 0. Only its own STATE topic uses QoS 1
   (`application.go:215-222`). It connects with a clean session
   (`application.go:203`), so the broker keeps nothing for it while it is
   disconnected. A QoS 1 publisher, such as the platform's adapter publisher
   (`services/adapters/nodes/adapter.js:198-205`), is downgraded to QoS 0 on the way
   to the runtime.
3. **The ingest hand-off is not retried.** Handing a device's readings to the
   telemetry stream can fail because the stream is unavailable or full. When it
   does, the runtime marks the capture `handoff_failed`, logs the failure, reports
   the device's presence as unknown ("Telemetry handoff failed; a data gap may
   exist.") and returns (`application.go:447-456`). The readings are lost. Nothing
   retries them, the broker has already discarded the QoS 0 message, and the
   in-memory latest values have already moved on (`application.go:425-437`).
   The hand-off from the runtime to the control plane works better. The relay and
   the events consumer retry with backoff
   (`services/runtime/internal/app/control.go:89-116`, `control.go:159-165`,
   `services/runtime/internal/app/deadletter.go:123-146`), and the control plane's
   inbox ignores repeats
   (`apps/api/app/Domain/Devices/Http/Controllers/RuntimeController.php:127`).
   However, if a runtime event cannot be written to the runtime's outbox, it is
   logged and dropped (`control.go:123-127`). A database blip can therefore lose
   discovery births, presence changes and heartbeats.
4. **Replays get a new identity.** The control plane can re-send an activation or
   deactivation for a generation the runtime has already applied. The runtime then
   re-emits the stored outcome through `ReplayOutcome` (`store.go:1124-1146`), which
   calls `Emit`. `Emit` creates a new event UUID (`store.go:127-139`), and the stored
   outcome never kept the original one (`store.go:210-215`). The control plane's
   inbox cannot recognise the replay. Only the generation and operation fences keep
   it from being applied twice (`RuntimeController.php:241-259`).

Related findings that shape the requirements:

- The Sparkplug session engine keeps sessions in memory. When the broker connection
  drops it marks every edge node offline
  (`services/runtime/internal/sparkplug/session.go:359-367`), and the session
  identity includes the runtime's receipt time (`session.go:130`). Messages a broker
  held for the runtime would therefore be rejected until a rebirth.
- The engine treats only an immediate repeat of the last sequence number as a
  duplicate. Any other out-of-order message counts as a gap: the node goes offline
  and a rebirth is requested. Every message after that is rejected until the birth
  arrives (`session.go:156-165`, `application.go:322-329`).
- Sparkplug B 3.0 edge nodes publish births and data at QoS 0, and the platform's
  Sparkplug simulator does the same (`tooling/simulators/sparkplug_simulator.py:89`).
  A subscription cannot raise the QoS a publisher chose.
- Mosquitto, the default broker
  ([ADR-009](../../docs/adr/ADR-009-mosquitto-default-broker.md)), autosaves session
  state every 30 s and holds at most 1,000 queued messages per client
  (`deploy/release/mosquitto.conf:8-14`). The development stack and the disposable
  devices harness run EMQX with its default session settings.
- The runtime's JetStream streams set no duplicate window, so the server default
  applies (`control.go:138-146`). The runtime's ledgers and the control plane's
  inbox keep identities for 8 days (`store.go:854-856`,
  `apps/api/app/Domain/Devices/Services/RuntimeLedgers.php:17`), longer than the
  7-day stream age.
- Operators have no counter for packets received, rejected, duplicated, missing
  (sequence gaps) or lost at a hand-off. Prometheus scrapes its metrics from the
  control plane (`apps/api/app/Support/Operations.php:37-144`). Those metrics are
  backlog gauges (`iot_runtime_outbox_pending`, `iot_nats_consumer_pending`), stream
  capacity and retained dead letters. The runtime's own status reports dead letters
  and committed-feed publication failures since start
  (`services/runtime/internal/app/http.go:100-121`,
  `services/runtime/internal/app/committed.go:86-96`). The dead-letter alert exists
  only in the local rules (`deploy/monitoring/local/alerts.yml:180-192`), not in the
  release rules (`deploy/release/monitoring/alerts.yml`).
- The recovery verification (`tooling/verify-devices-recovery.mjs:270-360`) restarts
  the simulator, kills the runtime, and stops the broker, JetStream and the database.
  It checks only that devices come back, not that every message was stored exactly
  once.

This feature makes each hop lossless and deduplicated within stated bounds, shows
operators what was lost or suppressed, and measures both with the simulators. It
changes no public API and no command semantics: an uncertain command is still never
resent. Tenants see only fewer gaps and duplicates.

**Terms**: A *message* is one MQTT publication as the broker delivers it (topic and
payload). A *message identity* is a key derived from the authenticated broker
connection and the message itself; it is the same every time that message arrives. A
*telemetry identity* identifies one device's readings from one message. A *hand-off*
is a transfer after which the sender is no longer responsible, because the receiver
holds the data durably: broker to runtime, ingest to telemetry stream, stream to
storage, storage to committed feed, and runtime outbox to control plane. A *loss* is
a message that the broker accepted from a QoS 1 publisher, or that the runtime
received at any QoS, and that never reaches storage. A *gap* is a message the runtime
knows it missed because of the Sparkplug sequence. A *duplicate* is a second arrival
of an identity that was already accepted. The *ride-through window* is how long the
runtime or its telemetry stream can be unavailable without loss.

Five open questions are marked inline as Q1 to Q5, each with a recommended answer.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A message delivered twice is stored once (Priority: P1)

A gateway's message reaches the runtime twice. The broker may redeliver it after a
reconnect, the publisher may retry it, or the runtime may restart before confirming
it. The device's history, latest values, committed feed and workflows still see it
once.

**Why this priority**: duplicates silently corrupt consumption totals, counters and
workflow windows. A stable identity is also the precondition for every retry this
feature adds; retries without one would multiply duplicates.

**Independent Test**: with the measurement (US5), re-publish 1% of a simulated edge
node's messages byte for byte, after delays from 1 second to 10 minutes and partly
across a runtime restart. Every injected copy is counted as a suppressed duplicate,
and none appears in history, the committed feed or workflow inputs.

**Acceptance Scenarios**:

1. **Given** a stored data message, **When** the same message arrives again within
   the deduplication horizon (FR-005), **Then** no reading, committed event or
   workflow input is added, and the duplicate counter for the stage that recognised
   it increases by one.
2. **Given** a message for an edge node with several bound devices, **When** the
   runtime stops after handing off some of those devices' readings and the message is
   redelivered, **Then** each device's readings are stored exactly once.
3. **Given** two different messages with identical metric values, **When** both
   arrive, **Then** both are stored. Equal content never makes different messages
   duplicates.
4. **Given** a redelivered message that arrives after newer messages from the same
   edge node, **When** the runtime receives it, **Then** it is recognised as a
   duplicate, and the edge node is neither taken offline nor asked to rebirth.

---

### User Story 2 - A component restart loses nothing the broker accepted (Priority: P1)

The runtime crashes mid-batch, the broker restarts, or JetStream or the database is
briefly unavailable. When everything is back, every message a QoS 1 publisher handed
to the broker is stored. Every message a QoS 0 publisher sent is either stored or
counted as missing.

**Why this priority**: it is the request. Today each of these events can lose data
without a trace.

**Independent Test**: run the measurement with QoS 1 publishers at the reference
load. Kill the runtime with SIGKILL at a random moment, ten times, on Mosquitto and on
EMQX. The published and stored counts match exactly.

**Acceptance Scenarios**:

1. **Given** the runtime is connected, **Then** its subscriptions to births, data and
   deaths are QoS 1 on a session the broker keeps while the runtime is away, and the
   runtime reports any broker that grants a lower QoS.
2. **Given** a QoS 1 publisher, **When** the runtime is down for less than the
   ride-through window and then restarts, **Then** the broker delivers the messages
   it held, the runtime accepts those that continue a session it already knew, and
   none is lost or duplicated.
3. **Given** a message the runtime received, **When** handing it to the telemetry
   stream fails, **Then** the runtime neither confirms it to the broker nor drops it.
   It retries, and if it stops before succeeding, the broker redelivers the message.
4. **Given** the telemetry stream stays unavailable longer than the ride-through
   window, **Then** messages beyond the broker's limit are counted as gaps or losses
   and an alert fires. Nothing is dropped without being counted.
5. **Given** a graceful broker restart, **Then** the runtime resumes its session and
   nothing is lost. **Given** a broker crash, **Then** anything the broker had not
   yet persisted shows up in the gap or loss counters and is never silently missing.
6. **Given** a QoS 0 Sparkplug edge node, **When** messages are lost before they
   reach the runtime, **Then** each one is counted from the sequence gap and a
   rebirth is requested as today (Q1, Q4).

---

### User Story 3 - A control plane outage loses and doubles nothing (Priority: P1)

The control plane is down for an upgrade or an incident. Telemetry keeps flowing into
storage. When the control plane returns, it receives every presence change, discovery
birth, activation outcome, command status and workflow transition from the outage, in
order, and applies each one once. That includes outcomes the runtime replays.

**Why this priority**: people see device state and alerts in the control plane. A
lost outcome leaves an activation pending forever, and a doubled transition doubles
an alert.

**Independent Test**: stop the control plane for 60 minutes under the reference load.
Meanwhile, take a simulated edge node offline and back, and make a deployed workflow
cross its threshold. Within 5 minutes of the restart the control plane shows the
latest presence and exactly one transition, the dead-letter stream is empty, and the
telemetry stored during the outage is complete.

**Acceptance Scenarios**:

1. **Given** the control plane is unavailable, **Then** telemetry storage, the
   committed feed and workflows keep running. Runtime events wait in durable storage
   and are retried with backoff, and the outage never causes one to be dead-lettered.
2. **Given** a runtime event cannot be written to the runtime's outbox (for example
   during a database blip), **Then** the runtime retries the write rather than
   logging and dropping the event.
3. **Given** the control plane has already applied an event, **When** the same event
   arrives again (a relay retry, a stream redelivery or a replayed outcome), **Then**
   the inbox recognises its identity, nothing changes, and the duplicate is counted.
4. **Given** the control plane re-sends an activation for a generation the runtime
   already applied, **When** the runtime replays the stored outcome, **Then** the
   replay carries the original event's identity. If the control plane never applied
   the original, it applies the replay once.

---

### User Story 4 - Operators see loss and duplicates before tenants do (Priority: P2)

An operator watches the dashboards and alerts. They can see how many messages
arrived, how many were duplicates and at which stage they were suppressed, how many
were missing from Sparkplug sequences, how many hand-offs were retried, and whether
anything was lost after receipt. An alert tells them when data is being lost.

**Why this priority**: without visibility, "lossless" is only a claim. The counters
are also how the measurement (US5) checks the platform's own accounting.

**Independent Test**: in the local monitoring stack, drop 100 messages between a
QoS 0 simulator and the broker, then stop JetStream for longer than the ride-through
window. Within two scrapes, the gap and loss counters rise by the injected amounts.
The loss alert reaches Mailpit within 5 minutes, and the same rule exists in the
release rules.

**Acceptance Scenarios**:

1. **Given** the platform is running, **Then** operators can read platform-wide
   counters for messages received by kind, accepted, suppressed as duplicates (by
   stage), rejected (by reason class), missing from Sparkplug sequences, rejected
   while waiting for a rebirth, hand-off retries, losses after receipt, resumed broker
   sessions and messages delivered from them, and runtime events the control plane
   recognised as duplicates.
2. **Given** any of these counters, **Then** its labels are fixed and never carry an
   organization, connection or device identifier
   ([monitoring](../../docs/ops/monitoring.md)).
3. **Given** a loss after receipt, **Then** a critical alert fires. **Given** gaps or
   duplicates above a threshold, **Then** a warning fires. Both alerts exist in the
   local and the release rules and have runbook text.
4. **Given** a device lost data, **Then** its presence diagnostic and telemetry
   captures say so, as today. Tenants get no new counters (Q5).

---

### User Story 5 - Loss and duplicate rates are measured (Priority: P2)

A platform engineer runs one command against a disposable stack. It produces a
report for each scenario on Mosquitto and on EMQX: messages published, stored, lost
and duplicated, and what the platform itself counted.

**Why this priority**: the success criteria are numbers. This is how they are
checked, and how a later change proves it did not regress.

**Independent Test**: run the measurement from a clean checkout of the branch. It
completes every scenario in the success criteria, writes a machine-readable report,
and fails when any number misses its target.

**Acceptance Scenarios**:

1. **Given** the measurement, **Then** it drives the existing simulators (or a
   numbered mode of them), so every published message carries a marker that can be
   matched in storage.
2. **Given** a scenario, **Then** it injects that scenario's fault at a random moment
   and reconciles afterwards. The faults are: runtime kill, broker restart or crash,
   JetStream, database or control plane stop, duplicate re-publish, sequence wrap and
   rebirth, and device clock offset.
3. **Given** the report, **Then** for each scenario the platform's own counters equal
   the measured losses and duplicates. Any difference fails the run.

### Edge Cases

- **Graceful broker restart.** The broker persists the session and its queued
  messages. The runtime resumes the session, and nothing is lost.
- **Broker crash.** Mosquitto persists sessions every 30 s, so a crash can lose
  queued messages and the session itself (ADR-009). The runtime subscribes again.
  The loss shows up as Sparkplug gaps and in the measurement, and no false duplicates
  appear.
- **Runtime restart mid-batch.** Messages the runtime received but did not hand off
  are redelivered. When a message covers several devices, the devices already handed
  off are suppressed as duplicates. The storage transaction and the committed and
  outbox relays already retry; they now do so with stable identities.
- **Runtime restart with a known session.** Messages held during the restart that
  continue a session from before it are accepted without waiting for a rebirth. A
  rebirth is still requested when the session is unknown or inconsistent.
- **Control plane down for N minutes.** Runtime events wait in the durable stream
  for up to its 7-day age and are retried with backoff of up to 60 s. After recovery
  they are delivered in order. An outage longer than the stream age is out of scope;
  the existing backlog alert fires long before then.
- **JetStream full or unavailable.** The telemetry stream discards new messages when
  full, which is treated the same as unavailable. The runtime stops confirming
  messages, and the broker holds them within the ride-through window. Anything
  beyond it is counted and alerted.
- **Database unavailable.** The storage consumer retries, as today. Runtime events
  waiting for the outbox are retried (US3). Ingest continues into the telemetry
  stream.
- **Sparkplug sequence wrap.** The sequence number wraps every 256 messages. The
  identity tells message n apart from message n + 256 in the same session, so a wrap
  causes neither a false duplicate nor a false gap.
- **Rebirth.** A rebirth NBIRTH keeps the same `bdSeq` but starts a new session. Data
  before and after it can reuse sequence numbers without sharing an identity. A
  repeated identical NBIRTH while the node is online is still a duplicate
  (`session.go:127-129`).
- **`bdSeq` wrap.** `bdSeq` wraps at 256 across reconnects. Two sessions with the
  same `bdSeq` are told apart by their birth timestamps.
- **Out-of-order redelivery.** A redelivered message older than the last accepted
  one is a duplicate, not a gap.
- **Clock skew.** Identity never depends on the runtime's receipt time or wall clock.
  A device clock that is wrong, frozen or jumps backwards causes no false duplicates
  while the sequence advances. When a device has no clock (the payload timestamp is
  absent or constant), identity falls back to the message content, and a
  byte-identical re-send is a duplicate by definition. Readings more than 5 minutes
  in the future keep today's `corrected_future` handling. Ledger pruning uses the
  database clock, not a host clock.
- **Ride-through exceeded.** The overflow is counted and alerted, never silent.
- **QoS downgraded.** If a broker grants QoS 0 for a subscription (through an ACL or
  a maximum-QoS setting), the runtime reports it at connect and counts it, and keeps
  running.
- **Abandoned broker session.** A connection that is removed or disabled must not
  leave the broker holding messages forever. Sessions expire after a bounded
  interval on both brokers.
- **Configuration changed between deliveries.** If a device's generation changes
  before a message is redelivered, today's generation fences discard the redelivered
  readings. They are never stored under the new configuration.
- **Suspended ingestion and captures.** A device whose production ingestion is
  suspended during a capture behaves as today: its samples are not replayed.
  Captures label repeated arrivals as duplicates.
- **Historical flush overlapping live data.** A gateway that re-sends buffered data
  it already sent live produces new messages. The existing content check still
  catches good, source-timestamped readings; other readings are stored as historical,
  as today.
- **Original dead-lettered, replay arrives.** A replayed outcome whose original was
  refused must still reach the control plane. The stream's duplicate window must not
  silently swallow it.
- **Beyond the deduplication horizon.** A byte-identical message re-sent after the
  horizon is stored again. This limit is documented.

## Requirements *(mandatory)*

### Functional Requirements

**Message identity**

- **FR-001**: The runtime MUST derive each message's identity deterministically from
  the authenticated broker connection, the topic and the message's own contents. The
  identity MUST NOT come from a random value or the runtime's clock. The same message
  MUST get the same identity whenever and however often it arrives, including across
  restarts.
- **FR-002**: For Sparkplug, the identity MUST follow the precedence in spec 002's
  FR-012. It combines the source session (edge node, `bdSeq` and the birth's payload
  timestamp) with the sequence number and the payload timestamp. A digest of the
  payload MUST be added where those facts cannot tell two messages apart, such as a
  missing or constant timestamp or a sequence wrap. Two different messages MUST never
  share an identity.
- **FR-003**: Each device's readings from a message MUST carry a telemetry identity
  derived from the message identity and the device. It serves as the telemetry
  stream's message ID, the storage ledger key and the committed event's `event_id`.
  It MUST keep the UUID format, so `telemetry.committed.v1` and the internal
  telemetry contract keep their versions. Their documentation MUST state that the
  identity is stable across redelivery.
- **FR-004**: Each stage MUST recognise a repeated identity: ingest (the session
  engine), the telemetry stream, storage, the committed feed and workflow inputs. A
  recognised repeat changes nothing and is counted for that stage.
- **FR-005**: Identities MUST be recognised for at least 8 days, the horizon the
  runtime's ledgers and the control plane's inbox already use, which is longer than
  the streams' 7-day age. The documentation MUST state that a byte-identical message
  re-sent after the horizon is stored again.

**Delivery from the broker**

- **FR-006**: The runtime MUST subscribe to N/D BIRTH, DATA and DEATH with QoS 1 on
  both Mosquitto and EMQX. It MUST check the QoS each broker grants and report and
  count any downgrade.
- **FR-007**: The runtime MUST connect with a session that the broker keeps while the
  runtime is disconnected, so messages published meanwhile are delivered when it
  reconnects. Sessions MUST expire after a bounded interval on both brokers, shorter
  than the deduplication horizon (FR-005), so that a removed or disabled connection
  does not hold messages forever.
- **FR-008**: The runtime MUST confirm a message to the broker only once every
  device's readings from it have been handed off durably, or once the message has been
  recognised as a duplicate, rejected for a permanent reason, or found to match no
  device. If the runtime stops before confirming, the broker delivers the message
  again.
- **FR-009**: Sparkplug session state (births, aliases, datatypes and the last
  sequence number) MUST survive a broker reconnect and a runtime restart. Held
  messages that continue a known session are then accepted rather than rejected for
  want of a birth. A message that does not continue a known session still leads to a
  rebirth request, as today.
- **FR-010**: A message whose identity was already accepted MUST be treated as a
  duplicate, even if it arrives after newer messages. It MUST NOT be treated as a
  sequence gap.
- **FR-011**: Messages that arrive after a sequence gap and before the rebirth MUST be
  [NEEDS CLARIFICATION Q4: What happens to data received after a sequence gap until
  the rebirth arrives? Today one missing message takes the node offline, and every
  later message is rejected until the birth (`session.go:156-165`). Rebirth requests
  are throttled to one per 30 s per edge node (`application.go:259-274`), so a single
  loss can cost up to 30 s of data. Recommended: keep rejecting until the rebirth, as
  Sparkplug intends, because a missed birth may have changed aliases or datatypes.
  Count those messages as "rejected awaiting birth", so that the loss accounting is
  complete. Also add a short reorder window, so a late message arriving within it
  fills the gap instead of starting a rebirth.]
- **FR-012**: The no-loss guarantee MUST cover [NEEDS CLARIFICATION Q1: Which
  publishers does "nothing lost" cover? Sparkplug B 3.0 edge nodes publish births and
  data at QoS 0, as the platform's simulator does (`sparkplug_simulator.py:89`), and a
  subscription cannot raise that. Recommended: zero loss from the broker's acceptance
  for QoS 1 publishers, which today means the adapter publisher and gateways
  configured for QoS 1. For QoS 0 publishers: both brokers also queue their messages
  for the runtime's session while the runtime is away, zero loss from the runtime's
  receipt onward, and every message lost before receipt counted as a gap. Edge nodes
  that buffer while the runtime's host state is offline are accepted when they flush.
  Requiring QoS 1 from Sparkplug devices would depart from the specification.]
- **FR-013**: The broker MUST hold messages for the runtime for at least
  [NEEDS CLARIFICATION Q2: How long must a runtime or telemetry stream outage last
  without loss? Recommended: 5 minutes at the reference load, which covers a runtime
  restart or upgrade. That requires raising Mosquitto's limit of 1,000 queued messages
  per client (`mosquitto.conf:12`) to cover the window, plus the equivalent EMQX
  setting, both checked against the broker's memory limit. Past the window, dropped
  messages show up as gaps and alert.]. Messages beyond the limit MUST appear in the
  gap or loss counters and MUST NOT be dropped silently.

**Hand-offs**

- **FR-014**: Handing a device's readings to the telemetry stream MUST be retried with
  backoff until it succeeds or the runtime stops. The runtime MUST NOT drop readings
  after receipt, and MUST NOT advance in-memory latest values for readings that were
  not handed off.
- **FR-015**: While the telemetry stream refuses messages (unavailable or full), the
  runtime MUST stop taking new messages from the broker rather than drop them, so the
  broker holds them within FR-013. A device MUST be reported as having a data gap only
  when data was actually lost.
- **FR-016**: Every runtime event MUST be written durably before the change it
  reports is considered done. A failed write MUST be retried, not logged and dropped.
- **FR-017**: The runtime-to-control-plane hand-off MUST remain at least once, with
  retries and backoff. A control plane outage MUST NOT cause events to be
  dead-lettered: authentication, not-found, timeout, rate-limit and server errors stay
  retryable, as in `deadletter.go:75-81`.
- **FR-018**: The control plane MUST apply each runtime event identity at most once.
  It records the identity in its inbox in the same transaction as the change, as
  today. It MUST keep identities at least as long as the runtime can redeliver them,
  and MUST count the duplicates it recognises.
- **FR-019**: A replayed outcome MUST carry the identity of the event that first
  reported it, so the stored outcome keeps that identity. If the control plane applied
  the original, the replay is a counted duplicate. If it never applied it (because it
  was refused or rolled back), the control plane applies the replay once. If the
  original was dead-lettered, the stream's duplicate window MUST NOT suppress the
  replay.

**Operators**

- **FR-020**: The platform MUST count, platform-wide: messages received by kind;
  accepted; duplicates suppressed, by stage; rejected, by reason class; Sparkplug gaps
  and the messages they imply are missing; messages rejected while waiting for a
  rebirth; hand-off retries; losses after receipt; broker sessions resumed and
  messages delivered from them; QoS downgrades; runtime event outbox write retries;
  and runtime events the control plane recognised as duplicates.
- **FR-021**: The counters MUST reach Prometheus through a scrape path with fixed
  labels (stage, kind, reason class) and never carry an organization, connection or
  device identifier. They MUST be monotonic counters, and alerts MUST tolerate a reset
  when the runtime restarts.
- **FR-022**: The local rules (`deploy/monitoring/local`) and the release rules
  (`deploy/release/monitoring`) MUST both alert on loss after receipt (critical), on
  gap and duplicate rates above a threshold (warning), and on a session that was not
  resumed or a downgraded QoS (warning). Each rule MUST have a rule test and a
  dashboard panel. The existing dead-letter alert MUST be added to the release rules.
- **FR-023**: [The monitoring runbook](../../docs/ops/monitoring.md) MUST explain each
  counter and alert, and what to do about it.
- **FR-024**: Loss and duplicate information MUST be shown to [NEEDS CLARIFICATION
  Q5: Who sees it? Recommended: platform operators only in this spec, through the
  platform-wide counters and alerts above. Tenants keep today's per-device "a data gap
  may exist" diagnostic and the telemetry capture statuses. A tenant-facing view of
  data completeness per device or site would need tenant-scoped storage, permissions
  and UI, so it belongs in a later spec.]

**Measurement**

- **FR-025**: A repeatable measurement under `tooling/` MUST build on the existing
  simulators. It MUST publish numbered messages from several simulated edge nodes in
  QoS 0 and QoS 1 modes; in QoS 1 mode it resends unacknowledged messages. It MUST
  inject the faults listed in US5 and run every success criterion scenario on
  Mosquitto and on EMQX. For each scenario it MUST write a machine-readable report
  (published, stored, lost, duplicated, counted by the platform) and fail when a
  target is missed.
- **FR-026**: The recovery verification (`tooling/verify-devices-recovery.mjs`) MUST
  assert message counts across its interruptions, not only that devices come back
  online.

**Scope, decisions and documentation**

- **FR-027**: For the adapter path, this spec MUST [NEEDS CLARIFICATION Q3: Is the
  adapter publisher in scope? It already publishes at QoS 1 (`adapter.js:198-205`),
  but it connects with a clean session and discards readings while its upstream
  connection is down, without advancing its sequence number (`adapter.js:167-173`,
  `adapter.js:198-199`), so those losses are invisible. Recommended: out of scope
  apart from documenting the limit. Adapter traffic gains FR-001 to FR-019 from the
  moment the broker accepts it. The publisher's own buffering belongs to the
  multi-tenant adapter service that spec 002 anticipates, which replaces the
  per-tenant Node-RED runtimes.]
- **FR-028**: A new ADR MUST record the delivery guarantee for each hop, the identity
  rules and replay identity (amending ADR-014), and the broker session, QoS and queue
  settings (against ADR-009). ADR-005's Sparkplug boundary is unchanged.
- **FR-029**: The [events](../../docs/reference/events.md),
  [Sparkplug](../../docs/reference/sparkplug.md) and [broker](../../docs/ops/broker.md)
  references MUST describe the new guarantees and limits. The committed telemetry
  contract's fixtures and cases MUST still validate, without a new major version.

### Key Entities *(include if feature involves data)*

- **Message identity**: a deterministic key for one MQTT message on one authenticated
  connection. For Sparkplug it is built from the session facts, the sequence number,
  the payload timestamp and, where needed, a payload digest. It is recognised for the
  deduplication horizon.
- **Telemetry identity**: one device's readings from one message. It is derived from
  the message identity and the device, keeps the UUID format, and equals the committed
  event's `event_id`.
- **Runtime event identity**: unchanged in format. It is stored with each outcome, so
  a replay reuses it.
- **Runtime broker session**: the runtime's host identity on each broker, with QoS 1
  subscriptions, a bounded expiry and a queue limit sized to the ride-through window.
- **Sparkplug session state**: births, aliases, datatypes and the last sequence number
  for each edge node and device. It is kept durably so that it survives restarts.
- **Loss and duplicate counters**: platform-wide, with fixed labels, read by
  Prometheus and alerts.
- **Measurement report**: per scenario and broker, the counts published, stored, lost
  and duplicated, and what the platform counted.

## Success Criteria *(mandatory)*

### Measurable Outcomes

The **reference load** is 50 simulated devices on 5 edge nodes, each sending one data
message per second (50 messages per second). Unless stated otherwise, a run lasts 30
minutes (about 90,000 data messages), and every criterion is met on both Mosquitto
and EMQX, as measured by FR-025.

- **SC-001**: Steady state with QoS 1 publishers: 0 messages lost and 0 duplicates
  stored.
- **SC-002**: Runtime killed with SIGKILL at a random moment and restarted within
  60 s, ten times per broker: 0 lost and 0 duplicated for QoS 1 publishers.
- **SC-003**: JetStream stopped for 60 s, and separately the database stopped for
  60 s: 0 lost and 0 duplicated for QoS 1 publishers. An outage lasting the full
  ride-through window also loses 0.
- **SC-004**: Graceful broker restart, five times: 0 lost for QoS 1 publishers. Broker
  crash (SIGKILL), five times: the platform's counted gaps and losses equal the
  measured loss exactly, so nothing is lost silently.
- **SC-005**: QoS 0 publishers (the default Sparkplug simulator) skipping 1% of
  publications while still advancing the sequence: counted gaps equal the skipped
  count exactly, no message is lost after receipt, and every message rejected while
  waiting for a rebirth is counted.
- **SC-006**: Control plane stopped for 60 minutes: 0 telemetry lost. Every runtime
  event from the outage is applied exactly once within 5 minutes of the restart, and
  no event is dead-lettered.
- **SC-007**: 1% of messages re-published byte for byte after delays from 1 s to
  10 minutes, partly across a runtime restart: 0 duplicate observations,
  diagnostics, committed events or workflow inputs. The suppressed-duplicate count
  equals the number injected.
- **SC-008**: 100 forced re-sends of an already applied activation: 0 additional
  applied outcomes or audit records in the control plane, and 100 duplicates counted.
- **SC-009**: 10,000 messages per edge node (about 39 sequence wraps) with three
  rebirths and two reconnects: 0 false duplicates, 0 false gaps, and no rebirth
  requests beyond the injected ones.
- **SC-010**: Device clocks offset by +10 minutes and by -10 minutes, one backwards
  jump of 1 hour, and one frozen timestamp: 0 lost and 0 false duplicates.
- **SC-011**: An injected loss or duplicate appears in the counters within 30 s. The
  loss alert notifies within 5 minutes in the local stack, and the release rules pass
  the same rule tests.
- **SC-012**: At the reference load, the 95th-percentile time from publish to stored
  is no more than 20% worse than `main` measured with the same harness, and no backlog
  grows over a 30-minute run.
- **SC-013**: The Go and PHP tests for every acceptance scenario and edge case above
  pass in CI on PostgreSQL.

## Assumptions

- One runtime instance, as today, enforced by the advisory lock. Partitioning
  ingestion across instances is out of scope
  ([roadmap](../../docs/roadmap.md#evolution)).
- The reference load is modest because the runtime's ingest throughput has not been
  measured yet (roadmap: "Runtime throughput (measure first)"). The plan may raise it
  once throughput is measured. Simulator results do not stand in for hardware or
  production-load acceptance (constitution IX).
- Telemetry never goes to the control plane (constitution I). The control plane
  hand-off in this spec carries only runtime events.
- The canonical envelope (spec 002) is not needed for this work, which applies to the
  current Sparkplug path. The identity rule follows spec 002's FR-012, so the
  envelope can carry it later.
- Device commands (NCMD/DCMD) and rebirth requests keep today's delivery. An
  uncertain command is never resent (constitution VI).
- A broker crash can still lose state that was not yet persisted (ADR-009). This spec
  makes that loss visible but does not prevent it. Highly available brokers are out
  of scope.
- EMQX stays in development and the disposable harness, and Mosquitto is the release
  default (ADR-009). Both must meet the criteria. Moving development to Mosquitto is a
  separate roadmap item.
- The plan checks the persistent host session against the Sparkplug B 3.0 host
  application rules. Any conflict is recorded in the ADR required by FR-028.
- The counters reset when the runtime restarts. Alert rules use rates and increases,
  as Prometheus counters expect.
