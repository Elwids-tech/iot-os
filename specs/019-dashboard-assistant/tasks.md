# Tasks: Dashboard Assistant

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: part of the feature. The constitution requires tenant isolation tests (III) and
a shared fixture for rules implemented twice (IV), and SC-002, SC-003, SC-006 and SC-007
are proven by tests. Write each story's tests with the story and see them fail first.

**Delivery**: Phases 1 and 2 are the **Dashboard foundations** pull request; Phases 3 to 8
are the **Dashboard assistant** pull request. Each is based on `main` and opened after the
one before it merges, never stacked. The documents pull request (this folder) comes
first.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: the user story the task serves (US1 to US4)
- Paths are from the repository root: `apps/api`, `apps/portal`, `packages/api-client`,
  `contracts/`

---

## Phase 1: Setup (shared fixture)

**Purpose**: pin today's **Add panel** rules before porting them.

- [ ] T001 Create contracts/dashboards/v1/panel-suggestions.fixture.json per [the fixture contract](contracts/panel-suggestions-fixture.md): `version: 1`, `palette` `["#3987e5","#d95926","#199e70","#c98500","#d55181","#9085e9"]`, `neutral` `{"label":"Current","color":"#64748b"}`, `tones` with a fixed hex for each of `good`, `info`, `warning`, `critical` (matching the light theme's semantic tone colours), and the required `suggestions` and `layouts` cases (every parameter kind; one case per `HINTS` key; same unit, mixed units, five counters, mixed counters and non-counters, all writable, mixed writable; an empty dashboard, a half-full row, the bottom placement). Take the expected values from the output of the current `suggestPanels`, `incompatibility` and `sourceFor` in apps/portal/src/dashboards/suggest.ts and `appendLayout` in apps/portal/src/dashboards/model.ts, so the fixture records today's behaviour, then review each case by hand. `claims` stays an empty list until T054
- [ ] T002 Make apps/portal/src/dashboards/suggest.test.ts read the fixture (a relative JSON import, as apps/portal/src/automation/Automation.tsx imports `contracts/rules/v2/workflow.fixture.json`) and assert per case the whole ranked result with reasons, every panel type's incompatibility reason or null, each source's colour and base band, and each `layouts` case through `appendLayout`; `pnpm --filter @iot-os/portal test` passes with suggest.ts unchanged

---

## Phase 2: Foundational, dashboard foundations (blocks everything after it)

**Purpose**: validation without saving, a reusable save action, revision origin, the server
port of the suggestion rules, a read-only grid and the ticket draft. Useful on its own,
and spec 004's dashboard drafts reuse it.

- [ ] T003 Add `validateDocument(array $document, Organization $organization, bool $updating): array` to apps/api/app/Domain/Dashboards/Services/DashboardDefinition.php; make `validate(Request, …)` delegate to it and the restore path in apps/api/app/Domain/Dashboards/Http/Controllers/DashboardController.php call it instead of faking a `Request`. Behaviour is unchanged: apps/api/tests/Feature/Domain/Dashboards/DashboardTest.php and DashboardAccessTest.php pass untouched (spec 004 T075)
- [ ] T004 [P] Migration apps/api/database/migrations/2026_10_27_000000_add_dashboard_revision_origin.php adding `dashboard_revisions.origin`, "nullable string(16)" (`assistant`; `agent` reserved for spec 004), and `origin` on apps/api/app/Domain/Dashboards/Models/DashboardRevision.php
- [ ] T005 Extract apps/api/app/Domain/Dashboards/Actions/SaveDashboard.php from `DashboardController::store`, `update` and `snapshot`: `create(Organization, User, array $document, ?string $origin = null): Dashboard` and `update(Dashboard, User, array $document, int $revision, ?string $origin = null): Dashboard`, with the transaction, revision lock and conflict, and a revision snapshot carrying `origin`. The controller calls it with identical responses, and its revisions list returns `origin` (spec 004 T076; depends on T003, T004)
- [ ] T006 [P] Port apps/api/app/Domain/Dashboards/Services/PanelSuggestions.php from suggest.ts: `suggest(array $candidates): array` (the whole ranked list, reasons word for word), `incompatibility(string $type, array $candidates): ?string`, `source(array $device, array $parameter, int $index, array $thresholds = []): array`, and constants `PALETTE`, `NEUTRAL`, `TONES` and `HINTS` equal to the fixture
- [ ] T007 [P] Port apps/api/app/Domain/Dashboards/Services/DashboardLayout.php: `append(array $layouts, string $id, string $placement): array` from `appendLayout` (`lg` only, 12 columns, width 6, height 6; `available` takes the first free slot, `bottom` goes below everything)
- [ ] T008 [P] Contract test apps/api/tests/Feature/Domain/Dashboards/PanelSuggestionsContractTest.php reading the fixture as apps/api/tests/Feature/Domain/Devices/DeviceExpressionContractTest.php does: every `suggestions` case through `suggest`, `incompatibility` and `source`; every `layouts` case through `DashboardLayout::append`; `PALETTE`, `NEUTRAL` and `TONES` equal to the fixture
- [ ] T009 [P] Tests apps/api/tests/Feature/Domain/Dashboards/SaveDashboardTest.php: `create` makes the person the owner with organization access and revision 1 carrying the given `origin`; `update` with a stale revision conflicts; `validateDocument` refuses another organization's devices, workflows and geofences; the revisions list returns `origin`
- [ ] T010 Document `origin` (`"assistant"` or null) on revisions in contracts/openapi/supplements/dashboards.yaml, run `php artisan contract:export`, and add `origin: "assistant" | "agent" | null` to the revision type in packages/api-client/src/dashboards.ts
- [ ] T011 [P] Map the fixture's four tone hex values to the semantic tone variables in `bandColor` in apps/portal/src/dashboards/model.ts, as `TONE_COLOR` does for profile states, so assistant-made bands follow the skin and theme; apps/portal/src/dashboards/model.test.ts reads `tones` from contracts/dashboards/v1/panel-suggestions.fixture.json, so a fixture change fails the portal test until `bandColor` follows
- [ ] T012 Extract the read-only grid from apps/portal/src/dashboards/DashboardWorkspace.tsx into apps/portal/src/dashboards/DashboardGrid.tsx (react-grid-layout, `ROW_HEIGHT` 48, the breakpoints, `responsiveLayouts`, `PanelBody` per widget) with props `widgets`, `layouts`, `view`, `preview`, optional `group` and optional per-panel `badge`; `preview` is passed to every `PanelBody`, so a Controls panel shows its controls without sending commands. View mode uses it with no visible change; drag, resize and panel menus stay in the workspace
- [ ] T013 [P] Show "Created with the assistant" for `origin === "assistant"` in apps/portal/src/dashboards/VersionHistory.tsx (depends on T010)
- [ ] T014 [P] Prefill apps/portal/src/support/NewTicketPage.tsx from `location.state.draft = {title, body}`; the type still comes from `?type=feature` and draft text never goes in the URL. Add a case to apps/portal/e2e/support.spec.ts
- [ ] T015 [P] Mark T075 and T076 in specs/004-ai-agent-access/tasks.md as delivered by spec 019, linking this file
- [ ] T016 Verify the foundations: `./taskw lint`; `cd apps/api && php artisan test --compact` on PostgreSQL; `pnpm --filter @iot-os/portal lint` and `test`; Playwright apps/portal/e2e/dashboards.spec.ts and support.spec.ts; `php artisan contract:export --check` and `contract:check --base=origin/main`. Rebuild `api` and `portal`, run the migration, and check in the running portal that creating, editing, saving and restoring a dashboard and its **Version history** behave as before

**Checkpoint**: the Dashboard foundations pull request is ready to open from `main`.

---

## Phase 3: Foundational, dashboard assistant scope (blocks all user stories)

**Purpose**: the scope, access, conversation plumbing, agent, tool shell and conversation
component that every story uses.

- [ ] T017 Add apps/api/app/Domain/Assistant/Enums/AssistantScope.php (`profile`, `automation`, `adapter`, `help`, `dashboard`) and use it for the three `in:` rules in apps/api/app/Domain/Assistant/Http/Controllers/AssistantController.php and the scope allowlist in apps/api/app/Domain/Assistant/Jobs/RunAssistant.php
- [ ] T018 [P] Migration apps/api/database/migrations/2026_10_27_010000_add_dashboard_assistant_scope.php: `assistant_conversations.dashboard_id`, "nullable FK to `dashboards`, `nullOnDelete`, indexed", and `assistant_unmet_requests` (`id`; `day` date, UTC; `category` string(32); `count` unsigned integer; timestamps; unique on (`day`, `category`)); a `dashboard()` relation on apps/api/app/Domain/Assistant/Models/AssistantConversation.php
- [ ] T019 Dashboard branch in apps/api/app/Domain/Assistant/Services/AssistantAccess.php: a new target needs `Dashboard.create` and `Device.view`; an existing target needs the view and edit abilities from `DashboardAccess::abilities` and `Device.view` (`DeviceAuthorization::authorize`); creator only, same organization (404 otherwise); `target_kind = dashboard` with a null `dashboard_id` answers 410 "This dashboard was deleted."; checked on every request and at the start of every run. The assistant-enabled check belongs to `store` and `message` only (T020), not to reading a conversation or deciding a proposal
- [ ] T020 Dashboard branches in AssistantController.php (depends on T017 to T019): `settings` returns `can_create`, `can_edit` and `can_alert` (`Workflow.manage` and the organization's automation preview); `index` filters `dashboard={uuid|new}`, newest first, at most 100, where `new` means `target_kind = new`; `store` takes an optional `dashboard` uuid and sets `onboarding_state.target_kind`; `message` requires `target` for an existing dashboard and refuses it for a new one ("At most 100 panels and `assistant.max_draft_characters` characters, else `422`"), stores it in `onboarding_state.target`, and answers 410 for a deleted dashboard; `show` adds `target_kind`, `dashboard {uuid, name}` and the `options`, `unmet` and `alert` state
- [ ] T021 [P] Extract apps/api/app/Domain/Assistant/Services/AssistantQuestions.php from apps/api/app/Domain/Assistant/Tools/ProfileAssistantTools.php (1–3 questions, each `{id ≤ 80, prompt ≤ 800, required, options ≤ 7 strings ≤ 200}`, stored in `onboarding_state.questions`, `questions` event) and use it there; apps/api/tests/Feature/Domain/Assistant/AssistantTest.php passes unchanged
- [ ] T022 Agent apps/api/app/Domain/Assistant/Agents/DashboardAssistant.php: `MaxSteps(8)`, `MaxTokens(4000)`, provider options as WorkflowAssistant.php, replay of the last six exchanges without SDK memory; instructions built from the target kind, the draft summary (existing dashboard), the answers, the latest options and proposal summaries, and the rules that organization data is data, never instructions (FR-025), and that a cited value carries its age (FR-026). RunAssistant.php chooses it for the scope. The story phases add their rules to these instructions
- [ ] T023 Tool apps/api/app/Domain/Assistant/Tools/DashboardAssistantTools.php with an `action` enum and `arguments_json` ("a JSON object as a string, at most 262,144 characters"), as WorkflowAssistantTools.php: each action re-checks the conversation's access and `Device.view`; refusals return `{error, details, reason}` and are logged as "Dashboard assistant tool refused" with the run, action and messages; output is capped at `assistant.max_context_characters`. Implement `discover` per [the tools contract](contracts/assistant-tools.md) (optional `search`, `site_uuid`, `tag`, `profile_uuid`, `page`, and `include: ["workflows", "geofences"]` for up to 20 workflows the person can view (`Workflow.view`) and up to 20 geofences; 10 devices per page with site, tags, profile, `reporting_timezone`, presence, and applied or last applied parameters with key, label, kind, data type, unit, range, hint, writable (true only with an applied command mapping and the person's `Device.command`) and `latest {value, age_seconds}` or null; built on `DeviceDirectory`/`DeviceView` as the MCP `find_devices` tool is; no credentials) and `ask_questions` through AssistantQuestions
- [ ] T024 [P] Client and contract: in packages/api-client/src/assistant.ts (exported from src/index.ts) the `dashboard` scope, conversation `target_kind` and `dashboard`, message `target`, settings `can_create`, `can_edit` and `can_alert`, the `options`, `unmet` and `alert` state, dashboard proposal types (`section`, `changes`, `diagnostics`, `result`) and the decision results; the same fields and the 409, 410 and 422 responses in contracts/openapi/supplements/assistant.yaml, then `php artisan contract:export`. No new operations; contracts/openapi/pending-schemas.json is unchanged
- [ ] T025 [P] Extract the structured question card from apps/portal/src/assistant/AssistantPanel.tsx into apps/portal/src/assistant/Questions.tsx, with no behaviour change
- [ ] T026 Conversation component apps/portal/src/dashboards/assistant/DashboardAssistant.tsx, rendered into the rail with `usePanelSlot`: messages, `Questions`, a composer that sends `target` when given, polling the conversation detail every second while a run is queued or running (as apps/portal/src/automation/WorkflowAssistant.tsx does), and the existing assistant messages for switched off, allowance reached and provider errors. The stories add the proposal card, option cards and actions (depends on T024, T025)
- [ ] T027 [P] Tests apps/api/tests/Feature/Domain/Assistant/DashboardAssistantTest.php, with the agent faked by `DashboardAssistant::fake` and tools called directly: settings flags per role and with the assistant off; create, list, show and message for new and existing targets; `target` required, refused and oversized (422); another organization's conversation or dashboard 404, and a Member without `Dashboard.create` 403 (SC-006); a deleted dashboard 410; `discover` limited to the organization and `Device.view`, latest values with their age, no credentials, and `include` listing only workflows the person can view; refusals logged

