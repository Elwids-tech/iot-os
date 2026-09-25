# Committed telemetry

The runtime publishes accepted telemetry on `iot.committed.telemetry.v1` using
the `telemetry.committed.v1` contract. It does not publish rejected configurations,
empty packets or rolled-back writes. The original `iot.telemetry.device` subject
remains the pre-persistence storage handoff.

## Storage and delivery

`device_runtime.telemetry_outbox` is an additive table created during runtime
storage initialization. Its unique telemetry UUID is a durable deduplication
ledger. The projected event and telemetry writes share one transaction; duplicate
input returns without changing storage or creating another event. Device,
organization, generation and configuration must match the active stored device.

One dedicated relay reads up to 100 pending records in sequence order, publishes
with the telemetry UUID as `Nats-Msg-Id`, waits for the broker acknowledgement and
then records `published_at`. A full batch is followed promptly by another batch;
an idle pass waits one second. Failures retry with exponential delays from one to
30 seconds. Publication has a three-second deadline. Neither broker calls nor
backoff hold a device lock or occupy the lifecycle-event relay.

The `IOT_COMMITTED_TELEMETRY` stream has file storage, limits retention, a seven-day
maximum age, 768 MiB maximum size and `DiscardNew`. These are local-development
defaults, not a production throughput/retention SLA. Startup rejects incompatible
configuration instead of silently repurposing a stream. Saturation leaves new
work in the database; expired broker history requires reconciliation. Operators
must monitor disk growth during sustained broker outages.

Events are at-least-once. A crash after broker acceptance but before marking the
outbox row published can cause redelivery, including after broker deduplication
expires. Deduplicate by `event_id`, which equals `telemetry_id`. Do not depend on
exactly-once broker delivery.

The current single-runtime/device-lock boundary preserves per-device acceptance
order. `sequence` is the database outbox sequence represented as a decimal string
to avoid JavaScript integer rounding. It can have gaps and is not a global commit
order or a source-event-time ordering promise. JetStream stream sequence is a
separate delivery checkpoint.

Published outbox rows are retained in this first slice, including their projected
readings. Existing telemetry cleanup does **not** prune this ledger. Consequently
this internal copy can outlive the configured telemetry retention. Automatic
payload pruning and ledger expiry need a coordinated retention/replay policy
before production rollout. No historical table scan or backfill is performed;
previously persisted packets still pending on the ingestion stream can be
redelivered and acquire a committed-event record after upgrade.

## Contract semantics

The payload contains tenant/device/configuration/generation identity and an
explicit projection of each original reading. It excludes full definitions,
broker credentials, transport payloads and retained last-valid display metadata.

Good-quality readings represent observations; other qualities represent persisted
diagnostics. Invalid readings do not become good values simply because the latest
UI retains an earlier value. Historical readings retain `historical: true` and
must not be treated as new live evidence by future rule consumers.

`observed_at` and `received_at` retain current ingestion semantics. New readings
carry optional `timestamp_source` (`source`, `receipt`, `corrected_future` or
`derived`); legacy records without it have unknown provenance. Source presence
does not prove clock synchronization. See [location contracts](location-contracts.md)
for the conservative GPS eligibility policy and pairing requirements.

The subject contains multiple organizations. Only trusted internal services may
consume it; the consumer harness is privileged and is not an external application
SDK. Public tenant grants, scoped event projection, webhook delivery and browser
live updates remain separate work.

## Monitoring

`GET /internal/telemetry/committed-status`, protected by the existing runtime bearer
token, returns `pending`, `oldest_age_seconds`, and
`publication_failures_since_start`. The failure counter resets with the process;
pending work and age are queried from durable storage. Status-query failure
returns HTTP 503. Publication failures also produce structured warning logs.

Use the existing private runtime/network access to query this route; do not expose
the runtime or its token publicly. Telemetry backlog is independent of API and
broker connectivity readiness, so monitor the backlog endpoint explicitly.

## Example consumer

From `services/runtime`, with private `NATS_URL` supplied through the environment:

```bash
rtk proxy go run ./cmd/committed-consumer \
  -durable committed-demo \
  -state /absolute/private/directory/committed-checkpoint.json
```

The same binary is included at `/committed-consumer` in the runtime image. Use
`-max-messages 1` for a bounded smoke check (30-second deadline, adjustable with
`-timeout`). The state directory must already exist
and be writable. Output reports counts/checkpoints, not telemetry contents.

The harness maintains a file-backed projection keyed by event ID and a broker
sequence checkpoint. It fsyncs a temporary file, atomically replaces the checkpoint
and fsyncs the directory before acknowledging the message. It uses a process lock
to prevent concurrent writers and preserves large JSON numbers without converting
them to floating point. Restart with the same durable name and checkpoint path.

It refuses changed stream identity, a broker checkpoint ahead of the local file,
expired/missing history, unsupported event versions and conflicting event IDs.
These require reconciliation rather than an automatic reset. Do not delete the
checkpoint while retaining an acknowledged consumer. The retained event map is
intentionally a small development example, not a scalable production store or
an automatic historical reconciliation implementation.

## Verification

`rtk proxy node tooling/test-devices.mjs` runs the disposable database/broker suite
including committed-feed transaction, deduplication, publisher disconnection,
stream-capacity recovery, consumer restart, post-publication crash-window and
legacy-subject isolation tests. The new tests use only the disposable database;
broker tests refuse a pre-existing committed stream.

`rtk proxy go test ./...` from `services/runtime` runs unit and contract projection
checks; database/broker tests skip unless `DEVICE_TEST_DATABASE_URL` and
`DEVICE_TEST_NATS_URL` are supplied by the disposable harness. The Python contract
checker validates both existing device fixtures and the new event schema.

Rebuild the runtime container after source changes, then verify stream state,
authenticated backlog status and a bounded consumer against simulator data.
Hardware and production acceptance are not implied by local simulator success.
