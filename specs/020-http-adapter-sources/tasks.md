# Tasks: HTTP Adapter Sources

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: part of the feature. The constitution requires tenant isolation tests (III),
contracts with fixtures (IV) and verification in the running stack (IX); SC-002,
SC-004, SC-005 and SC-011 are proven by tests. Write each story's tests with the story
and see them fail first.

**Delivery**: this folder and ADR-022/ADR-023 are the **plan** pull request. All
phases below are the **build** pull request (`feat/020-http-adapter-sources`, from
`main` after the plan merges, never stacked), one commit per phase group: 2 (shared
fixes), 3–4 (webhook), 5 (polling), 6 (timestamps), 7 (diagnostics), 8 (onboarding),
9 (polish).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: the user story the task serves (US1 to US6)
- Paths are from the repository root

---

## Phase 1: Setup

- [x] T001 Create `contracts/adapters/v1/` with `decoder-input.v1`, `decoder-output.v1`, `source-settings.v1`, `webhook-routes.v1`, `receiver-report.v1`, `runtime-event.v1` and `fetch-result.v1` schemas, each with a fixture and cases per [contracts](contracts/) and contracts/README.md (closed objects, `schema_version` constants, limits); add the directory to the README table; `tooling/verify-devices-contracts.py` passes
- [x] T002 [P] Add `IOT_WEBHOOK_PUBLIC_URL`, `IOT_WEBHOOK_RECEIVER_TOKEN`, `IOT_WEBHOOK_TRUSTED_PROXIES` and limit overrides to apps/api/config/adapters.php, deploy/compose/compose.adapters.yml (api family and the new `webhook-receiver` service on `127.0.0.1:8095`, its state mount read-only) and deploy/release/environment.example

## Phase 2: Foundational (shared adapter fixes; blocks every story)

- [x] T003 [P] services/adapters/lib/decoder.cjs: `inputFromMessage` takes `source`, `receivedAt`, `http`, `poll`; `validateResults` accepts one result or 1–500 and returns `{results, failures}`; `decodeBatch(code, inputs, profile, {concurrency: 2})` sorts results oldest first (receipt-timed last); tests in test/decoder.test.cjs (lists, per-result failure, ordering, 501 results refused)
- [x] T004 [P] services/adapters/lib/state.cjs: atomic JSON write/read and the deduplication log (append, load with 7-day and 100,000 bounds, compaction); tests in test/state.test.cjs including a reload after a simulated crash
- [x] T005 services/adapters/nodes/adapter.js: a module-level settle registry; every MQTT source overrides `client.handleMessage` so the PUBACK and the next packet wait for settlement; the source disconnects while the publisher is offline; remove the 32-message drop; the decoder uses `decodeBatch` and reports failures with a 16 KiB excerpt
- [x] T006 services/adapters/nodes/adapter.js publisher: QoS 1 publishes awaited with retry on reconnect; settle after acknowledgement; deduplication through lib/state.cjs written after acknowledgement; newest observation per source persisted; `is_historical` for older results; `timestamp_source: receipt` property for results without `observedAt`
- [x] T007 [P] services/runtime: `decodeMetric` reads the `timestamp_source` property into `devices.Metric.TimestampSource`; `ReadingsTraced` labels `receipt` when it says so; tests in internal/sparkplug and internal/devices, plus a location test that a receipt-labelled fix reports an untrusted time
- [x] T008 services/adapters/manager.cjs: `topics()` refuses `iot-os/`; `/test` builds inputs from fixtures' `source`, `received_at`, `http`, `poll` and reports per-fixture `outputs`/`failures` for lists; tenant Mosquitto config `max_queued_messages 2000`, `max_queued_bytes 67108864`, `autosave_interval 30`, memory 256m
- [x] T009 apps/api: `AdapterSourceType` enum; `AdapterService::fields` per-type validation (data model), reserved prefix, optional fixture topics and the new fixture fields, empty fixtures in drafts with tests requiring 1–10; migrations for `device_adapters` (`ingest_id`, `poll_state`, `cursor_generation`, `cursor_start`) and the four new tables; models `WebhookSecret`, `AdapterDelivery`, `AdapterOutcomeCount`, `PollRun`; existing DeviceAdapterTest stays green
- [ ] T010 Extend services/adapters/integration/verify.cjs: a busy decoder never drops (200 messages against one slow decoder), a runtime restart redelivers an unacknowledged message, a restarted runtime still refuses a duplicate `messageId`, receipt-timed results carry the property

