# Research: Applications That Follow a Plant

Decisions for [spec 030](spec.md), grounded in the code on 2026-11-07 and in
[ADR-032](../../docs/adr/ADR-032-applications-follow-a-plant.md). Each entry is a
decision, why, and what was rejected. Line numbers are as of commit `6edeea8`.

## The stream

### R1. Transport and framing

**Decision**: server-sent events over a plain `StreamedResponse`, with the frames
written by one small class, `SseWriter` (`event:`, optional `id:`, one `data:` line,
blank line; `: keepalive` comments). Headers `Content-Type: text/event-stream`,
`Cache-Control: no-store`, `X-Accel-Buffering: no`. The event set, the payloads and the
refusals are in [the stream contract](contracts/telemetry-stream.md).

**Rationale**: SSE is one HTTP response, so it passes every existing layer unchanged:
`AuthenticateApplication`, the per-IP throttle, nginx and Caddy. The runtime emits the
same framing, so Laravel can relay bytes. Writing the frames by hand keeps the `id:`
line, which is what resume needs.

**Alternatives**:
- Laravel's `response()->eventStream()` helper: it names every event `update`, closes
  with its own `</stream>` marker, and offers no `id:` line; a client would have to
  unlearn it. Re-check at implementation; if a later framework version writes ids and
  custom event names, prefer it.
- WebSockets: bidirectional and a new process (Reverb); nothing in this feature sends
  upstream.
- Long polling on the batch latest: cannot meet SC-002 inside the request budget.

### R2. The relay in Laravel

**Decision**: `RuntimeClient` gains `stream(string $path, array $query, callable $onChunk)`
beside `request()`, opening the internal request with Guzzle's `stream` option and
reading the body in chunks for as long as the response is open; `request()` is
untouched. A new `TelemetryStreamController@stream`:

1. authenticates (middleware), resolves the grant (R7) and the optional `devices[]`
   subset, validates `Last-Event-ID` (R4), and opens a stream session row (R5), or
   refuses as the contract lists;
2. opens `GET /internal/telemetry/stream` on the runtime with the resolved device
   set and the position, and relays every frame it receives, flushing after each;
3. every 30 s, between frames, re-reads the application's `grant_revision`,
   `revoked_at` and the token's existence and expiry with one query, refreshes the
   session row, and ends the stream with `closed` (`grant_changed` or
   `credentials_changed`) when they changed;
4. ends the stream with `closed` (`lifetime`) one hour after it opened, with
   `runtime_unavailable` when the internal connection drops, and with `shutdown` when
   the worker is asked to stop;
5. closes the session row with the reason and last position.

`AuthenticateApplication` sets `Cache-Control` through `$response->headers->set()`, so
it works for a streamed response as it does for JSON. `set_time_limit(0)` is called
in the handler; output buffering is disabled for it.

**Rationale**: the runtime never decides a grant (constitution I); Laravel decides it
when the stream opens and again every 30 s, which is what makes a one-hour lifetime
acceptable. Relaying bytes keeps one framing and one contract.

**Alternatives**:
- Laravel consuming JetStream directly: forbidden by ADR-014 and principle I.
- Laravel polling the committed outbox table itself: it would reach into the runtime's
  schema and still not get live events.
- Checking authorization only at open and at the hourly close: a revoked application
  could stream for an hour; the 30-second check is one indexed read.

### R3. The runtime's fan-out and catch-up

**Decision**: an in-process `committed.Broadcaster` in the runtime:

- The relay (`internal/app/committed.go`, `publishCommittedBatch`) hands every batch it
  has published and acknowledged to the broadcaster, with each event's `sequence`.
- `GET /internal/telemetry/stream?organization&devices&after` registers a subscriber
  with the organization and device set. When `after` is given, the handler first reads
  the outbox (`telemetry_outbox`, `organization_uuid = $1 AND event->>'device_uuid' =
  ANY($2) AND sequence > $3 ORDER BY sequence`, in pages of 500) and writes those
  events, then switches to the live feed, dropping any live event whose sequence is not
  greater than the last one written. Subscriber buffers are bounded (1 000 events); a
  subscriber that falls behind is closed, and Laravel reports `runtime_unavailable`
  so the client resumes with catch-up.
- Reset rule: when `after` is smaller than the organization's oldest retained
  sequence (`SELECT min(sequence) ... WHERE organization_uuid = $1`), the handler sends
  `reset` with the current head and closes. An organization with no retained rows
  starts at the head.
