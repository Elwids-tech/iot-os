# Implementation Plan: HTTP Adapter Sources

**Branch**: `plan/020-http-adapter-sources` | **Date**: 2026-10-27 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/020-http-adapter-sources/spec.md`

## Summary

Two adapter source types join the tenant broker and the vendor broker, and the adapter
assistant becomes a device onboarding assistant for every kind of device.

- **HTTP webhook.** A new `webhook-receiver` service (Node, in `services/adapters`, no
  Docker socket, no database) answers each adapter's ingest URL. It checks the
  method, sizes, limits and the secret, then publishes the delivery with MQTT 5 at
  QoS 1 to the adapter's reserved topic on its tenant ingress broker, and answers `202`
  after the broker's acknowledgement ([ADR-022](../../docs/adr/ADR-022-webhook-receiver.md)).
  The adapter flow subscribes there like the tenant broker source. Routing comes from
  a file adapter-manager writes, so deliveries keep flowing while Laravel is down.
- **HTTP polling.** A poller inside the tenant runtime builds the request from
  settings, fetches through a guarded HTTPS client that pins checked public addresses,
  splits pages into records, and commits a cursor file only after every record of a
  page is published. Fetch now runs the same code in adapter-manager.
- **Shared adapter fixes.** Every source acknowledges its input only after publishing
  (MQTT 5 `handleMessage` backpressure instead of a dropping queue), deduplicates
  `messageId` in a per-adapter log that survives restarts, labels results without
  `observedAt` receipt-timed (a metric property the Go runtime reads), publishes a
  batch oldest first, and marks older results historical.
- **Laravel** owns the new settings, ingest identifiers, webhook secrets, delivery and
  run records, outcome counts, Fetch now, cursor resets, diagnostics and pruning.
- **Portal**: four source choices, a webhook panel, a polling form with Fetch now, a
  setup checklist, captured samples that become fixtures in one click, and an
  Activity tab.
- **Onboarding assistant**: scope `onboarding` replaces `adapter`. It asks how the
  device sends data, recommends the path, reuses or proposes an adapter, drafts a
  missing profile with the profile assistant's tools, runs Fetch now read-only, and
  proposes decoder, settings and fixtures as one reviewable change.

Other protocols stay planned on [ADR-023](../../docs/adr/ADR-023-protocol-connectors.md):
the decoder input and output added here carry no Sparkplug concepts.

## Technical Context

**Language/Version**: Node.js 22 (adapter manager, receiver, Node-RED 4.1.13 nodes),
Go 1.27 (runtime), PHP 8.4 / Laravel 13, TypeScript / React 19, Python 3.12
(simulators)

**Primary Dependencies**: `mqtt` 5.16 (MQTT 5 user properties, `handleMessage`),
`quickjs-emscripten`, `protobufjs`; Node's `https`, `zlib` and `dns` (no new runtime
dependency); `laravel/ai` 1.2; TanStack Query; `@iot-os/ui`; Python standard library
only for simulators

**Storage**: PostgreSQL 17 with TimescaleDB: four new tables, three new columns on
`device_adapters`, four on `device_adapter_proposals`. Tenant runtime state files
under the existing per-tenant `/data` volume (cursor, deduplication log, newest
observation). Receiver routing file under the adapter state directory.

**Testing**: `node --test` for the libraries and nodes; the adapter integration test
(real Mosquitto and Node-RED) extended for webhook hand-off, restart redelivery,
polling with a cursor and deduplication; Go tests for the timestamp label; PHPUnit on
PostgreSQL for the API, isolation and the assistant tools (agents faked); Vitest for
pure portal logic; Playwright with a mocked API; contract fixtures through
`verify-devices-contracts.py`; simulator unit tests with `pytest`

**Target Platform**: the Compose stack's adapter overlay and the single-node release

**Project Type**: web application plus services (Laravel API and workers, React
portal, Node adapter services, Go runtime)

**Performance Goals**: `202` within 500 ms at p95 (SC-007); 1,000 polled records
decoded and published within one 5-minute interval (SC-009); revocation within 10 s
(SC-004)

**Constraints**: 1 MiB body, 16 KiB headers, 8 MiB page, 5,000 records, 500 results
per decode; default limits 10/s (burst 100) per adapter, 50/s per organization, 30
failed authentications a minute per address, 60 polling requests a minute per
organization, Fetch now 6 a minute per adapter; tenant runtime 512 MiB; assistant tool
results within `assistant.max_context_characters`

**Scale/Scope**: about 4 migrations, 3 new Node modules plus the receiver, 1 Go change,
~10 new API endpoints, 1 agent and 1 tool class replaced, ~8 portal components, 2
simulators, 7 contract schemas

## Constitution Check

*Checked before research and again after the design below.*

| Principle | Status |
| --- | --- |
| I. Laravel owns intent; Go executes | Pass. Neither Laravel nor Go receives deliveries: the receiver hands them to the tenant broker (ADR-022). Laravel never fetches vendor data for ingestion; Fetch now runs in adapter-manager. Go gains only a metric property it reads. Clients talk only to Laravel. |
| II. Immutable versions | Pass. Source settings and polling credentials are part of each immutable revision; webhook secrets live apart from revisions, as hardware credentials do. Cursor resets and resumes redeploy the applied revision with a new cursor generation; no revision changes. Proposals are immutable. |
| III. Tenant isolation | Pass with tests. Tenant identity comes from the ingest URL plus the verified secret, never the body; each receiver identity can publish to one adapter's topic; polling runs inside the tenant's own runtime. New routes resolve the organization first. Tests prove cross-adapter and cross-organization secrets, deliveries, runs, cursors and conversations are unreachable (FR-080). |
| IV. Contracts first | Pass. New cross-process messages get schemas, fixtures and cases in `contracts/adapters/v1` (decoder input and output, source settings, routing file, receiver reports, runtime events, Fetch now result). Public API changes update `openapi.json` through `contract:export`, the supplement and `packages/api-client`. User references are `user_id`. |
| V. AI proposes, people approve | Pass. The onboarding assistant creates adapters, applies settings, decoders, fixtures and profile sections only through proposals a person applies. Its one action with an external effect, Fetch now, reads vendor data without credentials reaching it and changes nothing (owner decision). Secrets, credentials, the gating test, deploy, activation and cursor resets stay human. Everything works with the assistant off. |
| VI. Show uncertainty | Pass. Readings without `observedAt` are labelled receipt-timed and cannot form trusted location fixes; older results are historical and do not make a device look fresh; source states (**Retrying**, **Stopped**, **Rejecting**) are shown with times. |
| VII. Durable, idempotent messaging | Pass. QoS 1 with acknowledgement only after publishing; persistent broker sessions; restart-safe deduplication; cursor commits after a page is settled; bounded backoff and named permanent stops; one bad record never stalls a page; delivery and run records are pruned after 7 days. |
| VIII. One design system | Pass. `CollectionPage`/`DataTable` for deliveries and runs, `Panel` content, `ChoiceCard` for the four sources, `Status`/`statusOf` for source states, `RelativeTime` for times. The checklist is a portal component; no new kit component unless the checklist is promoted (then with a story). |
| IX. Verified where it runs | Pass. CI on PostgreSQL; the adapter overlay rebuilt (manager, receiver, runtime image, API family, portal, Go runtime); quickstart scenarios A–E run against the simulators in the stack. |

Two ADRs are part of this plan's pull request: ADR-022 (the receiver, amending
ADR-010) and ADR-023 (protocol connectors and one envelope, the direction for later
protocols).

## Design

The details are in [research.md](research.md) (decisions R1–R16),
[data-model.md](data-model.md) and [contracts/](contracts/).

### Adapter services (`services/adapters`)

- `lib/decoder.cjs`: `inputFromMessage(payload, topic, metadata)` accepts `source`,
  `receivedAt`, `http` and `poll`; `validateResults(result, profile)` accepts one
  result or a list of 1–500, validating each alone, and returns
  `{results, failures}`; `decodeBatch(code, inputs, profile, {concurrency: 2})`
  decodes a page and sorts results oldest observation first.
- `lib/poll.cjs` (new): placeholders, request building, `safeRequest` (HTTPS,
  `lookup: secureLookup` so the checked address is the one connected, manual
  redirects re-checked, credentials only to the original host, 30 s timeout,
  decompression capped at 8 MiB), JSON Pointer, record and cursor extraction, cursor
  kinds, redaction, `fetchPage(settings, secrets, cursor)`.
- `lib/state.cjs` (new): atomic JSON files and the deduplication log (append,
  compaction, 7 days / 100,000 keys) under `/data`.
- `lib/webhook.cjs` (new): authentication modes, constant-time checks, token
  hashing, path parsing, header filtering, token buckets.
- `nodes/adapter.js`:
  - **Source** gains `webhook` (MQTT 5, persistent session, reserved topic, retained
    status with a will) and `poll` (the poller loop: schedule with jitter, page limit,
    catch-up pause, backoff, permanent stops, organization request budget, cursor
    file, run reports). All MQTT sources override `client.handleMessage`, so the next
    message and its acknowledgement wait until the publisher settles; while the
    publisher is offline the source disconnects.
  - **Decoder** passes single inputs and pages through `decodeBatch`; failures go to
    the reporter with an excerpt; nothing is dropped.
  - **Publisher** settles a message after QoS 1 acknowledgements from the platform
    broker; writes deduplication keys after the acknowledgement; adds the
    `timestamp_source` metric property for receipt-timed results; sets
    `is_historical` for results older than the newest published for that source
    (persisted); waits for the upstream instead of dropping.
  - **Reporter** forwards `poll_run`, `failure` and minute `outcomes` events.
- `manager.cjs`: `topics()` refuses the reserved `iot-os/` prefix; `/deploy` provisions
  the webhook source's subscriber and status ACLs and passes polling credentials and
  the cursor generation; new `/webhook` (provision `webhook-<adapter>`, write the
  routing file atomically, remove routes) and `/poll-test` (Fetch now); `/test` builds
  inputs from fixtures' `source`, `http` and `poll`. Tenant Mosquitto config gains
  `max_queued_bytes`, `autosave_interval 30` and 256 MiB of memory.
- `receiver.cjs` (new): the webhook receiver (R1–R4), reports to Laravel every 10 s,
  Prometheus metrics on a private port, health endpoint.
- `Dockerfile`: target `webhook-receiver` (node:22-alpine, no docker-cli, non-root).

### Go runtime (`services/runtime`)

- `sparkplug/session.go` `decodeMetric` reads the String property
  `timestamp_source`; `devices.Metric.TimestampSource`; `profile.go` labels a
  timestamped metric `source` unless the property says `receipt`. Location then
  reports an untrusted time for such fixes, as for any receipt-timed reading.

### Laravel (`apps/api`)

- `Domain/DeviceAdapters/Enums/AdapterSourceType` (`platform`, `vendor`, `webhook`,
  `poll`). `AdapterService::fields` validates each type's settings
  ([data model](data-model.md#source-settings)), relaxes fixture topics, allows an
  empty fixture list in a draft (tests still need one), and keeps secrets out of
  `source`.
- `Services/WebhookRoutes` (ingest identifiers, secrets, `sync()` to the manager on
  save, deploy, pause, rotation, revocation, source change and organization deletion),
  `Services/PollingService` (Fetch now, cursor reset and resume as redeployments with
  a new generation, run records), `Services/AdapterDiagnostics` (outcome counts,
  rejected deliveries, runs, source state, checklist state), `Services/AdapterReports`
  (runtime and receiver reports, idempotent upserts).
- Models: `WebhookSecret`, `AdapterDelivery`, `AdapterOutcomeCount`, `PollRun`.
- Controllers: `AdapterController` extended; `WebhookController` (secrets, deliveries);
  `PollingController` (fetch-now, runs, cursor, resume); internal `receiver-reports`
  route with `IOT_WEBHOOK_RECEIVER_TOKEN`.
- `IngestionDiagnostics` and the `get_ingestion_diagnostics` tool gain the source
  state and HTTP wording; `console.php` schedules `adapters:prune` daily.
- Config: `adapters.webhook_public_url`, `adapters.receiver_token`, limits.

### Onboarding assistant (`apps/api/app/Domain/Assistant`)

- `Enums/AssistantScope` (`profile`, `automation`, `onboarding`, `help`) used by the
  controller, access and run; a migration turns existing `adapter` conversations into
  `onboarding` ones. `Services/AssistantQuestions` is extracted from
  `ProfileAssistantTools` (spec 019 planned the same extraction; whichever lands
  second reuses it).
- `Agents/OnboardingAssistant` replaces `AdapterAssistant`: instructions cover the
  paths, the four sources, the decoder contract, timestamps and deduplication, the
  credential rule, and the checklist state; the tools are `OnboardingTools`, plus
  `ProfileAssistantTools` and `ApplyProfileSection` for profile drafting.
- `Tools/OnboardingTools` actions: `find`, `ask_questions`, `recommend_path`,
  `propose_adapter`, `status`, `samples`, `fetch_now`, `test_decoder`,
  `propose_change`, `next_step`, `read_source`
  ([tools contract](contracts/onboarding-tools.md)).
- `AssistantAccess` and `ProfileProposalService` accept `onboarding` conversations for
  profile drafting with the same profile capabilities; `AdapterProposal` gains
  `kind`, `name`, `artifact_uuid`, `source` and `fixtures`; the decision endpoint
  applies `reuse` (binds the conversation), `create` (creates the draft adapter as
  `store` does and binds it) and `change` (one new draft revision).

### Portal (`apps/portal`)

- `adapters/Routes.tsx`: the Source tab uses `ChoiceCard`s for the four sources;
  `adapters/sources/WebhookSource.tsx` (ingest URL, authentication, secrets with
  rotate, revoke, vendor-issued paste); `adapters/sources/PollSource.tsx` (request,
  placeholders, credentials, schedule, paging, records and cursor, Fetch now result);
  `adapters/SetupChecklist.tsx` above the tabs; `adapters/Samples.tsx` (deliveries,
  Fetch now records and previews with **Add as fixture**); a new **Activity** tab
  (`adapters/Activity.tsx`: outcome counts, rejected deliveries, runs, cursor, reset
  and resume); the decoder help explains the input per source.
- `adapters/OnboardingAssistant.tsx` replaces `AdapterAssistant.tsx`: messages,
  questions, path recommendations that open the Add device form, adapter proposals
  (reuse, create, change with code, settings and fixtures diffs), profile section
  reviews through the shared `ProposalReview`, and next-step buttons. It is a body of
  the workspace assistant panel, like the profile assistant: Ask opens it on Add device
  and device adapter pages, and from the suggestions and the checklist's **Ask the
  assistant** anywhere. Proposals are chat cards whose code and settings open in a
  review dialog; next-step buttons open the workbench tab.
- `devices/DeviceOnboarding.tsx`: the adapter card reads "Manufacturer data (MQTT,
  webhook or vendor API)" and offers the onboarding assistant when it is enabled.
- `packages/api-client`: source types, webhook, polling, deliveries, runs and
  proposal types and methods.

### Simulators and tooling

- `tooling/simulators/vendor_tracker_api.py`: a cellular-tracker history API with an
  API key, `start`/`end`/`limit` paging, a `maxDate` cursor, records 10–120 minutes
  old, and `429`, `500`, `401` and slow-response injection.
- `tooling/simulators/vendor_webhook_cloud.py`: a vendor cloud that posts batches of
  messages from several sensors, signed with HMAC (and optionally a timestamp), with
  retries, duplicates, oversized, unsigned and burst modes.
- `tooling/verify-http-adapters.mjs`: drives quickstart A and B through the API.

### Delivery

Two pull requests from `main`, never stacked:

1. **Plan** (this branch): spec updates, plan, research, data model, contracts,
   quickstart, tasks, ADR-022 and ADR-023.
2. **Build** (`feat/020-http-adapter-sources`, from `main` after the plan merges), one
   commit per part: shared adapter fixes and the Go label; polling; webhook receiver;
   API; portal; onboarding assistant; simulators, contracts and docs.

## Project Structure

### Documentation (this feature)

```text
specs/020-http-adapter-sources/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── api.md
│   ├── manager-api.md
│   ├── receiver.md
│   ├── runtime-events.md
│   ├── decoder-io.md
│   └── onboarding-tools.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
services/adapters/
├── manager.cjs            # /webhook, /poll-test, reserved topics, webhook ACLs
├── receiver.cjs           # new: webhook receiver
├── lib/decoder.cjs        # input fields, result lists, decodeBatch
├── lib/poll.cjs           # new: request, guarded HTTPS, pages, cursor
├── lib/state.cjs          # new: atomic files, deduplication log
├── lib/webhook.cjs        # new: authentication, limits, paths
├── nodes/adapter.js       # webhook and poll sources, backpressure, timestamps
├── integration/verify.cjs # webhook and polling scenarios
└── test/*.test.cjs
services/runtime/internal/{sparkplug,devices}/      # timestamp_source property
apps/api/app/Domain/DeviceAdapters/                 # types, services, controllers, models
apps/api/app/Domain/Assistant/                      # onboarding scope, agent, tools
apps/api/database/migrations/                       # 4 migrations
apps/portal/src/adapters/                           # sources, checklist, samples, activity, assistant
apps/portal/src/devices/DeviceOnboarding.tsx
packages/api-client/src/adapters.ts
contracts/adapters/v1/                              # 7 schemas with fixtures and cases
deploy/compose/compose.adapters.yml                 # webhook-receiver service
deploy/release/{compose.adapters.yml,Caddyfile}     # receiver, hooks.${DOMAIN}
tooling/simulators/vendor_tracker_api.py, vendor_webhook_cloud.py
tooling/verify-http-adapters.mjs
docs/features/adapters.md, docs/features/assistant.md, docs/ops/…, docs/dev/simulators-and-fixtures.md
```

**Structure Decision**: the receiver joins the adapter package so it shares the
authentication-free libraries, the MQTT client and the test runner, and ships from
the same Dockerfile with its own target.

## Complexity Tracking

| Exception | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| A new public service (webhook receiver) with an identity on every tenant broker | Principle I forbids Laravel and Go from receiving deliveries; the tenant runtime keeps no inbound port (ADR-010) | Per-tenant public HTTP ports: one more port and certificate per tenant, and the Node-RED runtime would face the internet |
| The assistant may run Fetch now | Owner decision 2026-10-27: finding records and cursors needs a real response, and the action changes nothing | Asking the person to click each attempt; kept as the fallback when the assistant is disabled |
| The Sparkplug B round trip remains on the adapter path | Spec 002's envelope ingestion is not built | Building envelope ingestion first would delay both sources by a spec; ADR-023 records the switch |