## Phase 3: User Story 1 - Receive a vendor cloud webhook (P1) 🎯 MVP

- [x] T011 [P] [US1] services/adapters/lib/webhook.cjs: header, HMAC (hex/base64, prefix, signed timestamp ±5 min) and URL token checks in constant time; SHA-256 token hashes; path parsing (token segment removed); header filtering; token buckets; tests in test/webhook.test.cjs (every mode, wrong secret, stale, prefix, base64, other adapter's secret)
- [x] T012 [US1] services/adapters/receiver.cjs: routing file reload; `POST /w/:id/*` with method, size (decompressed) and header limits, rate limits per adapter, organization and failed-auth address, authentication, `sampling` (202 + sample report), `running` (MQTT 5 QoS 1 publish with user properties, 202 after PUBACK, 503 on failure or 0x10), `paused` (503), offline backlog bound from the status topic; reports every 10 s; metrics and health; tests in test/receiver.test.cjs with a fake broker
- [x] T013 [US1] services/adapters/manager.cjs `/webhook`: provision `webhook-<adapter>` ACLs, keep its password, write routes.json atomically (0600, readable by the receiver user), remove routes; `/deploy` for `webhook` provisions the runtime subscriber and status ACLs; tests in test/manager.test.cjs for the file shape against `webhook-routes.v1`
- [x] T014 [US1] services/adapters/nodes/adapter.js webhook source: MQTT 5, persistent session (expiry 7 days), reserved topic, retained `online` status and `offline` will, decoder input per decoder-io.md; services/adapters/lib/flow.cjs names the source node by type
- [x] T015 [US1] services/adapters/Dockerfile target `webhook-receiver`; compose service in deploy/compose and deploy/release (`WEBHOOK_RECEIVER_IMAGE`), deploy/release/Caddyfile `hooks.{$DOMAIN}` proxying only `/w/*`; release tooling builds and pins the image (tooling/release)
- [x] T016 [US1] apps/api `WebhookRoutes`: ingest identifier on first webhook save, `sync()` on save, deploy, pause, rollback, source change and organization deletion; `webhook` view and availability (FR-003); `receiver-reports` internal route (token, idempotent by `report_id`, samples and rejections into deliveries, counts, `last_used_at`)
- [x] T017 [US1] apps/api tests: tests/Feature/Domain/DeviceAdapters/WebhookSourceTest.php (create, availability off, sampling samples, deploy syncs `running`, reports, URL never contains names) and isolation (another organization's adapter, secret and deliveries are unreachable; a report for another tenant's adapter is ignored)
- [ ] T018 [US1] Extend integration/verify.cjs: receiver → tenant broker → runtime → Sparkplug for a signed delivery; another adapter's secret gets 401; a delivery accepted while the runtime is stopped is decoded after it starts

## Phase 4: User Story 2 - Rotate or revoke a webhook secret (P1)

- [x] T019 [US2] apps/api `WebhookController`: list, create (generated ≥ 32 bytes or pasted ≥ 16 characters, two active at most, previous expires in 7 days), revoke; audit `device.adapter.webhook_secret.{created,rotated,revoked}`; URL token mode returns the new ingest URL; every change syncs the manager synchronously
- [x] T020 [US2] Tests: rotation keeps both valid, revocation reaches routes.json, expiry is enforced by the receiver (test/receiver.test.cjs with a clock), audit has labels and never values, `Device.manage-connections` required, another adapter's secret uuid is 404

## Phase 5: User Story 3 - Poll a vendor REST API (P1)

- [x] T021 [P] [US3] services/adapters/lib/poll.cjs: placeholders and formats, request building with credential placement, `safeRequest` (secureLookup pinning, redirects ≤ 3 re-checked, credentials only to the original host, 30 s, 8 MiB decompressed, 16 KiB headers), JSON Pointer, records and cursor extraction, `more` rules, redaction; tests in test/poll.test.cjs (literal private, resolving private, redirect to private, rebinding between lookups, oversized, compressed bomb, token and window cursors, stuck cursor)
- [x] T022 [US3] services/adapters/nodes/adapter.js poll source: cursor file with generations, schedule with jitter, page loop with `max_pages` and the 5 s catch-up, organization budget (60/min), backoff to 1 h with `Retry-After`, permanent stops, page → one batch message, commit after settlement, `poll_run` reports
- [x] T023 [US3] services/adapters/manager.cjs `/poll-test` (at most 4 at once) and `/deploy` for `poll` (credentials into node credentials, cursor generation)
- [x] T024 [US3] apps/api `PollingService` and `PollingController`: Fetch now (shared limiter 6/min per adapter, redacted result), runs, state, cursor reset and resume as redeployments with the next generation, `deploy` `cursor_start_at`; `poll_run` events update runs and `poll_state`; audit `device.adapter.cursor.reset`
- [x] T025 [US3] apps/api tests: tests/Feature/Domain/DeviceAdapters/PollingSourceTest.php (validation: placeholders, private literals, intervals, credential headers; Fetch now needs `Device.manage-connections` and is throttled; credentials never in responses or revision definitions; reset and resume; isolation)
- [ ] T026 [US3] Extend integration/verify.cjs with a local HTTPS-free history server (development switch): two pages, a restart between pages, overlap deduplicated, cursor file committed only after publishing

## Phase 6: User Story 4 - Trustworthy times for late data (P1)

- [ ] T027 [US4] Tests across the path: decoder results without `observedAt` stored as `receipt` (runtime test with a captured adapter packet), late records historical and not latest (integration test), page published oldest first, a record older than retention refused with a diagnostic (publisher reads the retention from the deploy body)
- [x] T028 [US4] FR-050 release list: `php artisan adapters:timestamp-audit` lists deployed adapters whose decoders return no `observedAt` while their devices have a location binding (decoder tests' outputs); documented in the release notes

## Phase 7: User Story 5 - Find out why data is not arriving (P2)

- [x] T029 [US5] apps/api `AdapterDiagnostics`: counts for 24 h and 7 d, last 20 rejected and failed, runs, source state (data model), checklist state; `failure` and `outcomes` events; the adapter view and directory carry `source_state`; `IngestionDiagnostics` and the `get_ingestion_diagnostics` tool describe HTTP sources; `adapters:prune` scheduled daily; the operations exporter adds poll runs per outcome and adapters in backoff (FR-075)
- [x] T030 [P] [US5] services/adapters/nodes/adapter.js reporter: `failure` (throttled) and `outcomes` (every 60 s) events with report ids
- [x] T031 [US5] Tests: diagnostics shape, pruning, state rules, agent tool output, no secret or unauthenticated body stored

## Phase 8: User Story 6 - Onboard a device with the assistant (P2)

- [x] T032 [US6] apps/api `AssistantScope` enum and migration (`adapter` → `onboarding`); `Services/AssistantQuestions` extracted from ProfileAssistantTools (behaviour unchanged, profile tests green); controller, access and run accept `onboarding` (and `adapter` as an alias); conversations may start unbound
- [x] T033 [US6] apps/api `Agents/OnboardingAssistant` (instructions per plan, context without secrets) and `Tools/OnboardingTools` per [onboarding-tools.md](contracts/onboarding-tools.md); ProfileAssistantTools, ApplyProfileSection and ProfileProposalService accept onboarding conversations; `AdapterProposal` migration (`kind`, `name`, `artifact_uuid`, `source`, `fixtures`, nullable adapter and code) and the decision routes for `reuse`, `create`, `change`
- [x] T034 [US6] apps/api tests with the agent faked: every action's permission and binding, `fetch_now` shares the limit and returns redacted data, `propose_change` refuses secrets, `create` needs both permissions and is idempotent, profile drafting in an onboarding conversation, isolation of conversations and proposals, SC-011 (no credential in instructions, tool results or proposals across the evaluation fixtures)
- [ ] T035 [US6] `php artisan assistant:evaluate-onboarding` with resources/assistant/onboarding-evaluation.json (Sparkplug device, gateway, webhook sensor, REST tracker, existing adapter, missing profile, pasted secret) recording path, proposals and leaks

## Phase 9: Portal (US1–US6)

- [x] T036 [P] packages/api-client: source types, webhook, secrets, deliveries, Fetch now, runs, cursor, resume, checklist, onboarding proposals and methods
- [x] T037 [US1] apps/portal/src/adapters/Routes.tsx Source tab: `ChoiceCard`s for the four sources (webhook disabled with an explanation when unavailable), per-type copy everywhere `sourceLabel` and the deploy review assume MQTT; apps/portal/src/adapters/sources/WebhookSource.tsx (ingest URL with copy, authentication form, secrets with create, paste, rotate, revoke, shown once)
- [x] T038 [US3] apps/portal/src/adapters/sources/PollSource.tsx: request (method, URL, query and header rows with placeholder chips, body), credentials, schedule, paging, records and cursor, **Fetch now** result panel (status, duration, excerpt, records table, next cursor, **Add as fixture**); deploy dialog asks where the cursor starts
- [x] T039 [US1] apps/portal/src/adapters/SetupChecklist.tsx and Samples.tsx (deliveries, failures and previews with **Add as fixture**); the decoder help explains the input per source
- [x] T040 [US5] apps/portal/src/adapters/Activity.tsx tab: outcome counts, rejected and failed deliveries (`DataTable`), runs, cursor with reset and resume, source state with `Status`
- [x] T041 [US6] apps/portal/src/adapters/OnboardingAssistant.tsx replacing AdapterAssistant.tsx: messages, questions, path cards, adapter proposals (reuse, create, change with code, settings and fixture diffs), profile section reviews through assistant/ProposalReview.tsx, next-step buttons; a body of the workspace assistant panel (Ask on Add device and adapter pages, the checklist's **Ask the assistant**), not a workbench tab or page; DeviceOnboarding.tsx card copy and **Ask the onboarding assistant**; workspace suggestions
- [ ] T042 Playwright: apps/portal/e2e/adapters.spec.ts extended (webhook setup and secrets, polling with Fetch now and fixtures, checklist states, Activity) and apps/portal/e2e/onboarding-assistant.spec.ts (questions, path card, create proposal, change proposal, profile review), with axe checks; `pnpm --filter @iot-os/portal lint` passes

## Phase 10: Polish and verification

- [x] T043 [P] tooling/simulators/vendor_tracker_api.py (+ vendor_tracker_api.md, its API documentation for the assistant scenario) and tooling/simulators/vendor_webhook_cloud.py, with pytest tests; docs/dev/simulators-and-fixtures.md
- [x] T044 [P] tooling/verify-http-adapters.mjs for quickstart A and B checks
- [x] T045 Docs: docs/features/adapters.md (sources, checklist, timestamps, limits, diagnostics), docs/features/assistant.md (onboarding scope), docs/ops (ingest address, Caddy, firewall, limits, backups of routes.json), the developer docs pages for signing deliveries and configuring polling, docs/dev/gotchas.md for anything surprising; `python tooling/docs/check_links.py`
- [x] T046 OpenAPI: `php artisan contract:export`, supplements for new errors, `contract:check`; `php artisan agents:tools --check`
- [x] T047 Rebuild the adapter overlay (adapter-manager, webhook-receiver, adapter-runtime-image, API family, runtime, portal) per the local-container-verification skill and run quickstart A–E against the simulators; record results and screenshots in the pull request

## Build notes (2026-10-28)

- Not done in the build pull request, left for follow-ups: T010, T018 and T026 (the
  disposable Mosquitto + Node-RED integration test was not extended; the same paths
  were verified against the rebuilt stack with `tooling/verify-http-adapters.mjs`),
  T027 (no automated test for refusing observations older than retention), T035 (the
  onboarding evaluation command) and the onboarding assistant Playwright spec in T042.
- Found while verifying and fixed in the build: re-provisioning the receiver's broker
  identity on every secret change dropped its connection; deduplication keys must be
  recorded only for stored readings; an activation rebirth without provenance became an
  invalid reading (the runtime now skips it); raw-token header mode, JSON body
  templates, long rejection paths and report retries (found by the contract fixtures).