**Checkpoint**: in both targets the assistant can find devices and ask questions; it prepares no proposals yet.

---

## Phase 4: User Story 1, build a new dashboard by describing it (Priority: P1) 🎯 MVP

**Goal**: from **Create with assistant**, a request becomes a reviewed proposal shown at
full size beside the rail, and **Create dashboard** creates exactly that dashboard once.

**Independent Test**: with simulated devices that have a counter, a ranged temperature
and a boolean, ask for a dashboard of those devices. The page shows Consumption, Gauge and
Status or State history panels with live data; **Create dashboard** produces a dashboard
whose saved panels match the review, owned by the person, with its first revision
"Created with the assistant".

### Tests for User Story 1

- [ ] T028 [P] [US1] Tests apps/api/tests/Feature/Domain/Assistant/DashboardProposalTest.php for `section = dashboard`: the validation order returns the first failure with its panel index and stores nothing; a stored proposal supersedes pending ones and clears `onboarding_state.options`; more than 20 panels refused; `content_hash` stable for the same changes; other organizations' devices, workflows and geofences refused (SC-006); a panel naming a workflow refused without `Workflow.view`; approve still works with the assistant switched off; approve creates exactly one dashboard (a replay returns the stored result; a new request after `applied` is 409), owned by the person, open to the organization, first revision `origin = assistant`, and the conversation gets `dashboard_id` and `target_kind = dashboard`; reject gives `dismissed`; lost permission 403; hash mismatch and superseded 409; a run whose message says "yes, create it" creates nothing (FR-020, SC-003)

