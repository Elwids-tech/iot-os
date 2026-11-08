# Tasks: Applications That Follow a Plant

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/telemetry-stream.md](contracts/telemetry-stream.md),
[contracts/platform-api.md](contracts/platform-api.md), [quickstart.md](quickstart.md)

The work ships as four pull requests of this spec against `main` (plan § Delivery). None
is stacked: each opens only after the PRs it depends on have merged. 030-1 and 030-2
open in parallel after 030-0; 030-3 opens after 030-1.

Before each PR is opened, run a leak scan: no partner, customer or person names; no
hosts other than `example.com`/`.test`/`localhost`; no local home paths.

Tests are part of this feature (spec FR-025, SC-005; plan § Testing), so test tasks
appear in each story, and every new read has a foreign-organization case.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**:
  - US1: see the plant as it is now (batch latest)
  - US2: keep the plant moving (the stream)
  - US3: grant a whole site
  - US4: know what can be bound (parameters, sites)
  - US5: use all of it from the SDK
  - US6: operate it (limits, visibility, documentation)
- Paths are from the repository root. `Integrations/` means
  `apps/api/app/Domain/Integrations/`; `runtime/` means `services/runtime/`.

---

## PR 030-0: Documents

### Phase 1: Documents

- [x] T001 ADR-032, ADR-033 and ADR-034 (Proposed) in `docs/adr/`, their rows in `docs/adr/README.md`, and the roadmap entry under Integrations in `docs/roadmap.md`
- [x] T002 `specs/030-plant-following-applications/`: spec with clarifications, checklist, plan, research, data model, two contracts, quickstart, tasks
- [x] T003 Leak scan the documents, run `python3 tooling/docs/check_links.py`, and keep pull request 166 current

**Checkpoint**: PR 030-0 merged. PR 030-1 and PR 030-2 can start.

---

## PR 030-1: Grants by site, one resolver, parameters and sites

### Phase 2: Foundation (blocks US3 and US4; the stream reuses it)

