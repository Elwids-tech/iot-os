# ADR-031: Runtime Events Reach Laravel in Ordered Batches

**Status:** Accepted
**Date:** 2026-11-06
**Amends:** [ADR-014](ADR-014-control-plane-data-plane-http-integration.md)

## Context

[ADR-014](ADR-014-control-plane-data-plane-http-integration.md) has the runtime relay
its events to JetStream `IOT_DEVICE_EVENTS`, where the durable consumer
`devices-control-inbox` POSTs each one to `POST /api/internal/devices/events`. The
consumer allowed one unacknowledged message (`MaxAckPending(1)`), so delivery ran at
one event per request round trip, whatever the API's capacity. Order mattered and
was kept by that: a device's outcome, presence and command statuses, a gateway's
births and deaths, and events that touch many rows at once (`connection.presence.v1`,
`runtime.heartbeat.v1`) all apply in the order the runtime emitted them.

The embedded SDK (spec 026) targets gateways with hundreds of devices. A source that
reports every 10 s sends a `discovery.presence.v1` each time (the runtime reports a
source's presence at most every 5 s), and an active device adds a
`device.presence.v1`. On 2026-11-05, 500 SDK-simulated devices reporting every 10 s
(`tooling/verify-embedded-sdk.mjs`) produced about 50 events/s before activation and
75 after, against a dev API (`php artisan serve`) that took 22 to 38 a second. The
backlog grew without bound (14,850 events that day, 13,358 when measured again on
2026-11-06), and activation outcomes and command statuses reached Laravel minutes
late; the check failed waiting for an activation. A release serves the API with
PHP-FPM behind nginx, which is faster per request, but one event per round trip
still caps it (see Consequences for the numbers).

## Decision

- **The consumer takes events in batches.** `devices-control-inbox` allows 200
  unacknowledged events. One goroutine posts whatever has been delivered, up to 100
  events and 1 MiB, to `POST /api/internal/devices/events/batch` as
  `{"events": [...]}`, and settles every event of that batch before it posts the
  next. Order is the stream's, across all devices, as before.
- **Laravel applies a batch in one transaction, an event per savepoint.** It answers
  `{"results": [...]}`, one result per event in order, each with the `status` the
  single endpoint would have returned. An event that can never apply (one the single
  endpoint answers 409 or 422, such as a malformed payload) is rolled back to its
  savepoint and answered on its own; the runtime dead-letters it, and the others still apply. Anything the
  runtime would retry (a 5xx, a lost connection, a deadlock) rolls the whole batch
  back, and the request fails.
- **A failed batch is retried in place.** The runtime keeps the batch and the events
  behind it, marks them in progress so the broker does not deliver them again, and
  sends the same batch again with the same backoff as before (3 s doubling to 1
  minute). No later event overtakes it, as when the consumer took one at a time. If
  Laravel refuses a whole batch as invalid, the runtime sends its events one at a
  time so only the event at fault is dead-lettered.
- **Deduplication is unchanged.** Each event still inserts its UUID into
  `device_inbox`; a redelivered batch is answered with `duplicate` per event.
- `POST /api/internal/devices/events` stays for a single event and for tests.
- The runtime widens an existing `devices-control-inbox` consumer to 200 at startup.
  The other consumers (`devices-control`, `devices-storage`) keep one message in
  flight ([roadmap](../roadmap.md#next)).

## Consequences

- Throughput no longer depends on one request per event. Measured on the dev stack
  on 2026-11-06 by replaying events recorded from the 500-device check (two thirds
  `discovery.presence.v1`, one third `device.presence.v1`) with fresh UUIDs, in
  events per second:

  | API serving | One per request | Batches of 100 |
  | --- | --- | --- |
  | Dev, `php artisan serve` | 38 | 497 |
  | Release, PHP-FPM behind nginx (`Dockerfile.release`) | 45 | 427 |

  So a release, too, fell behind a 500-device gateway reporting every 10 s (50 to 75
  events a second) while events went one per request; per request, the framework's
  start-up cost more than the event's own queries.
- With batches, `tooling/verify-embedded-sdk.mjs` passes every step with devices
  reporting every 10 s, and a 10-minute soak at 75 events a second leaves no backlog
  (45,822 events, at most 9 waiting to be delivered). From the runtime writing an event
  to Laravel recording it took p50 1.3 s, p95 3.2 s and at most 6.1 s, against p50
  195 s and up to 398 s before. Most of what remains is the runtime's outbox relay,
  which publishes to JetStream one event at a time every second (p95 3.0 s); delivery
  from JetStream to Laravel took p95 0.5 s.
- A batch holds its rows' locks until it commits, up to 100 events. A
  `runtime.heartbeat.v1` in a batch updates every applied device, so a person's change
  to a device can wait for the rest of that batch.
- One transient failure delays the events behind it, as before; the runtime logs
  `durable consumer blocked by a failing batch` every 10 attempts.
- **Rolling back the runtime past this change** needs the consumer narrowed first: an
  older runtime refuses to subscribe to a consumer whose window is not 1 ("configuration
  requests max ack pending to be 1, but consumer's value is 200"). Set it back with the
  NATS CLI, for example `nats consumer edit IOT_DEVICE_EVENTS devices-control-inbox
  --max-pending 1`, before starting the older runtime.
