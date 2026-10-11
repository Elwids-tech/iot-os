# Durable workflow execution

Delivered 2026-09-25. [API and behavior](../../docs/durable-workflow-execution.md).

- Explicit idempotent activation/disable with immutable snapshots and separate
  desired/applied status. Draft editing leaves applied snapshots intact.
- Tenant/device/configuration/generation fencing; numeric source-coordinate
  validation in Go. Suspended/replaced/disabled versions preserve episode history.
- Durable committed-telemetry consumer, SQL event deduplication, atomic
  state/checkpoint/transitions/outbox and restart-safe timers.
- Durable acknowledgements and transition projection through the existing
  runtime inbox; tenant-scoped transition history and execution reads.
- Stream replacement/retention gaps fail explicitly; runtime readiness reflects
  consumer failure. Broker acknowledgement leases can delay restart delivery by
  up to 30 seconds; recovery still rechecks GPS freshness.

Verification:

- 122 Laravel tests passed, including activation permissions, retry identity,
  immutable snapshots, acknowledgement ordering and transition deduplication.
- Go race tests and vet passed. Isolated PostgreSQL tests cover transactional
  rollback on outbox failure, duplicate input, timer recovery and binding fences.
- Real JetStream integration covers committed publication, duplicates, broker
  acknowledgement, consumer restart and rejection of a replaced stream.
- Full disposable Devices suite passed including existing browser flows,
  command deadlines, TLS isolation and database/broker interruptions.
- Rebuilt runtime, API and assistant worker; local API/runtime/outbox/broker
  round trip verified activate → outside → clear → disable. The verification
  fixture uses a temporary organization and synthetic source, then cleans up
  its own records without resetting the global checkpoint.

Reproduce using `tooling/verify-workflow-execution.php` inside the local API
container. The existing `tooling/verify-workflow-drafts.php` still verifies all
13 simulation steps without operational side effects.

Next: P2 alert episodes and notification delivery. No visual builder, assistant
workflow tool, notification channel or automatic physical-device action is
included in this slice.
