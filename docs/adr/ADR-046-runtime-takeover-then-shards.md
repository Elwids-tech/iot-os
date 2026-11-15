# ADR-046: One Runtime That Can Be Taken Over, Then Shards by Connection

**Status:** Proposed
**Date:** 2026-11-14
**Relates to:** [ADR-003](ADR-003-go-data-plane.md), [ADR-005](ADR-005-sparkplug-b-boundary.md), [ADR-006](ADR-006-deployment-profiles.md), [ADR-014](ADR-014-control-plane-data-plane-http-integration.md), [ADR-031](ADR-031-batched-runtime-events.md), [ADR-042](ADR-042-store-telemetry-once.md)

## Context

The runtime is one Go process, and only one may run: it takes a PostgreSQL advisory
lock at startup and exits if another process holds it
([`ExclusiveRuntime`](../../services/runtime/internal/storage/store.go)). It is the
Sparkplug host application for every broker connection, keeps session state in
memory, stores telemetry, evaluates automations, dispatches commands and answers
Laravel's internal queries. There is no failover and no sharding
([overview](../architecture/overview.md), [Sparkplug limits](../reference/sparkplug.md#limits),
[release](../ops/release.md)). An architecture review asked for failover to be
designed first and sharding second. This record is that design. Nothing is built.

### What assumes one process

Everything below is in [`internal/app`](../../services/runtime/internal/app) unless
another path is given.

| Assumption | Where | After a restart |
| --- | --- | --- |
| The advisory lock: one key for the whole deployment, held on one pooled connection for the life of the process. A second process exits. Nothing checks that the lock is still held | `storage/store.go` `ExclusiveRuntime`; `application.go` `New` | Taken again |
| Primary host STATE: one MQTT client per connection, client ID and STATE topic both the connection's `host_id`, clean session, retained online STATE and an offline will | `application.go` `connect`, `Close` | Published again with a newer timestamp |
| Sparkplug sessions: `bdSeq`, `seq`, birth metrics, aliases, datatypes per edge node | `sparkplug/session.go` `Engine.nodes` | Lost. Rebuilt only by births |
| Applied definitions, generations, review flags | `Application.definitions`, `generations`, `appliedGeneration`, `reviewRequired` | Loaded from `device_runtime.devices` (`SavedDevices`) |
| Latest values used to carry a last valid value and feed derived parameters; the session they belong to; whether a device may take commands | `latest`, `sessions`, `compatible` (`handOn`, `commandCheck`) | Lost. Rebuilt by the next birth. Reads fall back to stored rows |
| Pending commands: sent, waiting for the matching live reading | `pending` (`commands.go` `dispatch`, `observe`, `expireCommands`) | The claim is stored. Startup marks **every** outstanding command `uncertain` and never sends it again (`RecoverCommands`) |
| Rebirth pacing and queue, presence throttles, last reported presence | `rebirth`, `rebirthPending`, `presenceAt`, `reported` | Lost. Harmless, a few repeated events |
| Held activations (waiting up to 90 s for a birth) | `held`, with `time.AfterFunc` | Lost. Laravel's state poll replays the pending operation |
| Connectivity tracker: last heard, observed times, anchors, pending conditions | `connectivity.go` `connectivityTracker` | Episodes load from `device_runtime.connectivity`; last heard is seeded from stored readings; silence counts from the restart, so detection is late by up to one threshold |
| Telemetry captures, including a capture's suspension of a device's ingestion | `telemetry/capture.go` `Manager.sessions` | Lost. A suspended device ingests again without anyone asking |
| The telemetry stream's fan-out | `broadcast.go` `committedBroadcaster` | Streams drop. Clients resume from their position through the outbox |
| Per-device lock that orders activation, storage, command dispatch and the event relay for a device | `Application.fences` (`lockDevice`) | Empty. Generation fences in SQL still reject stale work |
| Consumers with one message in flight: control, storage, automation evaluation | `control.go` `subscribe` (`MaxAckPending(1)`), `rule_consumer.go` (`Fetch(1)`) | Durable. They resume where they stopped |
| The event inbox: one goroutine, global stream order, batches of 100 | `inbox.go` | Durable. Unacknowledged batches are delivered again and deduplicated |
| Relays that read a whole table in order: runtime events by `created_at`, committed telemetry by `sequence` | `control.go` `relay`; `committed.go` `relayCommitted` | Resume from unpublished rows |
| The automation checkpoint: one row for the deployment, advanced only to the next stream sequence | `storage/rules.go` (`rule_checkpoint`, `singleton`) | Stored. Evaluation continues from it |
| Sweeps over everything: state poll, heartbeat, retention cleanup, ledger and connectivity pruning, usage report | `application.go` `maintenance`, `cleanup`, `reportUsage` | Run again |
| Laravel has one runtime address; several endpoints answer from memory (latest, command check, validate, captures, connectivity, status, telemetry stream) | `http.go`; `RuntimeClient` in `apps/api` | Served by the new process once births return |

Two things follow. **A restart is already correct by design**: everything a new
process needs is in PostgreSQL, JetStream or Laravel, or comes back with a rebirth.
And **Sparkplug session state cannot usefully be persisted**: `seq` changes with
every message, so a successor always starts from fresh births.

### What a stop or restart costs today

Measured on the dev stack on 2026-11-15 UTC, with the Sparkplug simulator publishing
three meters every 10 s beside 13 adapter-fed devices (16 applied devices, about
4,100 device rows), without rebuilding images:

| | Graceful restart (`docker restart`) | Crash (`docker kill`, started 60 s later) |
| --- | --- | --- |
| Process down | 0.5 s | 61 s |
| Readings lost | None (no 10 s report fell in the gap) | All six reports each meter sent while it was down |
| First readings stored after start | Births, in the same second | Births, 0.3 s after the process started |
| Presence in the portal | Stayed online | Unknown 16 s after the kill, online 1.6 s after the start |
| Rebirth requests per edge node | Two, 30 s apart | Two, 30 s apart |

- **Data sent while the runtime is down is lost.** The runtime subscribes at QoS 0
  with a clean session, so the broker keeps nothing for it, and no publisher holds
  data while the host is offline: the simulator and the embedded SDK do not buffer
  (the SDK's store-and-forward is planned, [embedded SDK](../features/embedded-sdk.md)),
  and the adapter publisher holds its source's messages only while it cannot reach
  the platform broker ([`adapter.js`](../../services/adapters/nodes/adapter.js)),
  not while the broker is up and the runtime is away. No host-side design closes
  this gap; only buffering at the edge does.
- **What is buffered.** Messages the runtime accepted but had not stored wait in
  `IOT_DEVICE_TELEMETRY`; control messages in Laravel's `device_outbox` and
  `IOT_DEVICE_CONTROL`; runtime events in `device_runtime.outbox` and
  `IOT_DEVICE_EVENTS`; committed telemetry in `telemetry_outbox` and
  `IOT_COMMITTED_TELEMETRY`. All are durable and resume.
- **Presence.** Laravel shows a device unknown once the last heartbeat is 20 s old
  ([events](../reference/events.md)), so an outage under about 10 to 20 s is
  invisible. Commands are refused until a device's birth is back.
- **The second rebirth is a defect.** On connecting, the runtime asks for a rebirth
  once per applied definition. The first request for an edge node is sent and the
  rest are queued, and the queue sends another 30 s later (`connect`,
  `requestRebirth`). A paced SDK gateway with 512 devices takes about 26 s to
  announce, and its devices refuse commands until their births are back, so every
  restart opens that window twice.
- **Starting needs Laravel.** `New` blocks on `GET /state` for up to two minutes and
  then exits. Broker credentials come only from that response. A runtime that
  crashes while the API is down does not ingest until the API is back.
- **Not measured:** a restart with hundreds of devices or a paced gateway, the will
  path (how long the broker takes to publish STATE offline after a crash), commands
  in flight, automation timers across the gap, and startup time against a large
  fleet's state response.

Planned outages are larger than these. A deploy stops every writer, recreates NATS
and the broker, which disconnects every device, and runs migrations before anything
starts ([`manage.py`](../../tooling/release/manage.py)). The nightly backup stops the
broker and the writers for at least 45 seconds plus the dump
([release](../ops/release.md#backups-and-restore)). On both release shapes the
broker, NATS and the API run on the application host; on the two-server shape only
the database is elsewhere. **A second runtime protects against the runtime process
failing. It does not protect against the host failing, a deploy or a backup.**

### How much one instance carries

- The tested rate is 500 devices reporting every 10 s, 50 messages a second
  ([simulators](../dev/simulators-and-fixtures.md)). At that rate a message is in
  history 7 ms after receipt at p50 and 21 ms at p99, of which the storing
  transaction is 1.1 ms ([billing](../features/billing.md#data-points)).
- Storing a ten-reading message takes 0.98 ms on loopback and 6.1 ms with a
  millisecond per round trip, which is nearer the two-server shape (#233); 0.9 ms
  with 400 daily chunks, 2.3 ms when readings carry the device's timestamp (#236).
  The storage consumer handles one message at a time, so storing alone caps it near
  1,000 messages a second on one host and near 160 with the database on another.
- Runtime events reach Laravel at 430 to 500 a second in batches
  ([ADR-031](ADR-031-batched-runtime-events.md)); the relay before them moves about
  125 a second ([roadmap](../roadmap.md#next)).
- **The ceiling itself has never been measured** (the roadmap says "measure first").
  Reading the code, the automation consumer makes a dozen or more round trips for
  each message (two stream lookups, the checkpoint check twice, the timer pass, the
  evaluating transaction, a synchronous acknowledgement), so on the two-server shape
  it is probably the first stage to fall behind, somewhere under 100 messages a
  second. That is an estimate, not a measurement.

So one instance has room above the tested rate, the nearest limits are serial
consumers that can be pipelined inside one process, and sharding is not needed for
throughput yet.

## Options

### Failover

**A. Restart in place (today).** Docker restarts the container. Recovery is the
restart plus the births: about a second on the dev stack. Costs nothing. Loses what
was sent in the gap. Cannot start without Laravel.

**B. Warm standby with the same host ID.** A second process loads the stored
devices, keeps Laravel's state response fresh in memory and waits for the advisory
lock. It connects to no broker and consumes nothing until it holds the lock. Then it
does what a restart does: connects as the same `host_id`, publishes a newer online
STATE, asks for rebirths and consumes.

- *State to persist:* none beyond what is stored today. *State to re-derive:*
  sessions, aliases and latest values from births; held activations from the state
  poll. The standby already holds broker credentials, so it can take over while the
  API is down.
- *What must be added for it to be correct:*
  - **Noticing the loss.** PostgreSQL releases the lock when the holder's session
    ends: at once when the process dies, but only after TCP keepalive when its host
    or network does. The lock session sets short keepalives so that takes seconds.
  - **Fencing.** Today a runtime whose lock connection drops keeps running without
    the lock. The holder must check its lock session every second or two and stop
    when it is gone; otherwise two hosts take turns evicting each other from the
    broker, since they share a client ID. A stored epoch, raised at each takeover,
    goes into the heartbeat and the status so a late one can be told apart.
  - **Commands.** The successor marks outstanding commands uncertain, as a restart
    does, so nothing is sent twice.
  - **Routing.** Laravel must reach the holder, and a standby must refuse
    `/internal/*`.
- *Recovery:* one to two seconds after a process crash, about the same as option A;
  ten to fifteen seconds after a host or network loss, where option A does not
  recover at all.
- *Devices see:* STATE offline, then online with a newer timestamp, and announce
  again. Data sent in between is lost, as in A.
- *Users see:* nothing under about 20 s; then unknown until the first heartbeat.
- *Cost, single node:* a second container (256 MB limit, idle) that protects only
  against the process: crash loops, memory, a stuck lock. Docker's restart already
  covers a plain crash.
- *Cost, two servers:* a standby on the database host cannot serve devices, because
  the broker and NATS are on the application host. It becomes useful only with a
  shape where the broker and NATS survive the application host, which is a larger
  decision ([ADR-019](ADR-019-mosquitto-only-broker.md)).

**C. Two hosts active at once.** Rejected. Sparkplug allows one primary host per
host ID, edge nodes follow one, two engines would validate the same `seq` stream
apart, and the release rule that two command-capable runtimes never serve the same
devices would be broken by design.

**D. Buffering at the edge.** An edge node that sees STATE offline keeps its
readings and sends them as historical when the host is back. It is the only option
that closes the data gap, and it also covers deploys and backups. It is work in the
SDK and the adapter publisher, not in the runtime, and historical readings do not
count as live evidence for automations. It is complementary to A and B.

### Sharding, later

**By broker connection, not by organization.** A Sparkplug session belongs to an
edge node on a connection and cannot be split, and a device hosted by another
organization's pipe ([ADR-039](ADR-039-hosted-devices-and-moves.md)) reports through
that organization's connection. So ingestion shards by connection. Automations are
the opposite: one can read devices from several connections of its organization, so
evaluation shards by organization. The committed telemetry stream is the seam
between the two keys and already is the only thing evaluation reads.

That gives three roles, which stay in one process until there is a reason to split:

| Role | Key | Holds |
| --- | --- | --- |
| Ingest | Connection | Broker client, session engine, storage consumer, commands, connectivity, captures |
| Pipeline | One for now, organization later | Committed relay, automation evaluator, telemetry stream fan-out |
| Housekeeping | One | Retention, ledger pruning, usage report |

What must become shard-aware, and what blocks it today:

| Area | Today | Needed |
| --- | --- | --- |
| Lock | One key | A key per shard |
| Control claim and state | `/outbox/claim` leases any rows to any caller; `/state` returns every connection and device | Rows and state filtered by connection; `iot.control.<connection>.<type>` |
| Telemetry hand-off | One subject, `iot.telemetry.device`; the storage handler needs the publisher's in-memory definitions | A subject per connection, a consumer per shard |
| Event outbox and inbox | One relay ordered by `created_at`; one inbox consumer in global order | Order per connection, which is all the events need; a relay and consumer per shard |
| Heartbeat | Any heartbeat refreshes every device and gateway in Laravel | Scoped to the sender's connections, or one shard's heartbeat hides another's death |
| Startup and maintenance sweeps | `RecoverCommands` marks every outstanding command uncertain; `expireCommands` settles commands it does not track; `PruneConnectivity` deletes rows it does not hold | Scoped to the shard's connections. As written, one shard restarting would cancel the others' commands and delete their rows |
| Committed relay order | One relay publishes by `sequence`; stream positions and the checkpoint depend on it | Stays single (pipeline role) |
| Automation evaluation | One checkpoint row; consecutive stream sequences | Stays single first; later a checkpoint per organization partition |
| Internal HTTP | One address; memory-backed endpoints | Laravel routes memory-backed calls by the device's connection; SQL-only calls can go anywhere |
| Telemetry stream | In-process fan-out fed by the relay | Stays with the relay, or moves behind JetStream ([roadmap](../roadmap.md#next)) |

Before sharding, three changes inside one process raise the ceiling: store messages
in parallel across devices or in batches, drop the automation consumer's per-message
stream lookups, and replace the one application mutex on the ingest path with
per-connection state.

## Decision

**The runtime stays a single active instance. It becomes safe to take over first,
is made redundant only on a shape where that helps, and is sharded by connection
only when a measured ceiling requires it.**

### Stage 1, now: takeover-ready and measured

1. **Leadership.** A runtime started with standby mode on waits for the advisory
   lock instead of exiting; the holder watches its lock session and stops when it
   loses it; an epoch is stored at each takeover; `/internal/status` and readiness
   report the role. Default behaviour, and both release shapes, are unchanged: one
   container, which exits if the lock is held.
2. **Restart defects.** One rebirth request per edge node on connect. A capture's
   suspension either survives a restart or the capture says plainly that it ended.
   The sweeps that act on everything (`RecoverCommands`, `expireCommands`,
   `PruneConnectivity`) take the set of connections they own, which is all of them
   today.
3. **Measurement.** A repeatable check that restarts and kills the runtime under
   the 500-device load and a paced SDK gateway and reports the gap, the births and
   the time commands are refused; and the single-instance ceiling for storage and
   for automation evaluation on both shapes. The numbers replace the estimates here.
4. **Rules for new runtime code**, added to the developer docs and checked in
   review:
   - New in-memory state says in a comment where it is rebuilt from after a
     takeover: PostgreSQL, JetStream, Laravel or a birth. If the answer is nowhere,
     it is stored.
   - State, rows, subjects and locks are keyed by connection (ingest) or
     organization (evaluation). No new row or lock that means "the deployment".
   - A startup or maintenance sweep takes the scope it owns as an argument.
   - Order is promised per device or per connection, never across the deployment.
   - An internal endpoint states whether it reads memory or only SQL; one that
     reads memory takes the device or connection, so it can be routed.
   - An event that updates many rows in Laravel names the connections it speaks for.
   - The per-device mutex is never the only guard of something another process
     could also do; a stored generation or claim backs it.

### Stage 2, deferred: a standing standby

Run option B as a second container. **Trigger:** a release shape in which the
broker and NATS outlive the application host, or a customer commitment on
availability, or runtime crash loops seen in operation. It needs its own ADR for
that shape. Edge buffering (option D) is recommended as its own spec before then,
because it is the only thing that removes the data gap; this record does not
schedule it.

### Stage 3, deferred: shards

Ingest shards by connection, with the pipeline and housekeeping roles single.
**Trigger:** the stage 1 measurement, after the in-process changes above, shows the
storage consumer falling behind at a rate a planned fleet will reach (pending
messages growing for five minutes), or one connection's load or faults must be kept
from the others. Evaluation by organization follows only if evaluation is then the
limit.

### Migration and rollback

Stage 1 has no data migration. The epoch is one new row in `device_runtime`,
created at startup and ignored by an older runtime. Standby mode is off unless set,
so rolling back is deploying the previous image. The rebirth fix and the scoped
sweeps change no stored format. Nothing in stage 1 changes a JetStream stream or
consumer, so the consumer-width trap of
[ADR-031](ADR-031-batched-runtime-events.md) does not arise.

### Size of stage 1

Three pull requests: leadership with a two-process integration test (the largest);
the restart defects and scoped sweeps; the measurement tooling with its results,
the developer rules and the atlas diagrams (`runtime`, `sparkplug-session`,
`telemetry-ingest`).

## Consequences

**Easier**

- A takeover is a tested path instead of an untested property of a restart.
- A runtime that has lost its lock stops, which nothing ensures today.
- A restart no longer makes a gateway announce twice.
- The throughput ceiling becomes a number, and the sharding trigger can be read off
  a dashboard.
- New code stops adding work for stage 3.

**Harder**

- Leadership adds a failure mode: a holder that stops itself on a database blip it
  would have ridden out before. The check interval and keepalive need care, and the
  two-server shape, where the database is across a tunnel, is where it will show.
- The rules cost a little on every runtime change, for a stage that may be far off.

**Not changed, and worth saying**

- Availability on today's shapes barely moves. Deploys and the nightly backup are
  the larger outages, the host is a single point of failure on both shapes, and
  data sent while the runtime is away is still lost until the edge buffers it.
- Starting still needs Laravel. A standby removes that for a takeover, not for a
  cold start; storing broker credentials in the runtime's schema would, and is not
  proposed.

**For the owner to weigh**

- Whether stage 1 is worth three pull requests when its visible result is one fixed
  defect and a set of measurements, with redundancy itself deferred.
- Whether edge buffering and shorter deploys and backups should come before any of
  this, since they remove more downtime and loss.
- Whether a shape with a second application host is on the roadmap; without it
  stage 2 has no place to run.

**To verify in stage 1, assumed here**

- That a second subscriber is refused while a durable consumer is still bound, and
  that the broker publishes the old client's will before the new client's online
  STATE when a client ID is taken over.
- That the SDK and the adapter publisher ignore an offline STATE older than the
  online one they hold.
