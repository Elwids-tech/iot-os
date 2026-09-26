# Durable alert events and consumer recovery

This P3 slice adds an authenticated, resumable **pull feed** to the application
API. Signed webhook delivery is still pending. There are no tenant-controlled
outbound destinations, raw telemetry events, device commands or broker access in
this slice. Alert events are lower-volume lifecycle records, separate from the
internal telemetry stream.

## Journal and commit ordering

Activation, clearing and first acknowledgement append a public snapshot in the
same SQL transaction as the alert mutation. Duplicate transitions and repeated
acknowledgement do not create new logical events. The journal is independent of
email preferences and email delivery failures.

Each organization has a stream row. Writers lock it until commit while assigning
a monotonically increasing position. This prevents a poller from observing a
later committed position while an earlier transaction is still uncommitted,
which can happen with plain database sequences. Rollbacks remove both source
changes and journal writes. Alert rows are locked before snapshotting, so a clear
cannot accidentally remove a concurrently recorded acknowledgement.

Public envelopes contain:

```ts
{
  id: string;                         // stable UUID across retries
  schema_version: 'integration-event.v1';
  type: 'alert.activated.v1' | 'alert.cleared.v1' | 'alert.acknowledged.v1';
  occurred_at: string;                 // source transition or acknowledgement time
  recorded_at: string;                 // journal write time, not a commit timestamp
  data: Alert;                        // same public snapshot fields as alert reads
}
```

Journal order is commit order, not source event time. Apply `data` as the
authoritative snapshot: a late activation event for an already-cleared episode
still contains `condition: 'cleared'`. Workflow names and execution stop reasons
are captured at event time. Rename/disable events are not yet part of the feed;
refresh current alert reads when those display fields need reconciliation.
Comments, user identities, email deliveries and private configuration are excluded.

## API and authorization

Both the application's grants and its token must include **`events:read` and
`alerts:read`**. Existing tokens do not gain event access automatically. Existing
organization/device filtering, expiry, revocation and rate limits apply to every
request. Device ownership is rechecked. Never expose the token in browser code.

At `/api/integration/v1/organizations/{organization_uuid}`:

- `GET /events/checkpoint` returns `{cursor}` for the current committed head.
- `GET /events?cursor=...&limit=100` returns `{data, next_cursor, has_more}`.
  Limit is 1–100. Without a cursor, reading starts at the journal's beginning.

The cursor is opaque, encrypted/authenticated, and bound to the organization,
application and grant revision. It never substitutes for authentication. Token
rotation with unchanged grants preserves a checkpoint. Grant updates invalidate
it with **409**; reconcile from a fresh checkpoint, replacing the local projection
so removed devices disappear. Cursors from another application or malformed
cursors return **422**. Revoked/expired credentials return **401**; insufficient
abilities return **403**. A cursor beyond the retained database head returns 409.
Encryption-key loss/rotation without previous-key support requires rebuilding.

Pages filter out unauthorized devices. An empty page can advance past hidden
events; grant changes force reconciliation so new grants do not silently miss
older data. `has_more` refers to eligible events at the head observed for that
request. Save `next_cursor` even on empty pages. Poll again later for subsequent
commits, respecting 429 `Retry-After`; the SDK does not automatically retry.

## Recovery, retention and cutover

No historical lifecycle transitions are invented at migration time. Existing
alert episodes remain available through current-state APIs. The journal begins
with changes committed after installation. To initialize or reconcile:

1. Capture `/events/checkpoint` **before** listing alert state.
2. Read all current alert pages with no active/cleared filter.
3. Read events after that checkpoint, applying snapshots in returned order.
4. Commit the resulting projection and next cursor together in your own storage.

Replaying the same page returns stable event IDs and equivalent snapshots. For
business side effects, record processed event IDs in the same transaction as the
projection/checkpoint, or use your own transactional outbox. This API does not
promise exactly-once external actions. A failed request must not advance the
consumer's saved cursor. Authentication failures never silently reset it.

Events are currently retained indefinitely; no pruning or expiring cursor policy
is enabled. Retention quotas, a retention-floor/410 contract and archive replay
are pending before a production retention policy is introduced. Backups must
include journal and source tables together. In-flight authorized reads cannot be
recalled after revocation. Applications own cleanup of already received data.

## SDK and reference consumer

SDK **0.2.0** adds `eventCheckpoint()` and `events({cursor, limit, signal})` with
runtime envelope validation. The packed `examples/project.mjs` consumer uses only
public APIs and an application token. It bootstraps existing alerts, then stores
its projection and cursor in one fsynced temporary file and atomic rename.
Subsequent processes resume that cursor. It performs no external business actions.

```sh
IOT_API_URL=https://api.example.com \
IOT_ORGANIZATION=<organization-uuid> \
IOT_APPLICATION_TOKEN=<backend-secret> \
node node_modules/@iot-os/integration-sdk/examples/project.mjs ./alerts.json
# After an intentional grant change, rerun with --rebuild to replace the projection.
```

The sample is single-writer, using an exclusive `.lock` file. After a killed
process, remove a stale lock only after confirming no consumer is running.
It processes at most 100 event pages per run, preserving progress for the next
run. It is a local-file reference, not a production database implementation or
power-loss durability guarantee. Production consumers should use a transactional
database for projection, deduplication and checkpoint storage.

Verification includes rollback/deduplication/out-of-order tests, grant-bound
cursors, rotation, permission removal, SDK contract/recovery tests, a separately
installed SDK run across processes, the live geofence path, and a real PostgreSQL
concurrency check (`tooling/verify-integration-event-order.php`). That check proves
writers wait through commit and rollback without exposing a skipped position.
Per-organization serialization is deliberate for this low-volume feed; pilot
load/throughput limits remain to be measured before high-volume event expansion.