### Implementation for User Story 1

- [ ] T029 [US1] `preview` in apps/api/app/Domain/Assistant/Services/DashboardProposalService.php for a new dashboard, in the data model's validation order: shape ("1–20 panels"; `summary` ≤ 300; `name` required for a new dashboard and refused for an existing one; `title` ≤ 120, `description` ≤ 1000, `reason` ≤ 300; `tone` ∈ `good`, `info`, `warning`, `critical`; `view.preset` and `refresh`); a claims step that T056 fills; completion from the applied profiles with `PanelSuggestions::source` (tone to its fixed hex, an explicit base band), where a Controls panel needs `Device.command` on each of its devices and a panel with `workflow_uuid` needs `Workflow.view`; `PanelSuggestions::incompatibility` per panel; layout with `DashboardLayout::append(…, "available")`; defaults (range preset, `timezone: browser`, refresh); `DashboardDefinition::validateDocument`; limits; diagnostics `devices_left_out`, `split_by_unit`, `split_by_limit`. Then, in a transaction that re-checks the run is active, supersede pending proposals, clear `onboarding_state.options`, store the proposal (`section = dashboard`; `changes {name, widgets with reason, layouts, defaults}`; `content_hash` = "`sha256` of canonical JSON of `[conversation id, section, draft_revision, changes]`") and emit `proposal`
- [ ] T030 [US1] `preview_dashboard` action in apps/api/app/Domain/Assistant/Tools/DashboardAssistantTools.php calling the service and returning `{proposal_id, panels, diagnostics}`, or the first failure with its panel index
- [ ] T031 [US1] `apply` in DashboardProposalService.php for `section = dashboard`: lock the proposal, require `pending` and the matching `content_hash`, re-check `Dashboard.create`, `Device.view` and, for the panels that need them, `Device.command` and `Workflow.view`, re-validate, strip `reason`, call `SaveDashboard::create(…, origin: 'assistant')`, store `result {dashboard_uuid}`, set the conversation's `dashboard_id` and `target_kind = dashboard`, mark `applied` and emit `saved {dashboard_uuid, proposal_id}`; a replay of the `request_id` returns the stored result; `reject` gives `dismissed`. `AssistantController::decide` accepts dashboard proposals (automation stays 422) and delegates (FR-018)
- [ ] T032 [US1] Instructions in DashboardAssistant.php for building a dashboard: find devices with `discover` and name the devices and parameters before proposing; when nothing matches or a real choice is open, ask, framed by what the person wants to know (the value now, the trend, usage per period, a comparison); give a name and a default range; only the review applies a proposal, and the assistant never saves, shares or changes existing panels (FR-020, FR-021)
- [ ] T033 [US1] Route `organizations/:organizationUuid/dashboards/assistant/:conversation?` in apps/portal/src/App.tsx (a static segment, so it wins over `dashboards/:dashboardUuid?`; it does not call `rememberDashboardPlace`, and apps/portal/src/help/context.ts maps it to `dashboards`, with a case in context.test.ts) for apps/portal/src/dashboards/assistant/AssistantDashboardPage.tsx. The page creates or opens the conversation, takes a waiting `{to: "dashboard"}` hand-off, and renders DashboardAssistant into the rail. Its main area shows example requests before the first proposal; after it, a header (name, default time range, "Open to the organization", **Create dashboard**) and `DashboardGrid` of the latest pending proposal with live data and `preview` set, with each panel's details from a new apps/portal/src/dashboards/assistant/ProposedPanelDetails.tsx (type, title, devices, parameters, units, settings, bands as ranges, reason and diagnostics; FR-016, FR-017). **Create dashboard** sends the decision with `content_hash` and a `request_id`, opens the new dashboard, and shows 403, 409, 410 and 422 errors with the panel named
- [ ] T034 [US1] Proposal card in apps/portal/src/dashboards/assistant/DashboardAssistant.tsx: summary, panel count, pending, superseded or applied state, and **Review dashboard**, which closes the sheet below 1280 px so the page shows the proposal
- [ ] T035 [US1] Entry points: **Create with assistant** beside **New dashboard** in apps/portal/src/dashboards/LibraryPage.tsx when `capabilities.dashboards.create` and the assistant is enabled; a Dashboards page action "Build a dashboard with the assistant" in apps/portal/src/assistant/suggestions.ts (case in suggestions.test.ts); and a hand-off kind `{to: "dashboard", text, id}` in apps/portal/src/panel/context.tsx that opens the assistant route with the request waiting; apps/portal/src/help/HelpPanel.tsx treats a waiting dashboard hand-off like the automation one, so Ask shows the opening state until the page registers its slot
- [ ] T036 [P] [US1] Playwright apps/portal/e2e/dashboard-assistant.spec.ts with a mocked API: entry points shown or hidden by permission and assistant state (SC-007); the proposal at full size beside the rail, replaced by the next; **Create dashboard** opens the new dashboard; at 390 px the sheet's **Review dashboard** shows the proposal; clicking a control on a proposed Controls panel sends no command request

