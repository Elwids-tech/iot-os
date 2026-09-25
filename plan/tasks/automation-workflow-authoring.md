# Automation workflow authoring

Date: 2026-09-25

Delivered the backend authoring boundary for a future React Flow editor and
conversational assistant. See [architecture and API](../../docs/automation-workflows.md).

- Portable graph schema and fixture compile to the existing geofence evaluator.
- Tenant-scoped draft list/create/read/update, revision checks, append-only
  revision snapshots through the API, and atomic audit entries.
- Saved-revision simulation uses the real Go evaluator without activation.
- Existing device view/manage permissions are reused for this initial slice.

Pending: live activation, durable state/checkpoint/transition writes, restart-safe
timers, rendered editor, assistant tools, notifications and external SDK access.
Do not describe saved drafts or simulated transitions as operational alerts.

Verification:

- All 119 Laravel tests passed; focused authoring tests also cover malformed
  device references, runtime rejection and no partial persistence.
- Go race tests, vet and five rule JSON schemas/fixtures passed.
- Full disposable Devices suite passed including browser flows, TLS/tenant
  isolation, commands, database/broker interruption and restart recovery.
- Rebuilt runtime, API and assistant worker. The in-container API kernel called
  the real Go service for draft creation, updates and all 13 fixture simulation
  steps; auth, tenant isolation, invalid graphs/bindings and stale revisions
  were checked. Temporary records and verification token were rolled back.
- Reproduce the local round trip using `tooling/verify-workflow-drafts.php`.