- The handler lifts the server's 10-second write deadline for itself with
  `http.NewResponseController(w).SetWriteDeadline(time.Time{})`, flushes after every
  frame, writes `: keepalive` after 60 s of silence, and ends when the request context
  or the application context is done. `cmd/runtime/main.go` gains a `BaseContext`
  tied to the signal context so every stream ends on shutdown, and `Close()` waits for
  `Shutdown` to finish.
- `GET /internal/status` gains `streams: {open}`; the log line per stream carries the
  organization and device count, never values.

**Rationale**: the outbox is the only place the committed sequence exists with its
event (`storage/committed.go:31,68`); JetStream numbers messages differently and no
mapping is stored, so a JetStream consumer cannot resume from a committed position. The
outbox is indexed by organization, device and sequence (`schema.sql:105`) and retained
eight days or the tenant's retention (`store.go:953-970`), which is the retention the
spec assumes. Per-stream JetStream consumers would also appear as unmanaged consumers
in the platform metrics (`Operations.php:105-136`) and need cleanup on disconnect.

**Consequences and limits**:
- The broadcaster lives in the process that runs the relay. The runtime is one instance
  today (advisory lock); a second instance would need the fan-out moved behind a
  JetStream consumer with a stored sequence mapping. Recorded in the roadmap entry.
- Events reach subscribers only after the relay published them; when NATS is down the
  live feed pauses with the relay and catch-up from the outbox fills the gap on the
  next reconnect. Nothing is lost.
- The reset rule is conservative: a client whose last event was pruned while nothing of
  its organization was lost in between is still reset. Documented.

**Alternatives**:
- Hooking `a.observe()` after `PersistResult`: it carries no sequence, so events could
  not be positioned.
- An ephemeral JetStream consumer per stream filtered by subject: the subject has no
  organization token, so every subscriber would decode every tenant's events, and
  resume by committed sequence is impossible.
- Polling the outbox per subscriber every second: a query per stream per second, and
  no benefit over the broadcaster.

### R4. Positions

**Decision**: the position is the committed `sequence` as a decimal string, opaque to
clients, validated as `^[1-9][0-9]{0,19}$`. The SSE `id` carries it; `Last-Event-ID`
and the `after` query parameter accept it. A fresh stream's `open` position is the
organization's current head (the greatest sequence retained for it, or `0` when none).

**Rationale**: one number, already unique and increasing in storage order; strings keep
64-bit values exact in JavaScript. Opaqueness lets a later version carry a stream id
or an epoch inside it without a client change.

**Alternatives**: an encrypted cursor like the event feed's. It is bound to the grant
revision there because pages are filtered by grant; the stream is filtered at open
and re-checked every 30 s, so a plain number suffices, and `grant_changed` is already a
distinct close reason.

### R5. Counting streams and showing them

**Decision**: a table, `integration_stream_sessions` (`integration_application_id`,
`organization_id`, `opened_at`, `last_seen_at`, `last_position`, `closed_at`,
`close_reason`, `device_count`), one row per stream. Open streams are rows with
`closed_at IS NULL AND last_seen_at > now() - 90 s`; the relay refreshes `last_seen_at`
every 30 s. Limits (2 per application, 10 per organization, and a deployment cap
`IOT_STREAMS_MAX_OPEN`, default 10) are checked inside one transaction with the
application row locked. The admin app's organization page and `/internal/ops/metrics`
read the same table; `RuntimeStatus::diagnostics()` already proxies the runtime's
`/internal/status` for the runtime side. Rows older than 30 days are pruned by the
existing prune schedule.

**Rationale**: a stream ended by a crashed worker leaves no `closed_at`; the 90-second
freshness window frees its slot without a reaper. Operators can see who is streaming
(FR-026, US6). The existing `integration_streams` table is the event journal's
sequence row, which is why this table is named sessions.

**Alternatives**: cache counters (`RateLimiter`) cannot be decremented reliably when a
worker dies and show nothing to an operator.

### R6. Serving capacity

**Decision**:
- Release: a PHP-FPM pool file (`deploy/docker/api/php-fpm.release.conf`) with
  `pm = dynamic`, `pm.max_children = 24`, `pm.start_servers = 4`,
  `pm.max_spare_servers = 8`, `request_terminate_timeout = 0`, and the api container's
  `mem_limit` raised to 768 MiB in `deploy/release/compose.yml`. The deployment cap
  `IOT_STREAMS_MAX_OPEN` (R5) defaults to 10, so at least 14 workers remain for
  requests. `docs/ops/release.md` documents the arithmetic.
