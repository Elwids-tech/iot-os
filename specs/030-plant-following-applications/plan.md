# Implementation Plan: Applications That Follow a Plant

**Branch**: `spec/030-plant-following-applications` | **Date**: 2026-11-07 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/030-plant-following-applications/spec.md`;
decisions in [ADR-032](../../docs/adr/ADR-032-applications-follow-a-plant.md), which
amends [ADR-014](../../docs/adr/ADR-014-control-plane-data-plane-http-integration.md).

## Summary

The integration API learns to show an application a whole plant and keep it moving.
Four pieces, each its own pull request after the documents merge:

1. **Grants by site and one resolver.** `site_uuids` beside `device_uuids`, an
   `ApplicationGrant` value object that replaces eight inline checks, the portal's
   grant editor with a site mode, parameters on the device read and sites for
   applications under `entities:read`.
2. **The snapshot.** A batch latest endpoint in the runtime and
   `POST telemetry/latest/query` in front of it.
3. **The stream.** An in-process broadcaster and `GET /internal/telemetry/stream` in
   the runtime, catching up from the committed outbox; a Laravel relay serving
   server-sent events under `telemetry:stream`, with stream sessions, limits, the
   hourly lifetime and the 30-second authorization re-check; PHP-FPM pool and
   development-server settings that make it serviceable.
4. **SDK 0.6** in each pull request's slice: parameters and sites, `latestQuery()`,
   `telemetryStream()`.

## Technical Context

**Language/Version**: PHP 8.4 / Laravel 13 (`laravel/framework` 13.35); Go 1.27;
TypeScript / React 19; Node 22.12+ for the SDK.

**Primary Dependencies**:
- Existing platform packages; no new PHP, Go or JS packages. SSE frames are written by
  hand (research R1); the Guzzle `stream` option carries the relay (R2).
- `dedoc/scramble` 0.13.47 for the contract, as today.

**Storage**: PostgreSQL 17 / TimescaleDB. One nullable json column
(`integration_applications.site_uuids`) and one table (`integration_stream_sessions`).
The runtime adds no table: catch-up reads `device_runtime.telemetry_outbox`, the batch
latest reads `device_runtime.latest`.

**Testing**:
- PHPUnit feature tests per area with a foreign-organization case each (R12), the
  contract gates (`IntegrationContractTest`, `RouteInventoryTest`, `contract:export
  --check`).
- Go: broadcaster unit test, SSE handler test, database tests for catch-up, reset and
  the batch query.
- SDK `node --test` with a fake fetch and `ReadableStream` bodies.
- Portal Playwright for the grant editor; the quickstart's nine runs on the rebuilt
  stack.

**Target Platform**: the single-node Docker Compose platform; the release's PHP-FPM
pool is configured for the first time (R6).

**Project Type**: web application changes (Laravel API, Go runtime, React portal and
admin), an SDK release, contracts.

**Performance Goals**: a 100-device snapshot in one request under 2 s (SC-001); 95 % of
readings on a stream within 2 s of storage at 100 devices reporting every 10 s
(SC-002); zero loss across 20 forced reconnections (SC-003).

**Constraints**:
- Clients talk only to Laravel; the runtime serves only Laravel (constitution I).
- No JetStream consumer per stream; JetStream stays inside Go (ADR-014).
- Existing integration routes, the token model and the per-minute limit are unchanged
  (spec boundaries).
- A stream occupies one PHP-FPM worker; limits 2 per application, 10 per organization,
  `IOT_STREAMS_MAX_OPEN` per deployment (R5, R6).
- The runtime is one instance; the broadcaster is in-process (R3).
- No stacked pull requests.

**Scale/Scope**:
- **API**: 3 new operations, 1 extended read, 2 abilities, 1 column, 1 table, 1
  resolver, 1 relay, 1 audit reason.
- **Runtime**: 2 internal endpoints, 1 broadcaster, 1 status field, 1 server change.
- **Portal and admin**: the grant editor's site mode; an open-streams list.
- **Contracts**: 4 event schemas with fixtures, 4 OpenAPI components, contract minor
  version 1.1.0.
- **SDK**: 3 methods, 1 extended type, version 0.6.0.
- **Deployment**: an FPM pool file, a memory limit, a dev-server variable.
- **Docs**: integrations, release, gotchas, SDK README, the developer docs' reference.

## Constitution Check

| Principle | Check |
| --- | --- |
| I. Laravel owns intent | Laravel authenticates, resolves the grant, enforces limits and relays; the runtime's new endpoints are internal, bearer-protected and reached only by Laravel. No tenant reaches NATS or the runtime. ✅ |
| II. Immutable versions | Nothing is published, activated or deployed. A grant change bumps a revision as today. ✅ |
| III. Tenant isolation | One `ApplicationGrant` resolver replaces eight inline checks and is the only place a device is judged granted; the runtime filters by the organization Laravel passes and never decides a grant. Every new read and the stream have a foreign-organization and an ungranted-device test; a site scope cannot name a foreign site (404). ✅ |
| IV. Contracts first | `telemetry-stream.v1` and its open/reset/closed events are schemas with fixtures and cases under `contracts/events/v1/`, read by Go, PHP and TypeScript tests; the batch latest, the device read and the site list are OpenAPI components with examples; `packages/api-client` and the SDK change in the same pull requests; `info.yaml` goes to 1.1.0. ✅ |
| V. AI proposes | No AI involvement; the MCP tools are untouched. ✅ |
| VI. Never invent state | Empty readings are an empty list; presence is `unknown` when the runtime is not seen; a backfilled reading is flagged `historical`; a position the platform cannot honour is a `reset`, never a silent restart from the head. ✅ |
| VII. Durable, idempotent | The stream is at-least-once across reconnections and carries `event_id` and a position; catch-up and live are joined by sequence so one stream never repeats an event; a subscriber that falls behind is closed and resumes, not retried forever. ✅ |
| VIII. One design system | The grant editor's site mode uses `SearchableSelect` and the existing `Panel`; the admin's open-streams list is a `DataTable` in a `CollectionPage` with `RelativeTime`. No new kit component. ✅ |
| IX. Verified where it runs | Each pull request rebuilds the containers it changes (api and workers; runtime; portal and admin) and runs its quickstart runs on the stack, including the capacity measurement for the stream. ✅ |

**Gate result**: pass, with the deviations in Complexity Tracking. Re-checked after
Phase 1 design: unchanged.

## Design

### Runtime (`services/runtime`)

- `internal/app/broadcast.go` (new): `committedBroadcaster` with `Subscribe(org,
  devices, buffer) (<-chan event, cancel)`, `Publish([]event)`; a subscriber whose
  buffer is full is closed with a counted reason. `publishCommittedBatch` calls
  `Publish` after `AckCommitted` (R3).
- `internal/storage/committed.go`: `CommittedAfter(org, devices, after, limit)` and
  `CommittedFloor(org)` (oldest retained sequence) and `CommittedHead(org)`.
- `internal/app/stream.go` (new): `telemetryStreamHTTP` writing SSE frames
  (`open`, `reading`, `reset`, keepalive), catch-up then live, dedupe by sequence,
  write deadline lifted, flush per frame, ends on request or application context.
- `internal/storage/store.go`: `LatestBatch(org, devices)`; `internal/app/http.go`:
  `latestBatchHTTP` applying the same stale downgrades as `latestHTTP`, and the two
  routes.
- `cmd/runtime/main.go`: `BaseContext` from the signal context; `Close()` waits for
  `Shutdown`. `statusHTTP` adds `streams.open`.
- `internal/devices/stream.go` (new): the `telemetry-stream.v1` projection from
  `CommittedTelemetry`, with a `contractstest.AssertProduced` test.

### API (`apps/api`)

- **Migrations**: `add_site_uuids_to_integration_applications`,
  `create_integration_stream_sessions`.
- **Domain `Integrations`**:
  - `Services/ApplicationGrant.php` (value object, R7) and `Services/ApplicationGrants.php`
    (`siteDeleted`, `resolve`); the eight call sites switch to it.
  - `Http/ApplicationController.php`: `ABILITIES` + 2, `max:10`, `site_uuids`
    validation, view with `sites[]`.
  - `Http/AuthenticateApplication.php`: `telemetry:stream` rule; headers set through
    `$response->headers`.
  - `Http/ReadController.php`: parameters, profile and site on `device`.
  - `Http/SiteReadController.php` (new): `sites` under `entities:read`.
  - `Http/TelemetryController.php`: `latestBatch`.
  - `Http/TelemetryStreamController.php` (new) with `Services/StreamRelay.php`,
    `Services/SseWriter.php`, `Services/StreamSessions.php` (limits, rows, pruning).
  - `routes.php`: the three operations; `config/integrations.php`:
    `stream_lifetime_seconds` (3600), `streams_max_open` (10),
    `streams_per_application` (2), `streams_per_organization` (10),
    `stream_recheck_seconds` (30), `stream_keepalive_seconds` (60).
  - `StreamRelay` reopens the internal stream from the last relayed position when a
    site scope's resolved set changes, relaying no second `open` (R2, FR-008).
- **Domain `Devices`**: `RuntimeClient::stream()`; `SiteController::destroy` calls
  `ApplicationGrants::siteDeleted`.
- **Operations**: `Operations::metrics()` adds `integration_streams_open`; the admin
  organization page lists open streams (`Administration` domain read + admin app).
- **Audit**: `application.grants_updated` carries `reason` when it is `site_deleted`.
- **Tests**: `GrantScopeTest`, `LatestBatchTest`, `DeviceParametersTest`,
  `SitesReadTest`, `TelemetryStreamTest`; `IntegrationContractTest` learns
  `text/event-stream` (R10).

### Contracts (`contracts/`)

- `events/v1/telemetry-stream{,-open,-reset,-closed}.{schema,fixture,cases}.json`,
  listed in `internal/catalogue.json`.
- `openapi/supplements/integration.yaml`: components `TelemetryLatestBatch`,
  `DeviceParameters`, `SiteList`, `TelemetryStreamEvent`; operation patches with
  examples; `x-abilities` for the stream; `info.yaml` 1.1.0.
- `tooling/verify-devices-contracts.py` picks the new files up by convention.

### Portal and admin

- `apps/portal/src/integrations/Integrations.tsx`: `GrantFields` gains a mode
  (**Devices** / **Sites**) with a site `SearchableSelect` fed by `api.sites(org)`;
  the summary counts abilities from the list instead of "of 4"; the confirmation text
  names the scope consequences. `e2e/integrations-sites.spec.ts`.
- `packages/api-client`: `IntegrationGrants` gains `site_uuids`; `IntegrationApplication`
  gains `sites`; `IntegrationAbility` gains the two abilities.
- `apps/admin`: open streams on the organization page (`DataTable`).

### SDK (`packages/integration-sdk`)

- `telemetryStream()`, `latestQuery()`, `sites()`, `device()` fields; the SSE line
  parser and reconnect loop (R11); tests; `examples/stream.mjs`; README; `0.6.0`.

### Deployment and docs

- `deploy/docker/api/php-fpm.release.conf`, copied by `Dockerfile.release`;
  `deploy/release/compose.yml` api `mem_limit: 768m`;
  `deploy/compose/compose.app.yml` and the api Dockerfile: `PHP_CLI_SERVER_WORKERS=8`.
- `docs/features/integrations.md` (abilities, scopes, the snapshot, the stream, limits,
  the two presences), `docs/reference/events.md` (the stream's relation to the
  committed feed), `docs/ops/release.md` (pool arithmetic), `docs/dev/gotchas.md`
  (development server and streams), `docs/roadmap.md` (the dedicated streaming process
  and the multi-instance fan-out), the SDK README, and the developer docs' integration
  reference, which is generated from the contract.

## Project Structure

### Documentation (this feature)

```text
specs/030-plant-following-applications/
├── spec.md  plan.md  research.md  data-model.md  quickstart.md  tasks.md
├── checklists/requirements.md
└── contracts/telemetry-stream.md  platform-api.md
docs/adr/ADR-032-applications-follow-a-plant.md
```

### Source Code (repository root)

```text
services/runtime/internal/app/{broadcast,stream}.go                     (new)
services/runtime/internal/app/{committed,http,application}.go
services/runtime/internal/storage/{committed,store}.go
services/runtime/internal/devices/stream.go                             (new)
services/runtime/cmd/runtime/main.go
contracts/events/v1/telemetry-stream*.{schema,fixture,cases}.json       (new)
contracts/internal/catalogue.json
contracts/openapi/supplements/{integration,info}.yaml
apps/api/database/migrations/2026_11_*_{add_site_uuids_to_integration_applications,create_integration_stream_sessions}.php
apps/api/app/Domain/Integrations/Services/{ApplicationGrant,ApplicationGrants,StreamRelay,SseWriter,StreamSessions}.php  (new)
apps/api/app/Domain/Integrations/Http/{SiteReadController,TelemetryStreamController}.php           (new)
apps/api/app/Domain/Integrations/Http/{ApplicationController,AuthenticateApplication,ReadController,TelemetryController,EventController,LocationController,GeospatialController}.php
apps/api/app/Domain/Integrations/Services/{EventJournal,WebhookDispatch}.php
apps/api/app/Domain/Integrations/routes.php, apps/api/config/integrations.php          (new config)
apps/api/app/Domain/Devices/Services/RuntimeClient.php
apps/api/app/Domain/Devices/Http/Controllers/SiteController.php
apps/api/app/Support/Operations.php
apps/api/tests/Feature/Domain/Integrations/{GrantScope,LatestBatch,DeviceParameters,SitesRead,TelemetryStream}Test.php  (new)
apps/api/tests/Feature/Contract/IntegrationContractTest.php
packages/api-client/src/index.ts
packages/integration-sdk/{src/index.ts,test/*.test.mjs,examples/stream.mjs,README.md,package.json}
apps/portal/src/integrations/Integrations.tsx, apps/portal/e2e/integrations-sites.spec.ts
apps/admin/src/organizations/*  (open streams)
deploy/docker/api/{php-fpm.release.conf,Dockerfile.release,Dockerfile}
deploy/release/compose.yml, deploy/compose/compose.app.yml
docs/features/integrations.md, docs/reference/events.md, docs/ops/release.md, docs/dev/gotchas.md, docs/roadmap.md
```

**Structure Decision**: everything stays in the existing `Integrations` domain and the
runtime's `app` package; the resolver is a service there because every integration
read already lives there. The stream's events are contracts under `events/` because
three languages read them.

## Delivery

No stacked pull requests: each targets `main` and opens once its dependencies have
merged.

| PR | Contents | Depends on | Verified by |
| --- | --- | --- | --- |
| 030-0 | Documents: spec, clarifications, plan, research, data model, contracts, quickstart, tasks; ADR-032 to ADR-034 (Proposed); index and roadmap rows | — | review (pull request 166) |
| 030-1 | Grants by site; `ApplicationGrant` at every call site; site deletion hook; parameters, profile and site on the device read; sites for applications; `entities:read`; ability caps; portal grant editor; api-client; SDK `sites()` and device fields; OpenAPI; docs | 030-0 | quickstart 1 (API and SDK), 2, 5; api, workers and portal rebuilt |
| 030-2 | Runtime batch latest; `POST telemetry/latest/query`; OpenAPI; SDK `latestQuery()`; docs | 030-0 | quickstart 1 (API, runtime and SDK), 3; api and runtime rebuilt |
| 030-3 | Broadcaster and internal stream; relay, `telemetry:stream`, sessions, limits, lifetime, re-check; stream contracts and the SSE gate; FPM pool, memory limit, dev-server workers; status and admin list; SDK `telemetryStream()` and `0.6.0`; docs and gotchas | 030-1 (the resolver) | quickstart 1, 4, 6, 7, 8; api, workers, runtime and admin rebuilt |

**Order**: 030-1 and 030-2 open in parallel after 030-0; 030-3 opens when 030-1 has
merged and rebases on 030-2 if it merged first. ADR-032 moves to Accepted when 030-3
merges. The Twin Studio connector's phase 1 can start against 030-1 and 030-2 with
polling, and switch to the stream when 030-3 ships (SC-007).

## Risks

- **A worker per stream.** Ten streams hold ten PHP-FPM workers for an hour each.
  - Mitigation: the pool file and memory limit (R6), the deployment cap, the
    measurement in quickstart 6, and the roadmap's dedicated streaming process.
- **Single-instance fan-out.** The broadcaster sees only events the local relay
  published.
  - Mitigation: the runtime is one instance today; the roadmap records the JetStream
    consumer with a stored sequence mapping for a second instance.
- **Laravel's own streaming helper.** `eventStream()` may fit better in the framework
  version at implementation time.
  - Mitigation: R1 says to re-check; the contract, not the helper, is what tests pin.
- **Hourly closes multiply reconnects.** Ten streams mean ten reconnects an hour, each
  a catch-up query.
  - Mitigation: catch-up from the last position is one indexed query returning
    nothing when the client kept up; the open counts once against the budget.
- **Grant scopes and the feed.** A scope that grows changes which events a cursor sees
  without a revision bump.
  - Mitigation: the feed already skips ungranted events per page and the spec says a
    device added to a site is granted from then on; documented beside cursors.
- **Contract gate changes.** Teaching `IntegrationContractTest` about SSE touches a
  gate every integration operation passes through.
  - Mitigation: the change is additive (one more media type), covered by its own test
    case, and lands with the stream, not before.

## Complexity Tracking

| Deviation | Why | Simpler alternative rejected because |
| --- | --- | --- |
| An in-process broadcaster instead of a JetStream consumer per stream | Resume by committed sequence needs the outbox; per-stream consumers cannot resume by it and show as unmanaged consumers | A JetStream consumer per stream cannot honour `Last-Event-ID` and needs cleanup on every disconnect |
| A stream session table | Limits must survive a crashed worker and operators must see open streams | Cache counters cannot be decremented after a crash and show nothing |
| The relay passes bytes through without re-validating each frame | Laravel adds authorization, limits and `closed`; the runtime's contract tests validate every event it produces | Parsing and re-encoding every frame in PHP doubles the work and adds latency for no new check |
| First PHP-FPM pool configuration and a memory limit change in the release | The default pool of five children cannot serve ten streams and requests | Leaving defaults means the first customer stream starves the API |