**Checkpoint**: User Story 1 works on its own; run its independent test.

---

## Phase 5: User Story 2, brainstorm how to show the data (Priority: P1)

**Goal**: up to three options per set of parameters, ranked as **Add panel** ranks them,
each with a reason and a preview; changes in words produce a new proposal; limits become
bands with an offer to set up an alert.

**Independent Test**: for devices covering every parameter kind, ask for options. Every
offered type is one **Add panel** suggests for the same parameters, the first is its
top-ranked type, and none is one the **Visualization** picker would disable.

### Tests for User Story 2

- [ ] T037 [P] [US2] Tests in apps/api/tests/Feature/Domain/Assistant/DashboardAssistantTest.php: `options` returns `PanelSuggestions` output for 1–100 pairs with the notes `split_by_unit`, `split_by_limit` and `time_zones_differ`; `offer_options` accepts 1–3 options in rank order, refuses a type outside the ranking, out of order or rejected by the incompatibility rules, replaces `onboarding_state.options` and emits `options`; `preview_dashboard` refuses a gauge without a range, a mixed-unit time series, and a Controls panel without `Device.command` (for which `discover` reports `writable: false`); thresholds store the tone hex with an explicit base band; a Consumption panel whose counters report in different zones stores `time_zones_differ`; `offer_alert` stores `{text}` and emits `alert`; `can_alert` is false without `Workflow.manage` (SC-002)