- nginx: `fastcgi_read_timeout 150s` already exceeds the keepalive interval; buffering
  is disabled per response by `X-Accel-Buffering: no`. Caddy flushes `text/event-stream`
  responses immediately without configuration.
- Development: `PHP_CLI_SERVER_WORKERS=8` in `deploy/compose/compose.app.yml` and the
  api Dockerfile, because `php artisan serve` is single-threaded and one open stream
  would block every other request. Recorded in `docs/dev/gotchas.md`.

**Rationale**: the official image's default pool allows 5 children; ten streams would
exhaust it. The numbers are a starting point measured in quickstart run 6, and the
roadmap keeps the move to a dedicated streaming process for when they are not enough.

**Alternatives**: Laravel Octane or Reverb now. Both add a process and a deployment
profile change for one feature; ADR-032 defers that until streams multiply.

## Grants, snapshots and reads

### R7. Grants by site and one resolver

**Decision**:
- `integration_applications` gains `site_uuids json null`. A grant is valid when exactly
  one of `device_uuids` and `site_uuids` is non-empty; `site_uuids` names 1 to 50 sites
  of the organization.
- A value object `ApplicationGrant` (`kind: devices|sites`, `deviceUuids`, `siteUuids`)
  with `covers(Device)`, `deviceQuery(Builder)` (a `whereIn('uuid')` or a
  `whereIn('site_id')`), and `resolveUuids()` for the feed, webhooks and the stream.
  It replaces the inline checks in `ReadController::deviceQuery`,
  `TelemetryController::device`, `LocationController::query`, `GeospatialController`,
  `EventController::index`, `WebhookDispatch::tick` and `::deliver`, and
  `ApplicationController::view`.
- `ApplicationController::grants()` validates either list; the view returns both
  fields and `sites[]` (`uuid`, `name`) beside `devices[]`.
- `SiteController::destroy` calls `ApplicationGrants::siteDeleted(Site)`, which removes
  the site from every scope that names it, bumps `revision` and `grant_revision`,
  deletes tokens, disables the webhook and audits `application.grants_updated` with
  `reason: site_deleted` (FR-021). A scope left empty is kept, and the application
  reads nothing until a manager edits it; the portal shows why.
- The event feed cursor and the webhook's `grant_revision` binding are unchanged: a
  scope change bumps the revision exactly as a list change does.

**Rationale**: the grant is one JSON column today with no table; adding a sibling
column keeps every existing row valid and every existing test green. The resolver
removes eight copies of the rule before the stream adds a ninth (constitution III
wants one place to test).

**Alternatives**:
- A `kind` plus one polymorphic list: ambiguous for the portal and the SDK types.
- A grant table with rows per device or site: more schema for no query the JSON column
  cannot answer with `whereIn`.
- Mixed grants (devices and sites): rejected in ADR-032; the resolved set would be a
  union whose size no manager can read off the editor.

### R8. The batch latest

**Decision**: the runtime gains `GET /internal/measurements/latest-batch?organization_uuid&devices=`
(up to 100) answering `{data: {<device_uuid>: {data, presence, configuration_uuid,
processing?}}}` from one query (`DISTINCT ON (device_uuid, parameter_uuid)` over
`device_runtime.latest`, the per-device stale downgrades applied as `latestHTTP` does).
Laravel's `POST telemetry/latest/query` validates 1 to 100 distinct UUIDs, refuses the
whole request 404 if any is outside the grant, calls the runtime once, and composes
each entry as the single-device latest read does, plus `presence` and `last_seen_at`
from the device row as `DeviceView::presence` computes them. Contract
`telemetry-latest-batch.v1` in [the platform API contract](contracts/platform-api.md).

**Rationale**: `Store.Latest` is per device; a loop of 100 runtime calls would take the
request past its timeout and multiply the per-device lock. Presence from Laravel's
columns is what the device read already returns, which the spec asks for; the
runtime's own presence stays in the single-device read as today, and the two are
documented side by side.

**Alternatives**: paginating the single read: 100 requests is the problem being solved.

### R9. Parameters and sites for applications

**Decision**:
- `GET devices/{uuid}` adds `profile {uuid, name, revision}`, `site {uuid, name,
  timezone}` and `parameters[]` (`uuid`, `key`, `name`, `unit`, `data_type`,
  `decimals`, `accepts_command`, `reports_state`), read from the applied (else
  last-applied) configuration's `profile_canonical_json`, where the name is `label`
  and decimals is `display.precision`. The list stays as it is.