- [x] T004 Migration `apps/api/database/migrations/2026_11_XX_000001_add_site_uuids_to_integration_applications.php`: `site_uuids` json, nullable; no backfill (every existing row keeps its device list). Add the cast in `Integrations/Models/IntegrationApplication.php`
- [x] T005 `Integrations/Services/ApplicationGrant.php` (research R7): a value object with `kind` (`devices` when `device_uuids` is non-empty, else `sites`), `deviceUuids`, `siteUuids`, `covers(Device): bool` (uuid in the list, or `site_id` among the scope's sites; "A device with `site_id = null` is never covered by a site scope"), `deviceQuery(Builder): Builder` (`whereIn('uuid')` or `whereIn('site_id')`, always inside `where('organization_id')`), and `resolveUuids(): array`. Site UUIDs resolve to site ids once per request. "No ceiling for a site scope"
- [x] T006 `Integrations/Services/ApplicationGrants.php`: `for(IntegrationApplication): ApplicationGrant`, and `siteDeleted(Site): void`, which removes the site from every scope naming it, bumps `revision` and `grant_revision`, deletes tokens, calls `WebhookDispatch::cancel`, and audits `application.grants_updated` with `reason: site_deleted`; an emptied scope is kept empty
- [x] T007 Replace every inline grant check with the resolver: `Integrations/Http/ReadController.php` (`deviceQuery`), `Integrations/Http/TelemetryController.php` (`device`), `Integrations/Http/LocationController.php` (`query`), `Integrations/Http/GeospatialController.php` (every `array_diff` against `device_uuids`), `Integrations/Http/EventController.php` (`index`), `Integrations/Services/WebhookDispatch.php` (`tick` and the per-delivery check), `Integrations/Http/ApplicationController.php` (`view`). Behaviour for list grants is unchanged; the existing `ApplicationTest`, `EventJournalTest` and `WebhookTest` stay green
- [x] T008 `Integrations/Http/ApplicationController.php`: `ABILITIES` gains `entities:read` and `telemetry:stream`; both `max:8` rules become `max:10`; `grants()` validates "exactly one of the two lists is non-empty": `device_uuids` `array|max:100` of `uuid|distinct`, `site_uuids` `array|max:50` of `uuid|distinct`, every site in the organization (422 "Every site must belong to this organization."), with a field error naming the rule when both or neither are given; `view()` returns `site_uuids` and `sites[]` (`uuid`, `name`)
- [x] T009 `Integrations/Http/AuthenticateApplication.php`: the rule `telemetry:stream` requires `telemetry:read` on both the application and the token (403 as the other compound rules), and `Cache-Control: no-store` set through `$response->headers->set()` so a streamed response works
- [x] T010 `apps/api/app/Domain/Devices/Http/Controllers/SiteController.php` `destroy`: call `ApplicationGrants::siteDeleted($site)` inside the same transaction, before `ActivityLog::record('site.deleted')`
- [x] T011 [P] `packages/api-client/src/index.ts`: `IntegrationAbility` gains `"entities:read" | "telemetry:stream"`; `IntegrationGrants` gains `site_uuids: string[]`; `IntegrationApplication` gains `site_uuids` and `sites: {uuid: string; name: string}[]`
- [x] T012 [P] `apps/api/tests/Feature/Contract/IntegrationContractTest.php`: `ABILITIES` and the `x-abilities` expectations gain the two abilities; `forbidden()` gains the `telemetry:stream` compound case

**Checkpoint**: the resolver is the only place a device is judged granted; every existing integration test passes.

### Phase 3: User Story 3, grant a whole site (P1) 🎯 MVP

**Goal**: a manager grants a site; devices at it are granted while they are there.

**Independent Test**: quickstart run 2.

- [x] T013 [US3] `apps/api/tests/Feature/Domain/Integrations/GrantScopeTest.php`: saving a scope; both lists refused; neither refused; a foreign site refused 422 with the generic field error; a device at the site is readable, listed, streamed by the feed and delivered by the webhook, and a site-less device is not; a device registered later is granted; a device moved out is 404; the scope change bumps `grant_revision`, invalidates the token, rejects the cursor and disables the webhook; `siteDeleted` removes the site, bumps the revision and audits `reason: site_deleted`; a foreign organization's application cannot read through a scope
- [x] T014 [US3] `apps/portal/src/integrations/Integrations.tsx` `GrantFields`: a mode switch **Devices** / **Sites** (`Tabs` from `@iot-os/ui`, both modes visible); in Sites mode a `SearchableSelect` fed by `api.sites(org)` with a removable list capped at 50; the summary counts abilities from the list instead of "of 4" and shows "N sites" for a scope; the confirmation names that saving a scope invalidates the token and disables the webhook; `valid()` enforces exactly one non-empty list and `telemetry:stream` ⇒ `telemetry:read`
- [x] T015 [US3] `apps/portal/src/integrations/Integrations.tsx`: the application summary and the devices panel show the scope's sites with their current device counts, and a scope emptied by a site deletion shows "No sites: this application reads nothing until a site is granted"
- [x] T016 [P] [US3] `apps/portal/e2e/integrations-sites.spec.ts` with `page.route` mocks: switch to Sites, pick two sites, save past the confirmation, see the revision and the emptied-scope message
- [x] T017 [US3] `contracts/openapi/supplements/integration.yaml` and the management operations: `site_uuids` and `sites[]` on the application schema and examples; the application create and update operations are on `contracts/openapi/pending-schemas.json` (shrink-only), so either document them fully and remove them from the list in this PR, or leave them pending and add only the components; `php artisan contract:export --check` passes

**Checkpoint**: a site scope is saved in the portal and enforced on every integration read.

### Phase 4: User Story 4, know what can be bound (P2)

**Goal**: a device read carries its parameters, profile and site; sites are listable.

**Independent Test**: quickstart run 5.

- [x] T018 [P] [US4] `apps/api/tests/Feature/Domain/Integrations/DeviceParametersTest.php`: the device read carries `profile {uuid, name, revision}`, `site {uuid, name, timezone}` and `parameters[]` with `uuid`, `key`, `name` (the profile's `label`), `unit`, `data_type`, `decimals` (`display.precision`), `accepts_command`, `reports_state`; empty `parameters` with no profile revision; null `profile` and `site` when absent; the list is unchanged; a foreign device is 404
- [x] T019 [P] [US4] `apps/api/tests/Feature/Domain/Integrations/SitesReadTest.php`: every site of the organization ordered by name with `granted_devices_count` within the resolved grant; 403 without `entities:read`; a foreign organization's token is 404
- [x] T020 [US4] `Integrations/Http/ReadController.php` `device`: add `profile`, `site` and `parameters` from the applied (else last-applied) configuration's `profile_canonical_json`, reusing `DeviceView::device`'s profile and site builders; `#[QueryParameter]` untouched
- [x] T021 [US4] `Integrations/Http/SiteReadController.php` `sites` and the route `GET sites` under `AuthenticateApplication:entities:read` in `Integrations/routes.php`; the count uses `ApplicationGrant::deviceQuery`
- [x] T022 [US4] `contracts/openapi/supplements/integration.yaml`: `DeviceParameters` component and the device read example; `SiteList` component and the sites operation with its example; `IntegrationContractTest::OPERATIONS` gains the sites operation; `contract:export --check` passes
- [x] T023 [P] [US4] `packages/integration-sdk/src/index.ts`: `Device` gains `profile`, `site` and `parameters` (validated additively), new `sites()` with a `Site` type; `test/client.test.mjs` covers both; README section "Parameters and sites (0.6.0)"

**Checkpoint**: a twin can learn what to bind from one device read and one site list.

### Phase 5: PR 030-1 documentation and verification

- [x] T024 `docs/features/integrations.md`: the abilities table (two new rows and the `telemetry:stream` rule), "Grants by site" under Applications and grants, the device read's new fields, the sites operation; `apps/api/resources/help` integrations guide if it describes grants
- [x] T025 Rebuild api, workers and portal; run quickstart runs 1 (API and SDK), 2 and 5; record the results in the PR; leak scan; open PR 030-1 against `main`

**Checkpoint**: PR 030-1 merged. PR 030-3 can start.

---

## PR 030-2: The snapshot

### Phase 6: User Story 1, see the plant as it is now (P1)

**Goal**: the latest values of up to 100 devices, with presence, in one request.

**Independent Test**: quickstart run 3.

- [ ] T026 [P] [US1] `runtime/internal/storage/store.go` `LatestBatch(ctx, org, devices []string) (map[string][]LatestReading, error)`: one query over `device_runtime.latest` with `DISTINCT ON (device_uuid, parameter_uuid)` preferring each device's applied configuration, at most 100 devices; `runtime/internal/storage/store_test.go` database case
- [ ] T027 [US1] `runtime/internal/app/http.go` `latestBatchHTTP` on `GET /internal/measurements/latest-batch?organization_uuid&devices=` (comma list or `devices[]`, up to 100): per device the same stale downgrades and `processing: inactive` rules as `latestHTTP`, presence from `Engine.Snapshot`, 404 when any device belongs to another organization; `runtime/internal/app/http_test.go` cases for 401, a foreign device, and an inactive device
- [ ] T028 [P] [US1] `apps/api/tests/Feature/Domain/Integrations/LatestBatchTest.php`: three devices in request order with readings, `presence` and `last_seen_at` from the device row (`DeviceView::presence`: "`unknown` when the runtime has not been seen for 20 s"), an empty `readings` for a never-reporting device with `configuration_uuid: null`, 404 for the whole request on one ungranted or foreign device, 422 for 101 or a repeat, 503 when the runtime fails; `Http::assertSent` with `organization_uuid` and the device list
- [ ] T029 [US1] `Integrations/Http/TelemetryController.php` `latestBatch` and the route `POST telemetry/latest/query` under `telemetry:read`: validate `device_uuids` `required|array|min:1|max:100` of `uuid|distinct`; resolve through `ApplicationGrant` and refuse 404 if any is outside; one `RuntimeClient::request` call; compose each entry as `latest` does plus `presence` and `last_seen_at`; `schema_version: telemetry-latest-batch.v1`
- [ ] T030 [US1] `contracts/openapi/supplements/integration.yaml`: `TelemetryLatestBatch` component and the operation patch with its example (the golden fixture); `IntegrationContractTest::OPERATIONS` and `INVALID_INPUT` gain the operation; `contract:export --check` passes
- [ ] T031 [P] [US1] `packages/integration-sdk/src/index.ts` `latestQuery(deviceUuids, signal?)` through `#write` with a `LatestBatch` validator; `test/client.test.mjs` covers the shape, the contract example, 404 and 422; README section "Batch latest (0.6.0)"

**Checkpoint**: one request paints a plant.

### Phase 7: PR 030-2 documentation and verification

- [ ] T032 `docs/features/integrations.md`: the batch latest under Telemetry semantics, including that its `presence` is the device read's while the single-device latest read's is the runtime's; `docs/reference/api.md` route table
- [ ] T033 Rebuild api and runtime; run quickstart runs 1 (API, runtime and SDK) and 3, including the timed 100-device request (under 2 s, SC-001); record in the PR; leak scan; open PR 030-2 against `main`

---

## PR 030-3: The stream

### Phase 8: Foundation for the stream (blocks US2 and US6)

- [ ] T034 [P] `contracts/events/v1/telemetry-stream.schema.json` (draft 2020-12, closed): `schema_version` const `telemetry-stream.v1`; `position` string `^(0|[1-9][0-9]{0,19})$` (`0` only ever appears in `open`); `event_id`, `device_uuid`, `configuration_uuid` UUIDs; `generation` integer; `readings` array 1 to 2 000 of closed objects with `parameter_uuid`, `key`, `data_type`, `unit` (string or null), `value` (number, string, boolean or null), `quality`, `observed_at`, `received_at`, `historical`; plus `.fixture.json` and `.cases.json`
- [ ] T035 [P] `contracts/events/v1/telemetry-stream-open.schema.json` (`position`, `devices` integer ≥ 0, `opened_at`), `telemetry-stream-reset.schema.json` (`position`), `telemetry-stream-closed.schema.json` (`reason` enum `lifetime|grant_changed|credentials_changed|runtime_unavailable|shutdown`, `position`), each with fixture and cases; all four listed in `contracts/internal/catalogue.json` with producer `runtime/internal/devices/stream_test.go`, relay `apps/api/tests/Feature/Domain/Integrations/TelemetryStreamTest.php` and consumer `packages/integration-sdk/test/stream.test.mjs`
- [ ] T036 [P] `runtime/internal/devices/stream.go`: `ProjectStream(CommittedTelemetry, sequence) StreamReading` dropping `telemetry_id`, `organization_uuid`, `installation_uuid`, `adapter_revision_uuid`, `manufacturer_serial`, `timestamp_source` and `diagnostic`; `runtime/internal/devices/stream_test.go` with `contractstest.AssertProduced` for all four event kinds
- [ ] T037 Migration `apps/api/database/migrations/2026_11_XX_000002_create_integration_stream_sessions.php`: `id` bigint, `integration_application_id` fk restrict on delete, `organization_id` fk, `opened_at`, `last_seen_at`, `last_position` string(20) nullable, `device_count` integer, `closed_at` nullable, `close_reason` string(32) nullable (`lifetime`, `grant_changed`, `credentials_changed`, `runtime_unavailable`, `shutdown`, `client`); index on (`organization_id`, `closed_at`, `last_seen_at`); model `Integrations/Models/IntegrationStreamSession.php`
- [ ] T038 `apps/api/config/integrations.php`: `stream_lifetime_seconds` (env `IOT_STREAM_LIFETIME_SECONDS`, default 3600), `streams_max_open` (env `IOT_STREAMS_MAX_OPEN`, default 10), `streams_per_application` (env `IOT_STREAMS_PER_APPLICATION`, default 2), `streams_per_organization` (env `IOT_STREAMS_PER_ORGANIZATION`, default 10), `stream_recheck_seconds` (30), `stream_keepalive_seconds` (60); `.env.example` entries
- [ ] T039 `Integrations/Services/StreamSessions.php`: `open(application, deviceCount): IntegrationStreamSession` inside one transaction with the application row locked, counting "`closed_at IS NULL AND last_seen_at > now() - 90 s`" per application (limit `streams_per_application`), per organization (limit `streams_per_organization`) and per deployment (`streams_max_open`), throwing a 429 exception with `Retry-After: 30` and a body naming the limit; `touch(session, position)`; `close(session, reason, position)`; `prune()` for rows older than 30 days, registered in `apps/api/routes/console.php` with the other prune tasks
- [ ] T040 [P] `Integrations/Services/SseWriter.php`: `event(string $name, ?string $id, array $data)`, `comment(string)`, writing `event:`, optional `id:`, one `data:` line of JSON, a blank line, and flushing (`ob_flush` guarded, `flush`); a unit test for the framing in `apps/api/tests/Unit/Integrations/SseWriterTest.php`
- [ ] T041 `apps/api/app/Domain/Devices/Services/RuntimeClient.php` `stream(string $path, array $query, callable $onChunk, callable $shouldStop): void`: the Guzzle `stream` option, no read timeout, chunks handed to `$onChunk` until the body ends or `$shouldStop()` is true; `ConnectionException` and non-2xx mapped as `request()` maps them; `request()` unchanged
- [ ] T042 [P] `deploy/docker/api/php-fpm.release.conf` (`pm = dynamic`, `pm.max_children = 24`, `pm.start_servers = 4`, `pm.min_spare_servers = 2`, `pm.max_spare_servers = 8`, `request_terminate_timeout = 0`), copied by `deploy/docker/api/Dockerfile.release` into the pool directory; `deploy/release/compose.yml` api `mem_limit: 768m`; `deploy/compose/compose.app.yml` and `deploy/docker/api/Dockerfile` set `PHP_CLI_SERVER_WORKERS=8`
- [ ] T043 [P] `runtime/cmd/runtime/main.go`: `BaseContext` returning the signal context; `main` waits for `server.Shutdown` to return before `runtime.Close()`

**Checkpoint**: contracts, the session table, the writer and the relay primitive exist; nothing is routed yet.

### Phase 9: User Story 2, keep the plant moving (P1)

**Goal**: a resumable, filtered stream of committed readings within two seconds.

**Independent Test**: quickstart run 4.

- [ ] T044 [US2] `runtime/internal/app/broadcast.go`: `committedBroadcaster` with `Subscribe(org string, devices map[string]struct{}, buffer int) (<-chan StreamEvent, cancel func())` and `Publish(events []StreamEvent)`; a subscriber whose buffer (1 000) is full is closed and counted in `streamsDropped`; `runtime/internal/app/broadcast_test.go` for filtering by organization and device, ordering, cancel, and the full-buffer close
- [ ] T045 [US2] `runtime/internal/app/committed.go` `publishCommittedBatch`: after `AckCommitted`, project each event with its sequence and `Publish` it (research R3)
- [ ] T046 [P] [US2] `runtime/internal/storage/committed.go`: `CommittedAfter(ctx, org, devices []string, after int64, limit int)` ordered by `sequence` using the `(organization_uuid, event->>'device_uuid', sequence)` index; `CommittedFloor(ctx, org) (int64, bool)` and `CommittedHead(ctx, org) (int64, error)`; database tests in `runtime/internal/storage/committed_test.go`
- [ ] T047 [US2] `runtime/internal/app/stream.go` `telemetryStreamHTTP` on `GET /internal/telemetry/stream?organization&devices&after`: validate (400 on a malformed request, up to 1 000 devices, `after` matching `^(0|[1-9][0-9]{0,19})$`, where `0` means from the oldest retained row); `reset` and close when `after` < `CommittedFloor` (an organization with no retained rows has head `0` and no floor, so a fresh stream opens at `0`); otherwise subscribe first, then catch up from `CommittedAfter` in pages of 500 writing `reading` frames, then drain the live channel dropping any event whose sequence ≤ the last written; `open` with the head (or `after`) first; keepalive comment after 60 s of silence; `http.NewResponseController(w).SetWriteDeadline(time.Time{})`; flush per frame; end on request or application context; `streamsOpen` counter; a log line with the organization and device count. Register the route in `runtime/internal/app/http.go`
- [ ] T048 [US2] `runtime/internal/app/stream_test.go`: with `httptest.NewServer`, read frames for a fresh stream (open then live readings via `Publish`), a resumed stream (catch-up rows then live with a duplicate dropped), a reset, a fresh stream for an organization with no rows (`open` at `0`), a device that stops producing (only keepalives, the stream stays open), 401 without the token, and that the stream ends when the application context is cancelled; the database cases run under `DEVICE_TEST_DATABASE_URL`
- [ ] T049 [US2] `Integrations/Services/StreamRelay.php`: `run(application, grant, deviceSubset, after, SseWriter, StreamSessions)`: opens the session (T039), opens `RuntimeClient::stream` with the resolved device set and `after`, forwards every chunk, and between chunks every `stream_recheck_seconds` re-reads `grant_revision`, `revoked_at` and the token row (existence and `expires_at`), touches the session, and for a site scope re-resolves the device set: when it differs from the set the internal stream was opened with, reopens the internal stream from the last relayed position with the new set and drops that stream's `open` so the client sees one `open` (FR-008); closes with `grant_changed` only when the revision changed; ends with `closed` for `lifetime` after `stream_lifetime_seconds`, `grant_changed`, `credentials_changed`, `runtime_unavailable` (the runtime body ended or failed), `client` (`connection_aborted()`) or `shutdown` (a termination signal); closes the session with the reason and the last `id` seen in the relayed frames
- [ ] T050 [US2] `Integrations/Http/TelemetryStreamController.php` `stream` and the route `GET telemetry/stream` under `AuthenticateApplication:telemetry:stream` in `Integrations/routes.php`: 406 unless `Accept` allows `text/event-stream`; validate `devices[]` (`array|max:1000` of `uuid|distinct`) and `Last-Event-ID` or `after` (`^(0|[1-9][0-9]{0,19})$`, else 422); resolve the grant and refuse 404 if any named device is outside it; `set_time_limit(0)`; return a `StreamedResponse` with `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-store`, `X-Accel-Buffering: no`, `Connection: keep-alive` whose callback runs `StreamRelay`; 503 before any byte when the runtime refuses the connection; 429 from `StreamSessions`
- [ ] T051 [US2] `apps/api/tests/Feature/Domain/Integrations/TelemetryStreamTest.php` with the runtime faked by a streamed body: 403 without the ability and without `telemetry:read`; 406; 404 for a foreign or ungranted device in `devices[]`; 422 for 1 001 devices and a malformed position; 429 at the third stream of an application and the eleventh of an organization, leaving the open ones; `open` then relayed `reading` frames byte-identical to the fake; `closed` with `grant_changed` after a grant bump within the re-check; a device moved into the granted site mid-stream appears within the re-check with no second `open` relayed, and one moved out disappears; `credentials_changed` after revocation and after `expires_at` passes; `client` when the connection is aborted; `lifetime` with the config set to 1 s; `runtime_unavailable` when the fake body ends; the session row opened, touched and closed with the reason and last position; a foreign organization's token is 404
- [ ] T052 [US2] `contracts/openapi/supplements/integration.yaml`: the stream operation with `x-abilities` (`telemetry:stream`, `telemetry:read`), `x-rate-limits`, the 406/422/429/503 responses, and a `text/event-stream` 200 whose `data` schemas `$ref` the four event contracts with an example each; `apps/api/tests/Feature/Contract/IntegrationContractTest.php` accepts `text/event-stream` 2xx bodies by validating each documented event example against its referenced schema; `OPERATIONS` and `INVALID_INPUT` gain the stream; `contracts/openapi/supplements/info.yaml` version `1.1.0`; `contract:export --check` passes
- [ ] T053 [US2] `packages/integration-sdk/src/index.ts` `telemetryStream({devices?, after?, signal?, maxRetryMs?})`: an async generator over `fetch` with `Accept: text/event-stream`, a `TextDecoder` line parser for `event:`, `id:`, `data:` and comments, the abort timer applied to the handshake only, reconnecting with the last `id` after `closed`, a dropped body or a 503 (backoff 1 s doubling to 30 s), yielding `open`, `reading` and `reset`, throwing `IotApiError` for 401, 403, 404, 422 and 429; exported `StreamEvent` types; no new dependency
- [ ] T054 [US2] `packages/integration-sdk/test/stream.test.mjs` with a fake fetch returning `ReadableStream` bodies: a fresh stream, a resume carrying `Last-Event-ID`, a `reset`, every `closed` reason followed by a reconnect, a body dropped mid-event with no partial yield, each event example from the four contracts parsed, and the token absent from every thrown error
- [ ] T055 [P] [US2] `packages/integration-sdk/examples/stream.mjs` printing `open`, `reading` and `reset` with the same environment variables as `read.mjs`; README section "The telemetry stream (0.6.0)" with the resume and reset contract

**Checkpoint**: readings reach an application within two seconds, resume is gapless, every refusal is named.

### Phase 10: User Story 6, operate it (P3)

**Goal**: operators see streams; developers read what the limits mean.

**Independent Test**: quickstart runs 6 and 8.

- [ ] T056 [P] [US6] `runtime/internal/app/http.go` `statusHTTP`: `streams: {open, dropped}` from the counters; `runtime/internal/app/http_test.go` case
- [ ] T057 [P] [US6] `apps/api/app/Support/Operations.php` `metrics()`: `integration_streams_open{organization}` from `integration_stream_sessions`; its test in `apps/api/tests/Feature/Support/OperationsTest.php` (or the existing metrics test)
- [ ] T058 [US6] Administration read `GET /api/v1/admin/organizations/{organization}/integration-streams` in `apps/api/app/Domain/Administration/` (platform administrators): open sessions with application name, `opened_at`, `last_seen_at`, `device_count`, `last_position`; `packages/api-client` method; `apps/admin` organization page section as a `DataTable` in the existing `Panel` with `RelativeTime`; a feature test with a non-administrator refused
- [ ] T059 [P] [US6] `docs/ops/release.md`: the PHP-FPM pool arithmetic (24 children, `IOT_STREAMS_MAX_OPEN` 10, 768 MiB), how to raise the cap, and what `integration_streams_open` means; `docs/dev/gotchas.md`: `php artisan serve` is single-threaded, `PHP_CLI_SERVER_WORKERS` is required when a stream is open, and the runtime's write deadline is lifted only for the stream handler

**Checkpoint**: an operator can answer "who is streaming, and why was a stream refused".

### Phase 11: User Story 5, the SDK release (P2)

**Goal**: SDK 0.6.0 covers everything; 0.5 consumers run unchanged.

**Independent Test**: quickstart run 7.

- [ ] T060 [US5] `packages/integration-sdk/package.json` version `0.6.0`; README version lines and the install tarball name; `CHANGELOG` section in the README listing 0.6.0's additions (parameters and sites, batch latest, the stream) and that nothing from 0.5 changed
- [ ] T061 [P] [US5] `packages/integration-sdk/test/client.test.mjs`: a case that every 0.5 method still validates its contract example from `openapi.json`; `apps/vertical-demo` builds and its tests pass on `workspace:*`
- [ ] T062 [P] [US5] `apps/docs` developer reference: regenerate from the contract per `docs/dev/docs-site.md`, and add the stream, batch latest and site-scope paragraphs where the integration guide is hand-written

**Checkpoint**: the SDK is the documented way in for all of it.

### Phase 12: PR 030-3 documentation and verification

- [ ] T063 `docs/features/integrations.md`: "The telemetry stream" (abilities, device subsets, positions and resume, reset, the hourly lifetime, close reasons, keepalive, limits, the order "snapshot after the `open` position, then apply the stream", and guidance on proxies that buffer responses), the stream's relation to the committed feed in `docs/reference/events.md`, and the roadmap entry's two follow-ups (dedicated streaming process; multi-instance fan-out) in `docs/roadmap.md`
- [ ] T064 ADR-032 status line to "Accepted" and its row in `docs/adr/README.md`, in this PR
- [ ] T065 Rebuild api, workers, runtime and admin; run quickstart runs 1, 4, 6 (record the api container's memory at ten streams, the p95 delay, and the 20-reconnect exactly-once check for SC-003), 7 and 8; record in the PR; leak scan; open PR 030-3 against `main`

**Checkpoint**: PR 030-3 merged; the Twin Studio connector switches from polling to the stream (SC-007).

---

## Dependencies & Execution Order

### Pull requests

| PR | Phases | Depends on |
| --- | --- | --- |
| 030-0 | 1 | — |
| 030-1 | 2–5 | 030-0 merged |
| 030-2 | 6–7 | 030-0 merged |
| 030-3 | 8–12 | 030-1 merged (the resolver and the abilities); rebase on 030-2 if it merged first |

030-1 and 030-2 touch different files except `contracts/openapi/supplements/integration.yaml`,
`IntegrationContractTest.php`, `docs/features/integrations.md` and the SDK's
`index.ts`, `client.test.mjs` and README; whichever lands second rebases.

### Within PR 030-1

- T004 → T005 → T006; T007 needs T005; T008 and T009 need T005; T010 needs T006;
  T011 and T012 are independent.
- US3 (Phase 3): T013 needs T004–T010; T014 → T015; T016 is independent of T014's
  code (mocked); T017 needs T008.
- US4 (Phase 4): T018 and T019 are independent tests; T020 and T021 need T007;
  T022 needs T020 and T021; T023 needs T022's examples.
- Phase 5 needs Phases 3 and 4.

### Within PR 030-2

- T026 → T027; T028 is independent; T029 needs T027's route shape; T030 needs T029;
  T031 needs T030's example. Phase 7 needs Phase 6.

### Within PR 030-3

- Phase 8: T034, T035, T036, T040, T042, T043 are independent; T037 → T039;
  T038 → T039; T041 is independent.
- US2 (Phase 9): T044 → T045; T046 is independent; T047 needs T044 and T046;
  T048 needs T047; T049 needs T039, T040, T041; T050 needs T049; T051 needs T050;
  T052 needs T050 and T034–T035; T053 needs T052's examples; T054 needs T053;
  T055 needs T053.
- US6 (Phase 10): T056 needs T047; T057 needs T037; T058 needs T037; T059 is
  independent.
- US5 (Phase 11): T060 needs T053; T061 and T062 are independent.
- Phase 12 needs Phases 9–11.

## Parallel examples

- **PR 030-1 day one**: T004 on the migration, T011 on api-client types, T012 on the
  contract test lists, and T018/T019 as failing tests, all at once.
- **PR 030-3 day one**: T034/T035/T036 (contracts and the Go projection), T040 (the
  SSE writer), T042 (deployment files) and T043 (server base context) in parallel;
  then T044/T046 together.
- **Across PRs**: 030-1 and 030-2 run side by side after the documents merge.

## Implementation strategy

- **MVP**: PR 030-1's US3 (grant a site) plus PR 030-2's US1 (the snapshot). With
  those two merged a twin can paint a plant from one request and follow it by polling,
  which is the twin's documented interim path.
- **Then the stream**: PR 030-3 is the largest piece and the only one that changes the
  runtime's serving model and the release's pool. Its Phase 8 can start on a branch
  the moment 030-1 merges, with T044–T048 (runtime) and T049–T051 (Laravel) in parallel
  by two people.
- **Operate and release last**: US6 and US5 close PR 030-3 so the first customer stream
  is observable and the SDK release notes describe what shipped, not what was planned.
