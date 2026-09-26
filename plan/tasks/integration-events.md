# Durable alert journal and consumer recovery

Delivered 2026-09-25. [Contract and operational limits](../../docs/integration-events.md).

- Transactional public snapshots for alert activation, clearing and acknowledgement; logical deduplication and clear-before-activation semantics preserved.
- Per-organization stream locks guarantee commit-ordered positions, including concurrent commits and rollback.
- Authenticated pull pages, opaque application/grant-bound checkpoints, current device authorization and existing request quotas.
- Token rotation preserves checkpoints; grant changes require explicit reconciliation.
- SDK 0.2.0 adds validated event/checkpoint methods and a packed reference consumer with atomic projection/checkpoint replacement.

Verified: 141 API tests, eight SDK/recovery tests, rebuilt API/workers, actual geofence→alert→email flow, real PostgreSQL concurrent commit/rollback check, and separately installed SDK with two consumer processes resuming one projection. Temporary fixture records and credentials removed.

Still pending: signed webhooks, explicit event retention/pruning and expiry contract, device/status/command events, telemetry APIs, pilot throughput validation and management UI. Existing episodes require current-state bootstrap; no lifecycle history is fabricated. Visual builder remains deferred.