### Implementation for User Story 2

- [ ] T038 [US2] `options` action in DashboardAssistantTools.php: 1–100 `{device_uuid, parameter_uuid}` pairs resolved to applied parameters; returns `options` (type, reason, rank), `incompatible` (type, reason) and `notes` (`time_zones_differ` from the devices' reporting zones, `split_by_unit`, `split_by_limit`)
- [ ] T039 [US2] `offer_options` action per [the tools contract](contracts/assistant-tools.md): 1–3 options for the same sources, each type in the `options` ranking and in rank order (two may share a type with different settings), each passed through the claims step, completion and `validateDocument` as a one-panel document; replaces `onboarding_state.options` and emits `options`; returns the first failure with its option index
- [ ] T040 [US2] `time_zones_differ` diagnostic in `preview` in apps/api/app/Domain/Assistant/Services/DashboardProposalService.php for Consumption panels whose devices report in different zones (R12, FR-024), stored in `diagnostics` and shown under the panel in the review (also US4 scenario 3)
- [ ] T041 [US2] `offer_alert` action: `text` ≤ 1000 characters, stored as `onboarding_state.alert = {text}`, emits `alert`; RunAssistant.php clears `onboarding_state.alert` and `unmet` when a run starts
- [ ] T042 [US2] Instructions in DashboardAssistant.php for brainstorming: call `options` before offering, then `offer_options` with at most three, best first, using **Add panel**'s reasons (FR-007); counters as Consumption with a bar size or calendar period, Status for the running total, and a counter time series described as the meter reading (FR-008); separate panels, with the reason, for mixed units or more than four counters (FR-009); a change in words produces a new proposal (FR-011); limits become threshold bands, with a note that bands only colour the panel and a call to `offer_alert` (FR-012)
- [ ] T043 [US2] Option cards in apps/portal/src/dashboards/assistant/DashboardAssistant.tsx from `onboarding_state.options`: rank, title, reason, a small `PanelBody` with `preview` set, over the proposal's time range (missing data shown as missing, never zeros), and **Use this option**, which sends "Use option N: <title>" as the person's message
- [ ] T044 [P] [US2] `bandRange` in apps/portal/src/dashboards/model.ts wording each band from its inclusive lower bound ("80 °C and above", "60 to 80 °C", and the base band "below 60 °C"), used by apps/portal/src/dashboards/assistant/ProposedPanelDetails.tsx for the band list in every review; cases in model.test.ts
- [ ] T045 [US2] **Set up an alert** in DashboardAssistant.tsx when `onboarding_state.alert` is set and `can_alert` is true: `startTask("auto", {to: "automation", text, id})` and navigation to `automation/new` with the id in state, as the existing automation hand-off (R14)
- [ ] T046 [P] [US2] Playwright cases in apps/portal/e2e/dashboard-assistant.spec.ts: option cards with previews and **Use this option**; a band listed as "80 °C and above"; **Set up an alert** opens a new automation with the request waiting, and is absent without `can_alert`

**Checkpoint**: User Stories 1 and 2 work; run US2's independent test.

---

## Phase 6: User Story 3, add panels to a dashboard being edited (Priority: P2)

**Goal**: in edit mode, proposed panels appear marked below the draft; **Add to
dashboard** adds them to the local, undoable draft; nothing is saved until **Save
dashboard**.

**Independent Test**: open a dashboard in edit mode, move a panel without saving, ask for
two panels and apply them. The moved panel stays moved, the two panels appear below,
**Undo** removes them, and the server's dashboard is unchanged until **Save dashboard**.

### Tests for User Story 3

- [ ] T047 [P] [US3] Tests in apps/api/tests/Feature/Domain/Assistant/DashboardProposalTest.php for `section = dashboard_panels`: `name` refused; `draft_revision` and `before` stored from the target; the dashboard's panel count plus the proposal's capped at 100; approve re-validates and returns `{widgets}` with fresh ids, leaves the dashboard and its revision unchanged and marks `applied`; a deleted device gives 422 naming the panel; lost edit ability or `Device.view` gives 403; a Controls panel without `Device.command` and a panel naming a workflow without `Workflow.view` are refused; a deleted dashboard gives 410; a person who can only view the dashboard cannot open its conversation (403); a new-dashboard conversation that created its dashboard continues as that dashboard's conversation (FR-004)

### Implementation for User Story 3

- [ ] T048 [US3] `preview` in DashboardProposalService.php for an existing dashboard: section `dashboard_panels`, `draft_revision` and `before` from `onboarding_state.target`, no layout (the portal places the panels), and "the target's panel count plus the proposal's stays at most 100"
- [ ] T049 [US3] `apply` in DashboardProposalService.php for `dashboard_panels`: lock, `pending` and hash checks, re-check the edit ability, `Device.view` and, for the panels that need them, `Device.command` and `Workflow.view`, re-validate the widgets with `validateDocument` for the organization, give fresh ids, strip `reason`, store `result {widget_ids}`, mark `applied` and return `{widgets}`; nothing is saved
- [ ] T050 [US3] Instructions in DashboardAssistant.php for an existing dashboard: the draft summary lists its panels, unsaved ones included; propose additions only; no duplicate of a panel that shows the same data the same way unless asked; near 100 panels, a proposal that fits or an explanation
- [ ] T051 [US3] Edit mode in apps/portal/src/dashboards/DashboardWorkspace.tsx: when the person can edit, register the slot with this dashboard's latest conversation (or a new one) and send the draft summary as `target` with each message (`{revision, panels: [{id, type, title, sources: [{device_uuid, parameter_uuid}]}]}`); show the latest pending `dashboard_panels` proposal's panels below the draft's, badged **Proposed**, drawn with `preview` set, each with ProposedPanelDetails, not draggable and excluded from save; a rejection or a newer proposal removes them
- [ ] T052 [US3] **Add to dashboard** in DashboardWorkspace.tsx: send the decision, snapshot the draft, add the returned widgets with `appendLayout(…, "bottom")` keeping unsaved edits, and show a success toast with **Undo** that restores the snapshot (R8); a 422 toast names the panel and leaves the draft unchanged; saving follows the existing revision conflict handling (FR-019)
- [ ] T053 [P] [US3] Playwright cases in apps/portal/e2e/dashboard-assistant.spec.ts: no assistant entry on a view-only dashboard; proposed panels marked **Proposed** below a moved panel; **Add to dashboard** keeps the move; a proposed panel shows its reason and a band as a range; **Undo** removes the added panels; no save request until **Save dashboard**

**Checkpoint**: User Stories 1 to 3 work; run US3's independent test.

---

## Phase 7: User Story 4, say what cannot be built yet (Priority: P2)

**Goal**: requests outside the panel model get an explanation, the nearest truthful
alternative, a category count and **Ask the team for this panel**; no title claims what
the panel does not compute.

**Independent Test**: in an evaluation set of at least 20 requests, at least five outside
the panel model, each of those gets an explanation and, where one exists, a supported
alternative; no proposal has a title or reason claiming a total, average, ranking or
formula.

### Tests for User Story 4

- [ ] T054 [P] [US4] Add `claims` cases to contracts/dashboards/v1/panel-suggestions.fixture.json for each R11 rule, refused and allowed, and assert them through `DashboardClaims` in apps/api/tests/Feature/Domain/Dashboards/PanelSuggestionsContractTest.php (PHP only)
- [ ] T055 [P] [US4] Tests in apps/api/tests/Feature/Domain/Assistant/DashboardAssistantTest.php: `preview_dashboard` and `offer_options` refuse a claim with the panel index and rule; `record_unmet` validates the category, counts once per run and category without losing concurrent increments, stores `onboarding_state.unmet` and emits `unmet`; `assistant_unmet_requests` holds no organization, user or text; operations metrics include `iot_assistant_unmet_requests{category}` summed over 30 days; rows older than 400 days are pruned

### Implementation for User Story 4

- [ ] T056 [US4] apps/api/app/Domain/Assistant/Services/DashboardClaims.php with English word lists in apps/api/config/assistant.php (`dashboard.claims`) for the four R11 rules (aggregation or ranking words on panels with sources from more than one device; average, mean, total, sum or trend words on Status, Gauge, Table and Controls; usage words on a counter time series; calculation words on any panel), checking title, description and reason; fill the claims step of `preview` and `offer_options` with it
- [ ] T057 [P] [US4] apps/api/app/Domain/Assistant/Models/AssistantUnmetRequest.php and apps/api/app/Domain/Assistant/Services/UnmetRequests.php: `record(string $category)` with an atomic "`insert … on conflict do update`" on (`day`, `category`) for the UTC day
- [ ] T058 [US4] `record_unmet` action in DashboardAssistantTools.php: `category` ∈ `cross_device_total`, `grouping`, `ranking`, `formula`, `custom_visualization`, `sharing_or_kiosk`, `other`; `title` ≤ 150; `body` ≤ 4000; `alternative` ≤ 300, optional; counts once per run, stores `onboarding_state.unmet` and emits `unmet`
- [ ] T059 [US4] Daily pruning of `assistant_unmet_requests` rows older than 400 days in apps/api/routes/console.php, and `iot_assistant_unmet_requests{category}` over the last 30 days in apps/api/app/Support/Operations.php (FR-027)
- [ ] T060 [US4] Instructions in DashboardAssistant.php for out-of-model requests: the categories with examples; the nearest truthful alternative (a Table of each device's current reading, up to four meters per Consumption panel); never a panel that looks like the requested total; and `record_unmet` with a ticket draft naming the request, devices, parameters and alternative (FR-022, FR-023, FR-028)
- [ ] T061 [US4] **Ask the team for this panel** in apps/portal/src/dashboards/assistant/DashboardAssistant.tsx when `onboarding_state.unmet` is set: navigate to `support/new?type=feature` with `state.draft = {title, body}`, the body including the alternative offered
- [ ] T062 [P] [US4] Playwright case in apps/portal/e2e/dashboard-assistant.spec.ts: **Ask the team for this panel** opens a Feature request with title and description filled and editable, and nothing is filed until it is submitted

**Checkpoint**: all four stories work; run US4's independent test with the evaluation command (T063).

---

## Phase 8: Polish and cross-cutting concerns

- [ ] T063 [P] Evaluation: dataset apps/api/resources/assistant/dashboard-evaluation.json (at least 20 requests, at least five outside the panel model, each with its expected outcome or unmet category) and command apps/api/app/Domain/Assistant/Console/EvaluateDashboardAssistant.php (`assistant:evaluate-dashboards {--organization=} {--user=}`), registered in apps/api/bootstrap/app.php; it reports per request the proposal or unmet category, replies used, claims refused and cost, and never runs in CI
- [ ] T064 [P] A panel for `iot_assistant_unmet_requests` in deploy/release/monitoring/grafana/dashboards/platform.json, and the metric in docs/ops/monitoring.md
- [ ] T065 [P] Documentation: docs/features/assistant.md (the dashboard scope, its tools and limits); docs/features/dashboards.md (entry points, proposals, revision origin); the help guide apps/api/resources/help/dashboards.md with `revision` 2, checked by `php artisan help:validate`; docs/roadmap.md (dashboard assistant done, server-side panel queries next); anything surprising in docs/dev/gotchas.md (FR-031)
- [ ] T066 Run every check: `./taskw lint`; `cd apps/api && php artisan test --compact` on PostgreSQL; `pnpm --filter @iot-os/portal lint` and `test`; Playwright `dashboard-assistant`, `dashboards`, `help` and `support` specs; `php artisan contract:export --check` and `contract:check --base=origin/main`
- [ ] T067 Rebuild `api`, `assistant-worker` and `portal` with the command in docs/dev/local-setup.md, run the migrations, and walk scenarios 1 to 7 of specs/019-dashboard-assistant/quickstart.md section C in the running portal with a real provider, keeping any unsaved browser edits
- [ ] T068 Run quickstart section D (`assistant:evaluate-dashboards`) for each configured model; record replies, unmet categories and cost per request in the pull request, and the measured cost per model with the per-reply limit it needs in docs/features/assistant.md (SC-004, SC-005, R16)

---

## Dependencies and execution order

### Phases

- **Phase 1** (Setup): no dependencies.
- **Phase 2** (dashboard foundations): needs Phase 1 for T006 to T008. Ends with the
  foundations pull request; Phase 3 starts from `main` after it merges.
- **Phase 3** (assistant scope): needs Phase 2 merged. Blocks every story.
- **Phase 4** (US1): needs Phase 3. Creates `DashboardProposalService`, the assistant page
  and the proposal card that later stories extend.
- **Phases 5 to 7** (US2, US3, US4): each needs US1's `preview` and `apply`. They do not
  need each other, with one exception: the claims step that `offer_options` (T039) runs is
  filled by T056 in US4.
- **Phase 8**: needs the stories. T068 needs T063; the cost table in T068 completes T065.

### Within each story

Tests first and failing, then service, then tool action, then instructions, then portal,
then Playwright.

### Shared files to sequence

- AssistantController.php: T017, then T020, then T031.
- RunAssistant.php: T017, then T022, then T041.
- DashboardProposalService.php: T029, T031, T040, T048, T049, T056 in that order.
- DashboardAssistantTools.php: T023, T030, T038, T039, T041, T058.
- DashboardAssistant.tsx: T026, T034, T043, T045, T061.
- DashboardAssistant.php instructions: T022, T032, T042, T050, T060.

### Parallel opportunities

- Phase 2: T004, T006, T007, T008 and T009 together after T003; then T011, T013, T014 and
  T015 beside T012.
- Phase 3: T018, T021, T024 and T025 together after T017; T027 beside T022 and T023.
- Each story: its test task beside its first implementation task; its Playwright task
  once the portal work exists.
- After US1: US2's portal tasks (T043 to T045), US3's portal tasks (T051, T052) and US4's
  server tasks (T056 to T059) touch different files and can run side by side, keeping
  the shared-file order above.

## Parallel example: Phase 2

```text
Task: "Migration add_dashboard_revision_origin (T004)"
Task: "Port PanelSuggestions.php (T006)"
Task: "Port DashboardLayout.php (T007)"
Task: "PanelSuggestionsContractTest.php (T008)"
Task: "SaveDashboardTest.php (T009)"
```

## Parallel example: User Story 1

```text
Task: "DashboardProposalTest.php, section = dashboard (T028)"
Task: "DashboardProposalService::preview (T029)"
# after the page exists
Task: "Playwright dashboard-assistant.spec.ts (T036)"
```

## Implementation strategy

### MVP

Phases 1 to 4: the foundations, the scope, and User Story 1. Stop and run US1's
independent test in the rebuilt stack before going further. The MVP is a checkpoint, not
a release: the assistant pull request ships all four stories together, because US2 and
US4 carry the truthfulness rules (options from the shared rules, the claims lint, unmet
requests) that keep dashboards from misleading.

### Incremental delivery

1. Documents pull request (this folder).
2. Dashboard foundations pull request: Phases 1 and 2, verified by T016.
3. Dashboard assistant pull request: Phases 3 to 8, each story checked at its checkpoint,
   then T066 to T068 before review.

## Notes

- A pull request is opened only when the user asks; commits only when asked.
- Spec 004 PR 7 reuses `validateDocument`, `SaveDashboard`, `origin` and `DashboardGrid`;
  keep their signatures as written here.
- Keep host addresses, organization names and credentials out of the fixture, dataset and
  tests (`example.com`, `.test` hosts only).