- `GET sites` under a new ability `entities:read`: every site of the organization with
  `uuid`, `name`, `timezone`, `address`, `latitude`, `longitude` and
  `granted_devices_count` (count within the application's resolved grant).
- `ApplicationController::ABILITIES` gains `entities:read` and `telemetry:stream`; the
  `max:8` rules become `max:10`; `AuthenticateApplication` adds the rule
  `telemetry:stream` requires `telemetry:read`; `IntegrationContractTest::ABILITIES`
  and the `x-abilities` expectations follow.

**Rationale**: `DeviceView::device` already builds `profile` and `site` for the portal;
the parameter list is the same data the latest read whitelists. `entities:read` is
named for spec 009, which will serve entities and paths under it.

### R10. Contracts and the OpenAPI gates

**Decision**:
- `telemetry-stream.v1`, `telemetry-stream-open.v1`, `telemetry-stream-reset.v1` and
  `telemetry-stream-closed.v1` get JSON Schemas, fixtures and cases under
  `contracts/events/v1/` beside `telemetry-committed`, because Go produces them, PHP
  relays them and TypeScript consumes them (constitution IV). They are listed in
  `contracts/internal/catalogue.json` with their producer and consumer tests.
- `telemetry-latest-batch.v1`, the device read with parameters, the site list and the
  applications payload with `site_uuids` are OpenAPI components with operation
  examples in `contracts/openapi/supplements/integration.yaml`, as the existing
  integration shapes are; the examples are their golden fixtures.
- `IntegrationContractTest` learns one new media type: a 2xx with
  `text/event-stream` must document each event's `data` with a `$ref` to the schema
  above and an example per event, validated the way JSON examples are. `OPERATIONS`
  gains the stream, the batch latest and the site list; `INVALID_INPUT` gains the batch
  latest and the stream.
- `info.yaml` goes to `1.1.0`: new operations, no breaking change.

**Rationale**: the gates exist to keep the description honest; extending the one that
cannot read SSE is cheaper than exempting the operation and losing the check.

### R11. SDK 0.6

**Decision**:
- `telemetryStream({devices?, after?, signal?, maxRetryMs?})` returns an async
  iterator built on `fetch` and the response body's `ReadableStream`, parsed line by
  line with `TextDecoder`. The abort timer applies to the handshake only; the body is
  governed by the caller's `signal`. It remembers the last `id`, reconnects after
  `closed`, a dropped body or the hourly lifetime with backoff 1 s to 30 s, retries
  503 the same way, surfaces `open`, `reading` and `reset`, and throws `IotApiError`
  on 401, 403, 404, 422 and 429.
- `latestQuery(deviceUuids)` posts the batch; `sites()` lists sites; `device()`'s
  validator accepts the new fields; a `Device` type gains `profile`, `site` and
  `parameters`.
- Tests use the existing fake-fetch factory with a `ReadableStream` body for the
  stream, covering a resumed id, a `reset`, a `closed` with each reason, a dropped
  body mid-event, and that the token never appears in an error.
- README and `examples/stream.mjs`; version `0.6.0`; `apps/vertical-demo` keeps
  `workspace:*`.

**Rationale**: Node 22 has web streams and `TextDecoder`; no dependency is needed, which
keeps the package's zero-dependency promise.

### R12. Tests and verification

**Decision**:
- PHP feature tests in `tests/Feature/Domain/Integrations/`: `GrantScopeTest` (sites,
  moves, deletion, revision, feed and webhook filtering through a scope, foreign site
  404), `LatestBatchTest`, `DeviceParametersTest`, `SitesReadTest`,
  `TelemetryStreamTest` (refusals, limits, open and closed events with a faked
  runtime body, the 30-second re-check, the lifetime), each with a foreign-organization
  case (constitution III).
- Go tests in `internal/app/`: a broadcaster unit test; a handler test with
  `httptest.NewServer` reading SSE frames; a database test for catch-up, reset and the
  batch latest query, under `DEVICE_TEST_DATABASE_URL` as the storage tests run.
- SDK tests as in R11; portal e2e `integrations-sites.spec.ts` for the grant editor.
- The quickstart's runs on the rebuilt stack with the Sparkplug simulator from
  `tooling/`, including the capacity measurement in run 6.
