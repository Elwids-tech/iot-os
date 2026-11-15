# ADR-043: The Runtime Applies Control Messages Straight from the Claim

**Status:** Proposed
**Date:** 2026-11-15
**Amends:** [ADR-014](ADR-014-control-plane-data-plane-http-integration.md)
**Relates to:** [ADR-031](ADR-031-batched-runtime-events.md)

## Context

A control message is queued twice before the runtime acts on it
([ADR-014](ADR-014-control-plane-data-plane-http-integration.md)):

1. Laravel writes a `device_outbox` row with the state change
   ([`DeviceAudit::enqueue`](../../apps/api/app/Domain/Devices/Services/DeviceAudit.php)).
2. The runtime's relay claims up to 100 rows a second on a 30-second lease, publishes
   each to JetStream `IOT_DEVICE_CONTROL` and acknowledges the row
   (`relay` in [`control.go`](../../services/runtime/internal/app/control.go),
   `claim` and `ack` in
   [`RuntimeController`](../../apps/api/app/Domain/Devices/Http/Controllers/RuntimeController.php)).
3. The same process consumes the stream with the durable `devices-control`, one
   message at a time, and applies it (`handleControl` in
   [`application.go`](../../services/runtime/internal/app/application.go)).

The stream has one writer and one reader, and both are the runtime. Events travel
the other way through a similar pair: `device_runtime.outbox`, then JetStream
`IOT_DEVICE_EVENTS`, then batches to Laravel
([`inbox.go`](../../services/runtime/internal/app/inbox.go)). An architecture review
asked whether either stream earns its place.

### What the control stream provides, and what already provides it

