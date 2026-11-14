# ADR-042: Store Telemetry Once

**Status:** Accepted 2026-11-14; not built yet
**Date:** 2026-11-14
**Relates to:** [ADR-014](ADR-014-control-plane-data-plane-http-integration.md), [ADR-036](ADR-036-runtime-counts-data-points.md), [spec 030](../../specs/030-plant-following-applications/spec.md) (telemetry stream)

## Context

Storing one telemetry message writes its readings twice, in one transaction
([`store.go`](../../services/runtime/internal/storage/store.go)):

- one row per reading in `device_runtime.observations` (good readings) or
  `diagnostics` (the rest), and
- the whole message again, as one JSON event, in `device_runtime.telemetry_outbox`.

The outbox row has three jobs. It is the **publish queue** for the committed
telemetry stream, the **deduplication ledger** that makes a redelivered message a
no-op, and the **source of whole events** for the features that need a message's
readings together:

| Reader | Code | Needs |
| --- | --- | --- |
| Committed relay | [`committed.go`](../../services/runtime/internal/app/committed.go) | Unpublished rows, in order |
| Telemetry stream catch-up | [`stream.go`](../../services/runtime/internal/app/stream.go) | Recent events by sequence |
| Location by event | [`location.go`](../../services/runtime/internal/app/location.go) | One event's location readings, its sequence and generation |
| Location map: latest and trail | [`location_map.go`](../../services/runtime/internal/app/location_map.go) | A device's events over a range |
| Workflow location overview | [`workflow_overview.go`](../../services/runtime/internal/app/workflow_overview.go) | A device's latest event |

Because of the last three, cleanup keeps a published row for as long as the
organization's measurement retention, and never less than the eight-day ledger
window.

That makes the outbox the largest part of long-term telemetry storage. Observations
compress well: the schema notes about 1 KB a reading before compression and about
55 bytes after, two days later. The outbox is not compressed and repeats, for every
reading, the identifiers, names and timestamps that the observation row already
holds. On a database measured on 2026-11-01, an event of four to ten readings took
about 2.1 KB with its indexes, and the outbox was about 85% of the telemetry kept
beyond the first week. At a 400-day retention the long-term cost of a data point was
about 270 bytes, of which the readings themselves were 55.

Storage, not compute, is the platform's main running cost, so this sets how many
data points and how much retention a plan can include.

Two things were considered and set aside:

- **Typed value columns in place of the `reading` JSON.** Compression already brings
  a reading to about 55 bytes. Typed columns would save a little more and would
  change every history query. Not worth it now.
- **Compressing the outbox.** Compressing 1,000 events together shrinks them 34
  times, but the table is read by event and updated on publish, which compressed
  storage serves badly, and it would still be a second copy.

## Decision

**A reading is stored once, in `observations` or `diagnostics`. The outbox keeps a
message's full event only while it is a queue and a ledger: eight days.**

1. **A slim event row for the long term.** The storage transaction also inserts one
   row per stored message into a new table, `device_runtime.telemetry_events`:
   sequence, telemetry UUID, organization, device, configuration, generation,
   received time, and the readings the transaction skipped as re-sent samples, if
   any. It holds no reading values. It is kept for the organization's measurement
   retention and is what gives an old event its identity, order and generation.
   The row takes the same sequence as the outbox row, so positions mean the same in
   both.
2. **The outbox is pruned at the ledger window.** A published outbox row is deleted
   eight days after it was created, whatever the organization's retention. Eight
   days stays longer than the seven days JetStream can redeliver a message, so the
   ledger still makes every redelivery a no-op. (Before this decision a shorter
   retention also kept the row eight days, for the same reason.)
3. **Location readers rebuild events.** Location by event, the location map and the
   workflow location overview read `telemetry_events` for the events, then the
   readings of the binding's parameters from `observations` and `diagnostics` by
   event UUID and received time. They never read the outbox. There is one read path
   for a recent event and an old one.
4. **A re-sent sample is read from the row that already holds it.** When a device
   reconnects and sends a buffered sample again, the storing transaction skips it
   because an earlier message stored the same parameter, observed time and value.
   The event row names what was skipped, and a reader takes that reading from the
   earlier row. A rebuilt event is therefore the event that was published, and
   location trails and latest positions do not change.
5. **The relay and the telemetry stream are unchanged.** The relay publishes from
   the outbox as now. The stream's catch-up already documents a retention of eight
   days and answers an older position with `reset`; the outbox now holds that window
   and no more.
6. **Automations are unchanged.** The evaluator reads the committed stream, which
   still carries every reading of a message, including a re-sent sample.

### Migration

A schema step at runtime startup, in this order:

1. Create `telemetry_events` and fill it from the existing outbox rows (the event
   JSON has every column it needs). Devices keep their trails across the upgrade.
   Only sequences above the newest event row are copied, so later startups copy
   nothing.
2. From then on the cleanup loop prunes outbox rows past the window, in its usual
   batches. Nothing is deleted at startup.

Deleting rows does not return disk space to the operating system. An installation
that wants the space back runs one `VACUUM FULL` (or `pg_repack`) on the outbox
after the first cleanup has caught up; the release notes say so. Rolling back to the
previous runtime is safe: it ignores the new table and reads the outbox, where
events older than the window are then missing from location trails.

## Consequences

**Easier**

- Long-term storage for a message's event drops from about 2.3 KB to about 300
  bytes (measured: 2,347 and 301 bytes an event with indexes, on a year of
  one-minute messages of five readings). Its readings are unchanged at about 55
  bytes each once compressed. For that device a data point goes from about 525 bytes
  to about 115. Plans can include several times more data points or retention on the
  same disk.
- The outbox stays small and bounded by throughput, not by retention, so its indexes
  and the stream's floor and head queries stay fast.
- `diagnostics` gains a reader. Today nothing reads it but cleanup.

**Harder**

- A location trail costs two queries (events, then readings) where it cost one.
  Measured on the same year of data, a week-long trail 200 days back took 160 to
  210 ms from the outbox, which it scanned by sequence, and takes about 3 ms from
  the event rows and compressed readings.
- A rebuilt event lists its readings in parameter order, not the order the message
  carried them. Nothing depends on that order.
- The storage transaction gains one small insert per message. It travels with the
  usage update, so it adds no round trip, and the transaction is no slower.
- The event row could be smaller still as a compressed hypertable. Not needed yet.

**Follow-up**

- [`docs/features/integrations.md`](../features/integrations.md) describes the
  stream's retention as the outbox's eight days. Before this decision the code kept
  outbox rows for the full measurement retention, so `reset` fired later than
  documented. This decision makes the code match the document.
- The atlas diagrams for the storage tables, retention and the query path change
  with the implementation, not with this record.
