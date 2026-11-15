# Runtime: rules for new code, and what one instance carries

The runtime ([`services/runtime`](../../services/runtime)) runs as one active
process. ADR-046 keeps it that way for now, makes a takeover safe, and names the
point at which ingestion is split by broker connection. This page holds the rules
that keep new code from making that split harder, and the measurements that say how
far one instance goes.

## Rules for new runtime code

A takeover, like a restart, starts from what is stored and from fresh births. A
shard, later, owns some broker connections and not others. Code written today should
survive both.

1. **Say where in-memory state comes back from.** New state held in the process
   carries a comment naming what rebuilds it after a takeover: PostgreSQL,
   JetStream, Laravel's state response or a Sparkplug birth. If nothing does, store
   it.
2. **Key by connection or by organization.** State, rows, subjects and locks on the
   ingest side (sessions, storage hand-off, commands, connectivity, captures) are
   keyed by broker connection. Automation state is keyed by organization. Do not add
   a row, a lock or a subject that means "the deployment". Where one value covers
   everything today, give it a scope column with one value, as
   `device_runtime.runtime_leaders` does.
3. **A sweep takes the scope it owns.** Code that recovers, expires or prunes at
   startup or on the maintenance tick takes a
   [`storage.Scope`](../../services/runtime/internal/storage/scope.go) and touches
   only what reports through those connections, even while the only scope in use is
   every connection.
4. **Promise order per device or per connection.** Nothing new may depend on one
   order across the whole deployment. The committed telemetry sequence and the
   automation checkpoint do today; do not add a third.
5. **Say whether an internal endpoint reads memory.** An endpoint that answers from
   SQL alone can be served by any runtime. One that reads the process's memory can
   be served only by the runtime that owns the device's connection, so it takes the
   device or the connection in its request.
6. **A fan-out event names what it speaks for.** An event that makes Laravel update
   many rows (the heartbeat, connection presence) carries the connections it covers,
   so that one runtime's event never vouches for another's devices.
7. **The per-device mutex is not a fence.** `lockDevice` orders work inside one
   process. Anything another process could also do is guarded by something stored: a
   generation, a claim row, a unique key.

## Measuring a restart

[`tooling/measure-runtime-restart.py`](../../tooling/measure-runtime-restart.py)
restarts the runtime container, or kills it and starts it later, while devices
report, and prints how long the process was away, how soon devices stored readings
again, the readings they missed, how often each edge node announced itself and when
the control plane showed devices unknown. Run it under a simulator, or under the
embedded SDK check, which holds its 500 devices reporting while a command runs:

```sh
EMBEDDED_WHILE_REPORTING="tooling/measure-runtime-restart.py --mode kill --down 30" \
  node tooling/verify-embedded-sdk.mjs
```

An edge node that follows the host's STATE announces once when the runtime comes
back online and once more for the runtime's rebirth request, within the same second.
More announcements than two mean a repeated request.

Measured on the dev stack on 2026-11-15 with a runtime built from the three stage 1
changes of ADR-046, under the embedded SDK check: one gateway announcing 500 devices
at 20 births a second, about 248 of them onboarded and reporting every 10 s.

| | Restart | Killed, started 30 s later |
| --- | --- | --- |
| Process away | 0.1 s | 30.2 s |
| Onboarded devices storing again | 249 of 249 | 248 of 248 |
| After the start: first, median, last | 0.3 s, 6.5 s, 12.8 s | 1.4 s, 7.6 s, 13.9 s |
| Readings missed (estimate) | 313 | 857 |
| Announcements per edge node | 2 | 2 |
| Shown unknown | Never | From 12 s to 42 s after the kill, up to all 248 |

- The process is back in well under a second. What a restart costs a paced gateway
  is its announcement: a device sends no data until its birth has gone out again, so
  the last onboarded device was back 13 s after the start and each device missed
  about one reading. That cost is the gateway's pacing, not the runtime's start.
- Nothing sent while the runtime is away is stored afterwards: the crash lost about
  three and a half readings a device, 30 s of them and the announcement.
- With three unpaced simulator meters the same restart lost nothing and the devices
  were back in 0.3 s.
- Not measured: the broker publishing the host's will after a crash, commands in
  flight, and automation timers across the gap.

## Measuring what one instance carries

Three stages handle one message at a time, so each has a ceiling whatever the
hardware has spare: the storage consumer, the committed relay and the automation
evaluator. `BenchmarkPipeline` in
[`internal/app`](../../services/runtime/internal/app/pipeline_bench_integration_test.go)
drains ten-reading messages from 50 devices through the code each stage runs and
reports messages a second per stage. `DEVICE_BENCH_ROUND_TRIP` delays everything
sent to the database, which stands in for a database on a second host; the
benchmark reports the round trip it measured.

```sh
cd services/runtime
DEVICE_TEST_DATABASE_URL=... DEVICE_TEST_NATS_URL=... DEVICE_BENCH_ROUND_TRIP=1ms \
  go test ./internal/app -run '^$' -bench Pipeline -benchtime 1500x
```

Measured on 2026-11-15 on a developer laptop (Apple M2 Max, PostgreSQL 17 with
TimescaleDB and NATS 2.14 on the same machine), messages a second:

| Database round trip | Stored | Relayed | Evaluated, no automation | Evaluated, a geofence per device |
| --- | --- | --- | --- | --- |
| 0.05 ms (same host) | 720 | 2,600 | 600 | 540 |
| 0.46 ms | 215 | 1,100 | 93 | 84 |
| 1.3 ms | 83 | 445 | 36 | 31 |

Reading the differences between rows, a message costs about 8 database round trips
to store, 1 to 2 to relay and about 21 to evaluate. The evaluator looks up the
stream, checks the checkpoint and runs the timer pass around every message; the
storage consumer checks outstanding commands after every message.

What follows:

- On one host a runtime stores about 700 messages a second and evaluates about 550,
  against a tested rate of 50 (500 devices every 10 s). Sharding is not needed for
  throughput on that shape.
- With the database on a second host the ceiling is set by the round trip. At about
  half a millisecond the evaluator carries about 85 messages a second; at 1.3 ms it
  carries 31 to 36, **below the tested rate**. Automations then fall behind while
  readings are still stored. Measure the round trip of a two-server deployment
  before loading it past a few hundred devices.
- The cheapest gains are inside the process, not in shards: drop the evaluator's
  per-message stream lookups and checkpoint checks, and take the outstanding-command
  check off the storage path. Those are recorded in the [roadmap](../roadmap.md#next).
- These are one laptop's figures and the delay is simulated. They rank the stages
  and show how each scales with the round trip; they are not a capacity promise for
  a server.
