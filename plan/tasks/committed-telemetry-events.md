# First delivery slice: committed telemetry events

**Status:** Implemented — local database/broker, simulator and rebuilt-container verification passed on 2026-09-25; production/hardware acceptance is separate  
**Date:** 2026-09-23  
**Parent:** [Core platform priorities for vertical applications](../roadmap/core-for-vertical-applications.md)

## Outcome

A durable downstream consumer can observe telemetry accepted by the storage boundary, recover after interruptions, and deduplicate repeated deliveries. This is the foundation for rules and later external application events.

The scope is a committed internal event contract and reliable publication. Public webhooks, SDK packaging, rule execution, location widgets and cattle records are separate stories. See [implementation and operating guide](../../docs/committed-telemetry.md).

## Pre-implementation evidence (2026-09-23)

- `services/runtime/internal/app/application.go` publishes `iot.telemetry.device` as an ingestion-to-storage handoff.
- `services/runtime/internal/app/control.go` consumes that subject, checks device generation/configuration, calls `Store.Persist`, and then performs command observation.
- `services/runtime/internal/storage/store.go` persists observations/diagnostics/latest values in a transaction and already contains an outbox mechanism for runtime lifecycle events.
- `Persist` can return successfully without accepting data when configuration/generation is no longer eligible. A nil error alone is not evidence for a new committed telemetry event.
- `services/runtime/internal/devices/types.go` contains telemetry identity, configuration/generation, per-reading quality, observed/received times and historical flag.
- `contracts/events/README.md` currently describes planned schemas rather than an implemented public event contract.

Do not expose the current ingestion subject as a promise of committed data, and do not change its consumers accidentally while adding the new feed.

## Delivered contract

`telemetry.committed.v1` is published on `iot.committed.telemetry.v1` through the dedicated `IOT_COMMITTED_TELEMETRY` stream. The schema and fixture live under `contracts/events/v1`. The contract includes:

- Stable logical event ID, original telemetry ID and contract version.
- Organization, device, configuration and generation identity.
- Parameter identities, typed values, units, quality and diagnostics permitted by the internal contract.
- Per-reading observed/received times and historical status; preserve timestamp provenance or record its absence explicitly.
- Correlation metadata sufficient to trace a downstream rule transition back to persisted input.

Do not copy complete device definitions, broker credentials, secrets or raw transport payloads into this event. The future external event is an explicit authorized projection and compatibility promise, not an automatic serialization of Go structs.

Define whether each reading represents an accepted observation or a diagnostic. A retained last-valid display value is not a new good observation. Historical observations remain marked historical. Do not promise global ordering or exactly-once physical delivery.

## Implementation boundaries

1. Validate executable schema and fixtures against current PHP/Go/TypeScript contract conventions.
2. Write an event/outbox record in the same transaction as the accepted telemetry writes. Enforce logical event uniqueness across redelivery and partial restart recovery.
3. A stale-generation/configuration no-op emits nothing. A transaction rollback leaves neither telemetry changes nor a committed event.
4. Reuse outbox patterns only after checking routing: existing lifecycle events are consumed by the Laravel runtime inbox. A telemetry feed must not inadvertently flood that inbox or change its supported event types.
5. Publish pending events to the dedicated durable subject, await broker acknowledgement, then mark publication. Re-publication after a crash uses the same event identity; consumers still deduplicate beyond broker deduplication windows.
6. Keep command observation and lifecycle fencing unchanged. Persisted diagnostic events must not become successful command observations or eligible good-quality GPS fixes.
7. Define deterministic per-device ordering/checkpoint behavior, bounded batches, retry/backoff, backlog metrics and retention/pruning. Ingestion and command handling must not wait for a webhook subscriber.
8. Size the feed by device count, event rate and payload size before selecting retention/limits. State behavior when capacity is exhausted; never silently drop unpublished work. Event retention and telemetry retention are separate policies.

## Required verification

| Scenario | Expected evidence |
| --- | --- |
| Normal transaction | Persisted telemetry plus one logical committed event with matching identities |
| Storage rollback | Neither data mutation nor event is visible |
| Same telemetry redelivered | No new logical event; existing storage deduplication remains intact |
| Stale generation/configuration | No committed event for rejected/no-op telemetry |
| Broker unavailable after commit | Outbox retains work; publication resumes after recovery |
| Crash after publish before marking sent | Stable ID on redelivery; a durable sample consumer applies it once |
| Invalid/historical reading | Correct classification survives the contract; no invented fresh good value |
| Two organizations | Correct tenant identity is preserved; sample consumer never mixes tenant state |
| Device lifecycle/command regression | Existing activation, deactivation, history and command observation checks pass |
| Backlog and restart | Metrics expose pending age/count; bounded publication resumes without silent gaps |

Use real database/broker integration checks for transaction and crash-window claims, not mocks alone. Add fixtures to contract validation, a minimal non-UI consumer harness and a reproducible recovery command. Rebuild the affected runtime/API containers if their artifacts change, verify the active stack without resets, and record simulator evidence separately from hardware evidence.

## Handoff to the next story

Document the committed feed, delivery semantics and migration/recovery behavior. The following location-fixture story binds valid coordinate pairs to this feed and establishes the inputs for the rules engine. Do not mark the rules engine, external API, or complete P0 milestone delivered by this event slice alone.

## Delivery evidence — 2026-09-25

- Go unit/projection checks and `go vet ./...` passed. Disposable Go tests ran with the race detector against real TimescaleDB and JetStream.
- Committed-event tests passed transaction rollback, stale-generation/configuration/tenant rejection, redelivery, historical/invalid classification, consumer restart before acknowledgement, publication retry beyond broker deduplication, stream saturation/recovery and legacy-subject isolation.
- The complete disposable Devices suite passed API/tenant/command checks, browser/lifecycle flows, TLS/ACL checks, and broker/database/runtime interruption recovery. Existing history assertions were corrected to compare time instants independently of local timezone.
- The runtime image was rebuilt and recreated using the existing local Compose overlays. Health returned 200; authenticated backlog status returned 200 and unauthenticated status returned 401.
- The packaged consumer processed two simulator events across separate invocations using one durable checkpoint. Captured events validated against the JSON schema; the temporary simulator was stopped afterward.
- Published outbox payloads are intentionally retained; pruning, public delivery and full P0/location completion remain deferred.