| Property | Through JetStream today | Without it |
| --- | --- | --- |
| Nothing is lost | The row is acknowledged once it is in the stream, **before** it is applied; the file-backed stream then holds it | The row stays unacknowledged in `device_outbox` until it is applied. The outbox is already durable and written with the change |
| Survives a restart between claim and apply | The stream redelivers to the durable consumer | The lease runs out after 30 s and the row is claimed again. This path exists today for a crash between claim and publish |
| Applied once | `Nats-Msg-Id` removes a republished row for two minutes (the stream's duplicate window). After that, and for redeliveries, the handlers decide | The handlers, as today. Each is idempotent: activation and deactivation compare generations and replay a saved outcome (`transition`, `deactivate`, `Store.ReplayOutcome`); a command is claimed once by its UUID (`Store.ClaimCommand`); a deployment at a generation already handled commits nothing (`Store.DeployDAG`, `Store.DeployRule`); `connection.changed.v1` re-reads state |
| Order | Rows are claimed by `id` and consumed in stream order | Rows are claimed by `id` and applied in that order |
| One at a time | `MaxAckPending(1)` | One loop |
| Retry with backoff | `NakWithDelay`, 3 s doubling to 1 minute by delivery count (`settle` in [`deadletter.go`](../../services/runtime/internal/app/deadletter.go)). A failing message blocks every message behind it | Must be rebuilt in the runtime. The events inbox already retries a batch in place with the same delays (`deliverBatch`) |
| Dead letters | A message that can never apply is copied to `IOT_DEAD_LETTERS` and terminated | Must be rebuilt: `deadLetter` takes its context from JetStream metadata |
| Lease | Short: a row is leased only for the publish | The lease has to cover the apply, or stop mattering (below) |
| Laravel offline | Messages already in the stream still apply | Only the batch in memory applies. New intent cannot be written while Laravel is down, so little is lost |

Order is not strict today either. A row whose acknowledgement failed, or whose claim
died with the process, comes back after its lease and can follow a later row. The
generation fences are what make that safe, on both sides.

Two properties exist **only because of** the stream, and neither is wanted:

- `published_at` means "copied to another queue", not "applied". A control message
  stuck behind a failing one does not show in `iot_device_outbox_pending`; it shows
  only in the NATS consumer's pending count
  ([`Operations.php`](../../apps/api/app/Support/Operations.php)). Recovery quarantine
  suppresses unpublished command rows in `device_outbox` and cannot reach one that is
  already in the stream
  ([`QuarantineRestoredSideEffects`](../../apps/api/app/Console/Commands/QuarantineRestoredSideEffects.php));
  whether that one is sent then rests on the command's own expiry time.
- The stream can fill (64 MiB, discard new). Work then waits in `device_outbox`
  anyway.

### What the hop costs

Measured on the dev stack on 2026-11-15, read-only, from what the stack had kept: the
3,262 messages in `IOT_DEVICE_CONTROL` (seven days, mostly bulk runs of the
500-device check), joined by operation to the outcome the runtime stored.

| Stage | n | p50 | p95 | p99 | max |
| --- | --- | --- | --- | --- | --- |
| In JetStream → outcome transaction begins, deactivations | 1,617 | 0.9 ms | 2.2 ms | 9.8 ms | 81 ms |
| In JetStream → outcome transaction begins, activations applied | 1,630 | 1.0 ms | 6.0 ms | 19.9 ms | 158 ms |
| Row written → in JetStream (row time has 1 s resolution) | 3,262 | 1.2 s | 2.2 s | 33.6 s | 41.5 s |

**The stream adds about a millisecond.** The delay is before it: the one-second
claim poll, and in a bulk change one acknowledgement request per row. The 33 to 41 s
tail is 500 rows leaving at 12 to 15 a second, which matches the dev API's rate for
single requests in [ADR-031](ADR-031-batched-runtime-events.md). The roadmap already
lists this ([Parallel control consumers](../roadmap.md#next)).

For events, on the same stack while idle (3,524 events in 24 hours): stored →
JetStream p50 0.51 s, p95 0.98 s, p99 1.07 s; Laravel recorded them within about a
second (its inbox time has 1 s resolution). Under load, ADR-031 measured p50 1.3 s
and p95 3.2 s end to end, of which the relay into JetStream was p95 3.0 s and
JetStream to Laravel 0.5 s.

Not measured: commands (the dev stack's nine command rows are older than the stream's
retained messages), and a release build under load. No runtime test measures latency.

### Events: does ADR-031's batching depend on the stream?

No. Batching needs an ordered backlog, a bounded batch, retry in place and a
dead letter per event. `device_runtime.outbox` is already the ordered backlog, and
the order Laravel sees today is the order the relay reads it in. A relay that posted
unpublished rows to `events/batch` and marked them from the answers would do the
same job and remove the stage that holds most of the remaining delay.

Three things make it a different size of change from the control path:

- It is the high-volume path (50 to 75 events a second from one 500-device gateway),
  rebuilt eight days ago after a backlog incident, measured and soaked as it stands.
- The relay takes each event's device fence while it publishes
  (`lockDevice` in `relay`). A fence cannot be held across a request to Laravel, so
  what it protects has to be established first.
- The same delay can be removed without touching the stream: mark a published batch
  in one statement and give the claim its own loop, as the roadmap says.

NATS itself stays in every option. `IOT_DEVICE_TELEMETRY` and
`IOT_COMMITTED_TELEMETRY` are real stage boundaries with independent consumers, and
`IOT_DEAD_LETTERS` stays with them. No option removes a service to run.

## Options

**A. Keep both streams.** Nothing breaks today and the control stream costs a
millisecond. Acknowledging a claim in one request, the only measured gain, can be
done without any other change. The double queue, its two backlog gauges and the
"published is not applied" meaning stay.

**B. Apply control messages from the claim; keep the events stream.** Removes one
stream, one consumer and the republish. `device_outbox` becomes the only queue of
intent and its pending count becomes true. Costs a new apply loop on the path that
sends commands, and no speed.

**C. B, and post events from the runtime's outbox.** Removes both streams. Adds a
second rebuild of the busiest path, with an open question about the device fence,
for a delay that has a smaller fix.

## Decision

**Option B, with the acknowledgement batched. The events path stays as ADR-031 left
it.** Option C is not taken now; it needs its own record after B has run, and after
the relay's smaller fix has been measured.

1. **The runtime applies a claimed row and then acknowledges it.** `published_at`
   comes to mean applied or set aside. Rows of a claim are applied in `id` order, one
   at a time, by the handlers that exist. Nothing is published to
   `IOT_DEVICE_CONTROL`.
2. **A row that fails for now is retried in place.** The runtime keeps that row and
   the rows behind it, retries with the existing delays (3 s doubling to 1 minute) and
   claims nothing more until it passes, so no later row overtakes it. This is what a
   failing message does to `devices-control` today.
3. **A row that can never apply is dead-lettered and acknowledged.** It goes to
   `IOT_DEAD_LETTERS` under `iot.deadletter.devices-control`, as now, with the row
   UUID as its message ID, so the count, the alert and the runbook keep working. If
   the letter cannot be stored the row is retried, as now.
4. **The lease stays at 30 seconds and fences by token, not by time.** Only one
   runtime runs (advisory lock), and it does not claim while it holds rows, so a row's
   token stays current however long the apply takes; `ack` already accepts a current
   token after `leased_until`. The lease's one job is to hand the rows of a dead
   process to the next one. That becomes a tested contract.
5. **A claim is acknowledged in one request.** A new
   `POST /api/internal/devices/outbox/ack` takes the applied rows' UUIDs and tokens.
   The single-row endpoint stays.
6. **The claim gets its own loop.** Applying can take seconds (a command waits up to
   5 s for the broker, a state refresh up to 10 s), and the relay of runtime events
   must not wait behind it.

### Migration

One release, in this order at runtime startup:

1. Subscribe to `devices-control` as now and apply what an earlier runtime left in
   the stream, until the consumer has nothing pending or unacknowledged.
2. Only then start claiming. From here nothing is published to the stream.

The stream and its consumer are left in place, empty, for that release. A later
release stops creating them and drops `IOT_NATS_CONTROL_MAX_BYTES`, the consumer
from the metrics' expected list, and the drain.

### Rollback

Start the earlier runtime. It finds the stream and consumer unchanged (or creates
them empty), claims every row the newer runtime had not acknowledged, and those rows
are ones the newer runtime had not finished applying, or had applied and will see
again as repeats. No consumer setting has to be edited first, unlike ADR-031. The
batch acknowledgement endpoint is additive.

## Consequences

**Easier**

- One queue of intent. `iot_device_outbox_pending` and its alert show control work
  that is waiting or stuck; the control stream drops out of `iot_nats_consumer_pending`.
- Recovery quarantine reaches every command that has not been dispatched.
- A stream-full state, a consumer whose settings can drift from the code, and the
  two-minute duplicate window stop being things to reason about.
- Applying in parallel across devices, the roadmap's next step for bulk changes,
  becomes goroutines keyed by device over one claim instead of a stream redesign.
- A bulk change of 500 devices should reach the runtime in a few seconds on a dev
  API, from the batched acknowledgement alone. This needs measuring when built.

**Harder**

- This rewrites how activations, deactivations and commands are picked up, for no
  gain in single-message latency. The risk is in the retry loop and the drain, and
  commands must still never be sent twice; `Store.ClaimCommand` remains the guard and
  needs a test for a row applied but not acknowledged.
- The retry count lives in memory and restarts at 3 s after a runtime restart.
- After a crash, rows the dead process held wait up to 30 s for their lease, and rows
  written meanwhile can be applied first. The fences drop the late ones, as they do
  today after a failed acknowledgement.
- Unapplied work sits in `device_outbox`, in the main database, instead of in NATS.
  At 100 rows a claim this is small; `devices:prune-ledgers` is unchanged.
- A row is unacknowledged for as long as it takes to apply, so
  `iot_device_outbox_pending > 100` will fire during a large bulk change where it
  did not before. The threshold moves to the age of the oldest row.

**Follow-up, in the pull request that builds this**

- [`docs/reference/events.md`](../reference/events.md),
  [`docs/architecture/overview.md`](../architecture/overview.md), the roadmap entry,
  ADR-014's status line, the monitoring rules and dashboards, and the atlas diagrams
  `activation` and `activation-flow`.
- Measure a 500-device bulk change before and after, and a command from confirmation
  to dispatch.
- A separate record for the events path, if the relay's smaller fix leaves a delay
  worth another change.
