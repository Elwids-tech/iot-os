# Implementation Plan: Data-First Device Onboarding

**Branch**: `spec/021-data-first-onboarding` | **Date**: 2026-10-28 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/021-data-first-onboarding/spec.md`

## Summary

Add device becomes one journey for every kind of source. It has a start screen in
plain words and four steps: Connect, See data, Choose readings, Start collecting.
The order is data first: a source can be saved with no device profile, raw input is
seen before anything is deployed, readings are chosen without code, and one
confirmed action does the rest.

- **Capture before deploy** ([ADR-024](../../docs/adr/ADR-024-capture-before-deploy.md)):
  - A leased capture flow in the tenant runtime reports raw MQTT input for
    tenant-broker and vendor-broker sources. It has no decoder and no publisher.
  - Captures are stored with webhook samples in `device_adapter_deliveries`.
  - During Setup, hardware credentials may publish to any topic except the
    platform's own and other data sources' filters. The platform can then show what
    the firmware sends, suggest the topic filter, and recognise a Sparkplug B
    device.
  - Adapter-manager reads the tenant broker's connection log, so refused
    credentials are named.
- **Field mapping**:
  - A `field-mapping.v1` contract and one interpreter file. The portal runs the
    interpreter for previews within 1 second, and each revision embeds it as an
    ordinary sandboxed decoder.
  - Laravel recompiles the mapping to check that "made with the mapping" holds.
  - A new ignored decoder result lets mappings skip heartbeats on purpose.
- **Device type**: generated as a draft profile from the chosen readings, or an
  existing published profile is reused through a matcher that reports unit
  differences.
- **Start collecting**: a server-side, resumable rollout with these steps:
  1. test against the draft device type;
  2. publish it;
  3. bind and test the exact revision;
  4. deploy;
  5. activate the checked serials in one batch as their births are stored
     (ADR-027).

  Each step checks the confirming person's permission. A missing permission hands
  the setup to someone who has it.
- **Setup and Manage**:
  - The adapter view gains a mode and one status sentence chosen by a fixed
    precedence.
  - The waiting count uses one scope everywhere.
  - "Device adapters" becomes "Data sources" in the interface.
- **Connectors**: six definitions (four adapter, two native Sparkplug B) supply the
  start screen answers, availability, capture method, readings mode, reason
  catalogue and assistant actions. A test-only connector proves that a new one needs
  no change to the journey.
- **Assistant** (P1 since the 2026-10-31 walkthrough):
  - **One conversation per setup**: it follows the person across every page of the
    setup and its source, and never resets on an approval.
  - **Action cards**: each step ends in a card in the conversation with the control
    that applies it. Examples are **Use these settings**, **Create secret**, **Use
    this mapping** (with decoded values), **Create device type**, **Start
    collecting** and **Activate**. The same proposal shows in the step's form, and
    applying from either place is the person's save.
  - **It continues on its own** after each applied card and shows the step reached.
  - **Secrets** are typed or created only in the card and never reach the model.
  - **New abilities**: it tests pasted samples, drafts device types from what the
    person said, reuses only matching sources, and runs the native Sparkplug B paths.
  - **What it still never does**: press a card, run the gating test, publish,
    deploy or activate.

## Technical Context

**Language/Version**: PHP 8.4 / Laravel 13, TypeScript / React 19, Node.js 22
(adapter manager, Node-RED 4.1.13 nodes), Python 3.12 (simulators)

**Primary Dependencies**:

- Existing: `mqtt` 5.16, `quickjs-emscripten`, `laravel/ai` 1.2, TanStack Query,
  `@iot-os/ui` (Stepper, ChoiceCard, JsonEditor on CodeMirror 6), and the Docker
  Engine API that adapter-manager already uses.
- New: no runtime dependency.

**Storage**: PostgreSQL 17 with TimescaleDB.

- New tables: `device_setups` and `device_adapter_rollouts`.
- New columns:
  - `device_adapters`: `device_profile_id`, `mapping`, `code_origin`,
    `capture_until`; `device_profile_artifact_id` becomes nullable.
  - `device_adapter_deliveries`: `retained`, `qos`, `off_filter`, `truncated`.
  - `device_adapter_proposals`: `device_setup_id`, `step`, `fields`,
    `applied_revision`.
  - `assistant_conversations`: `device_setup_id`.
- No tenant runtime state files change.

**Testing**:

- PHPUnit on PostgreSQL: setups, rollouts, permissions, isolation, the compiler,
  the matcher, the status sentence and the count.
- `node --test` for capture mode, the log parser and the interpreter in quickjs.
- The adapter integration test (real Mosquitto and Node-RED) for capture before
  deploy and narrowing.
- Vitest for the mapping runtime, suggestions and field tree.
- Playwright with a mocked API, plus axe.
- Contract fixtures through `verify-devices-contracts.py`.
- `pytest` for the simulator changes.

**Target Platform**: the Compose stack's adapter overlay and the single-node release.

**Project Type**: a web application plus services: the Laravel API and workers, the
React portal and admin, the Node adapter services and the Go runtime. The Go runtime
does not change.

**Performance Goals**:

- Captured input is visible within 10 s of receipt (SC-004).
- A mapping change decodes every sample again within 1 s (FR-032).
- Start collecting reaches Activate within 60 s on the pilot node, once the device
  sends again.

**Constraints**:

- Capture: 64 KiB payload excerpt; 1 capture a second and 20 every 10 s per
  adapter; a 30-minute lease renewed every 60 s; the newest 100 kept per kind, 20
  shown, 7 days.
- Mapping: at most 200 readings and 500 records. The compiled decoder fits the
  64,000-character code limit, and the interpreter is at most 12 KiB.
- Rollouts: at most 50 serials per rollout or batch activation, and one active
  rollout per adapter.

**Scale/Scope**:

- About 4 migrations and a new `Onboarding` domain (6 connector classes,
  `DeviceSetup`, `AdapterRollout`, `ProfileMatcher`, `FieldMappingCompiler`).
- About 14 new API endpoints and 1 manager capture mode with 3 new manager
  endpoints.
- 1 contract added and 2 extended.
- About 14 portal components and 4 kit components.
- 1 admin page, and changes to 2 simulators.

## Constitution Check

*Checked before research and again after the design below.*

| Principle | Status |
| --- | --- |
| I. Laravel owns intent; Go executes | Pass. Capture runs in the tenant runtime; Laravel receives bounded diagnostic samples, as it already does for webhooks (ADR-022), and stores no telemetry from them. Connector definitions, availability, setups and rollouts are Laravel's. Clients talk only to Laravel. Go is unchanged. |
| II. Immutable versions, explicit activation | Pass. A mapping compiles to an ordinary decoder revision with the interpreter embedded, so a revision stays reproducible. Only the bound revision that passed its test deploys. A generated device type is published as an immutable profile revision before binding. Nothing is stored until a person activates. The capture flow is not a revision and processes nothing into telemetry ([ADR-024](../../docs/adr/ADR-024-capture-before-deploy.md) amends ADR-010 to allow it). |
| III. Tenant isolation | Pass with tests. Setups, captures, suggestions, rollouts and copies are scoped to the organization from the route. Capture runs inside the tenant's own runtime and broker. Wider publish rights during Setup stay within that tenant broker and exclude the platform's `iot-os/` topics and other deployed adapters' filters, so a setup device cannot feed another data source. Tests prove another organization cannot read or change setups, captures, suggestions, rollouts, copies or the admin summary's sources. |
| IV. Contracts first | Pass. New: `field-mapping.v1` (schema, fixture, cases, the interpreter and parity cases). Extended within `v1`: `runtime-event` (`capture`, new outcome counts) and `decoder-output` (the ignored result). Public API changes update `openapi.json`, its supplements and `packages/api-client`. User references use `user_id`. |
| V. AI proposes, people approve | Pass. Cards are immutable step proposals. The person presses the card's control in the conversation, or saves the form, through session-only routes that no tool or agent token reaches. Secrets are typed or created in the card and never enter proposals, transcripts or model context (R18). The rollout route is not an assistant tool or in the agent-access catalogue, so no AI runs the test gate, publishing, deploy or activation. Everything works with the assistant disabled (quickstart G). |
| VI. Show uncertainty | Pass. Readings missing from a sample are left out, never zero. Broker history lost on a restart is reported as unknown. The 2-minute diagnostic shows unknown hops as unknown. Receipt-timed readings keep spec 020's label. |
| VII. Durable, idempotent messaging | Pass. Capture events are inserted once per `report_id`. Rollouts are idempotent per `request_uuid` and per step. Activation is event-driven with a one-minute sweep. Captures, setups and rollouts are pruned. |
| VIII. One design system | Pass. The journey composes `Stepper`, `ChoiceCard`, `Panel`, `JsonEditor`, `DataTable`, `Status`/`statusOf` and `RelativeTime`. New kit components `ActionCard`, `SuggestedValue`, `SuggestionBar` and `FieldTree` each get a story. New status domains `setupStep` and `rollout` go in `lib/status.ts`. The sticky bar uses `keepToastsAbove`. |
| IX. Verified where it runs | Pass. CI on PostgreSQL. The overlay is rebuilt (manager, receiver, runtime image, API family, portal, admin). Quickstart A–I run against the simulators in the stack. Hardware and pilot acceptance stay separate. |

ADR-024 is part of this plan's pull request. No accepted ADR is contradicted
otherwise:

- ADR-023's split stays: field mapping is a decoder, and the point map is reserved.
- No cross-organization catalogue is added.

## Design

The details are in [research.md](research.md) (decisions R1–R19),
[data-model.md](data-model.md) and [contracts/](contracts/).

### Adapter services (`services/adapters`)

- **`nodes/adapter.js`**:
  - The source node gains a `capture` mode. It reads without a publisher, acks at
    once, drops messages matching `exclude_topics`, flags `off_filter`, throttles,
    and stops at `until`.
  - A deployed source copies raw input to the reporter while `capture_until` is set.
  - The reporter sends `capture` events and the new outcome counts.
- **`lib/flow.cjs`**: builds a `capture-<uuid>` tab (source and reporter), and the
  deployed tab's `capture_until`.
- **`manager.cjs`**:
  - Adds `POST /capture`, `/capture/stop` and `/setup-acl`.
  - `/deploy` removes the capture tab in the same flows write and narrows setup
    credentials.
  - `/credential` takes `scope`.
  - Adds `GET /broker-activity`.
  - Tenant `mosquitto.conf` gains `connection_messages true` and stdout logging.
- **`lib/broker-log.cjs`** (new): follows tenant broker logs through the Docker API,
  parses connect, disconnect and refusal lines, and keeps 20 events per username in
  memory.
- **`lib/decoder.cjs`**: `validateResults` accepts the ignored result and counts it.
- **Tests**: `test/*.test.cjs` covers capture mode, the log parser and the
  interpreter's parity cases in quickjs. `integration/verify.cjs` gains capture
  before deploy (tenant and vendor), off-filter labelling, exclusion of another
  adapter's topics, and narrowing at the first deploy.

### Laravel (`apps/api`)

- **`Domain/Onboarding`** (new):
  - `Connectors/{Connector, TenantMqtt, VendorMqtt, Webhook, Poll, SparkplugDirect,
    SparkplugGateway, LabMqtt}` and `config/onboarding.php`.
  - Models: `Models/DeviceSetup`.
  - `Services/SetupService`: create, patch, derive steps from the checklist or the
    native onboarding, discard, copy, another.
  - `Services/CaptureLease`: start, renew and stop through the manager; reads broker
    activity into reasons.
  - `Services/ProfileMatcher`, using the unit catalogue.
  - `Services/DeviceTypeService`: draft from readings, or reuse.
  - `Http/{ConnectorController, SetupController}`.
  - `Console/PruneSetups`.
  - `Admin/OnboardingSummaryController`.
- **`Domain/DeviceAdapters`**:
  - `AdapterService::fields`: nullable `artifact_uuid`, `draft_profile_uuid`,
    `mapping`, `code_origin`, optional topics before the first deploy.
  - `AdapterService::activateMany`.
  - `Services/FieldMappingCompiler` reads the interpreter under
    `devices.contracts_path`.
  - `Models/AdapterRollout`, `Jobs/AdvanceRollout`, and the `rollouts:advance`
    command scheduled every minute.
  - `AdapterDiagnostics::status` gives the sentence by precedence. The checklist
    tolerates no profile.
  - `AdapterController`: `captures`, `capture`, `candidates/activate`, `apply`,
    `copy`. `event` accepts `capture` while a lease holds.
  - `RuntimeController` dispatches `AdvanceRollout` when a stored birth (Discovery
    candidate) appears for a waiting serial.
  - `PollingService::fetch` stores up to 20 records per Fetch now as captured input
    (`source = poll`).
- **`Domain/Devices`**: `DiscoveryCandidate::availableToOnboard()` absorbs the
  node-level filter. `OverviewQuery` adds `setups.unfinished`.
- **`Domain/Assistant`**:
  - `OnboardingTools`, per the [tools contract](contracts/onboarding-tools.md):
    - gains `suggest` (the card kinds) and `explain`;
    - `recommend_path` takes connector keys;
    - `status` and `samples` read setups;
    - `test_decoder` accepts a `mapping` and inline `fixtures`;
    - `propose_adapter` reuse is refused without a match;
    - `next_step` goes.
  - `OnboardingProposals` handles `step` proposals with `card`, `state` and `result`.
    The step routes record the application and add the event message that queues the
    continuing run (R17).
  - Profile drafting accepts the evidence origin `stated` for onboarding
    conversations.
  - Setup conversations: one per setup, through `GET device-setups/{setup}/conversation`.
  - The agent instructions: one card per step, continue after each card, never
    re-ask, and never press a card or run Start collecting.
- **Migrations**: setups; rollouts; the adapter, delivery and proposal columns; the
  conversation column.
- **The activity log** (ADR-028): `ActivityLog::record` records setup started, step
  completed, rollout confirmed, each step's result, and capture started and stopped.
  It never records payloads, pasted samples or secrets.

### Portal (`apps/portal`)

- **`src/sources/`** (new):
  - `Routes.tsx`: `/devices/add`, the setup steps, `/data-sources` and redirects.
  - `StartScreen.tsx`: answers from `GET connectors`, the needs, and the start box.
  - `Journey.tsx`: the shell, `Stepper`, sticky bar, side help and resume.
  - `steps/Connect.tsx` uses the registry. `connectors.tsx` maps keys to the
    existing forms (topic form, vendor form, `WebhookSource`, `PollSource`, native
    kit).
  - `steps/SeeData.tsx`: captures, reasons, paste, Fetch now, off-filter group.
  - `steps/ChooseReadings.tsx`: field tree, readings table, live decode, device type
    choice, Edit as code and Reset.
  - `steps/StartCollecting.tsx`: summary, confirm, rollout progress, success and
    diagnosis.
  - `native/*`: the Sparkplug step bodies, moved from `devices/DeviceOnboarding.tsx`.
  - `Manage.tsx`: the status sentence and sections, reusing `Activity`,
    `connections` and `ActivateDevice`.
  - `DataSources.tsx`: the list.
  - `UnfinishedSetups.tsx` appears on the Devices page.
- **`src/sources/mapping/`**: `runtime.ts` imports the contract's
  `field-mapping.v1.runtime.js`. Also `fieldTree.ts`, `suggest.ts`, `compile.ts` and
  `samples.ts` (hex and text), with Vitest beside them.
- **Navigation and Home**: `App.tsx` gets the **Data sources** entry and badge.
  Home's attention list gains unfinished setups. Add device links go to
  `/devices/add`.
- **Removed**:
  - The `adapters/SetupChecklist.tsx` component (its state model stays on the
    server).
  - The workbench's Device type, Connection, Decode & test and Review & deploy tabs,
    which become journey steps and Manage sections.
- **Assistant**: `adapters/OnboardingAssistant.tsx` becomes the setup conversation.
  - It resolves the conversation from the page's setup or source rather than a
    handoff, and stays open across navigation.
  - It renders `ActionCard`s for every card kind, including embedded password
    fields, serial checkboxes and the rollout progress.
  - It queues messages typed during a run, and keeps profile section reviews.
- **`vite.config.ts`**: `server.fs.allow` includes `contracts/adapters`.

### Packages

- **`packages/ui`**: `ActionCard`, `SuggestedValue`, `SuggestionBar` and `FieldTree` with stories;
  status domains `setupStep` and `rollout`.
- **`packages/api-client`**: connectors, setups, rollouts, captures, matches,
  `activateMany`, apply, copy, the admin summary, and the overview field.

### Admin (`apps/admin`)

- An **Onboarding** page shows the summary per connector in a `DataTable`.

### Simulators, tooling and docs

- `tooling/simulators/vendor_env_sensor.py` gains `--broker`, `--username` and
  `--password` (vendor-broker mode), with `pytest` cases.
- `tooling/simulators/sparkplug_direct_meter.py` (new): a Sparkplug B device that is its
  own edge node, for the direct path. The existing simulator is gateway-only.
- `tooling/verify-onboarding.mjs` drives quickstart A–C through the API.
- Docs:
  - `docs/features/adapters.md`, `devices.md` and `assistant.md`;
  - the onboarding journey diagram;
  - `docs/dev/simulators-and-fixtures.md`;
  - the developer docs pages on adapters;
  - `docs/dev/gotchas.md`, for the capture client id on vendor brokers.

### Delivery

Three pull requests from `main`. None is stacked; each is cut after the previous one
merges ([R16](research.md#r16-delivery)).

1. **Plan** (this branch): spec, plan, research, data model, contracts, quickstart,
   tasks, and ADR-024 with the index entry.
2. **Journey** (`feat/021-data-first-onboarding`), one commit per part:
   1. capture and broker activity;
   2. mapping contract, interpreter and decoder-output change;
   3. API;
   4. kit components and the journey UI;
   5. the assistant in the conversation: action cards, one conversation per setup,
      continuing runs;
   6. the start screen and native paths;
   7. Manage, the status sentence, the count and the rename;
   8. simulators, contracts and docs.
3. **Reuse and measurement** (`feat/021-reuse-and-measurement`): add another, copy,
   the `lab_mqtt` connector, and the admin summary page.

## Project Structure

### Documentation (this feature)

```text
specs/021-data-first-onboarding/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── api.md
│   ├── field-mapping.md
│   ├── connectors.md
│   ├── manager-api.md
│   ├── runtime-events.md
│   ├── onboarding-tools.md
│   └── portal-routes.md
├── checklists/requirements.md
└── tasks.md              # /speckit-tasks
docs/adr/ADR-024-capture-before-deploy.md
```

### Source Code (repository root)

```text
services/adapters/
├── manager.cjs              # /capture, /capture/stop, /broker-activity, scoped credentials, narrowing
├── lib/flow.cjs             # capture tab, capture_until
├── lib/broker-log.cjs       # new: tenant broker connection log
├── lib/decoder.cjs          # ignored result
├── nodes/adapter.js         # capture mode, raw copy, capture events
├── integration/verify.cjs
└── test/*.test.cjs
apps/api/app/Domain/Onboarding/                 # new: connectors, setups, capture lease, device type, matcher
apps/api/app/Domain/DeviceAdapters/             # compiler, rollouts, activateMany, status, captures
apps/api/app/Domain/Devices/                    # one waiting scope, overview field
apps/api/app/Domain/Assistant/                  # suggest, explain, setup binding
apps/api/config/onboarding.php
apps/api/database/migrations/                   # 4 migrations
apps/portal/src/sources/                        # journey, steps, mapping, Manage, list
apps/portal/src/{App.tsx,home,devices,assistant}
apps/admin/src/onboarding/                      # summary page
packages/ui/src/components/{suggested-value,suggestion-bar,field-tree}.tsx (+ stories)
packages/api-client/src/{onboarding,adapters,overview}.ts
contracts/adapters/v1/field-mapping.v1.{schema,fixture,cases,parity}.json, field-mapping.v1.runtime.js
contracts/adapters/v1/{runtime-event,decoder-output}.v1.*   # extended
tooling/simulators/vendor_env_sensor.py, tooling/verify-onboarding.mjs
docs/features/{adapters,devices,assistant}.md, docs/dev/{simulators-and-fixtures,gotchas}.md, apps/docs/…
```

**Structure Decision**:

- Setups and connectors are the onboarding job across native and adapter paths, so
  they get their own `Onboarding` domain.
- Adapter-specific pieces stay in `DeviceAdapters`: the compiler, rollouts and batch
  activation.
- The portal's journey lives in `src/sources/` and absorbs the adapter workbench and
  the native wizard. The old directories keep only the components that Manage and
  Discovery reuse.

## Complexity Tracking

| Exception | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| A runtime tab that runs without an activated revision (capture flow) | See data must show MQTT input before any decoder exists (FR-020, SC-004) | A pass-through revision needs a profile, publishes births and creates candidates; capturing in adapter-manager puts long-lived vendor connections in the process holding the Docker socket (ADR-024) |
| Wider publish rights for setup credentials on the tenant broker | Showing what the firmware sends, and suggesting the filter, instead of asking a topic question newcomers cannot answer | Asking for filters first keeps today's main stall point; the rights are tenant-local, exclude the platform's `iot-os/` topics and other deployed adapters' filters (kept current on every deploy), and are narrowed at the first deploy |
| Adapter-manager reads tenant broker logs | Rejected credentials are the most common first failure, and only the broker sees them (FR-022) | A Mosquitto plugin means compiled code in every tenant image; `$SYS` has no per-client failures |
| Start collecting tests twice (draft check, then the bound revision) | Fail before publishing an immutable device type, and still deploy only the exact tested revision | Publishing first leaves unused published profiles on failure; binding by hash at deploy changes deploy semantics |
