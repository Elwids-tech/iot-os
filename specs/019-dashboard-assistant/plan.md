# Implementation Plan: Dashboard Assistant

**Branch**: `spec/019-dashboard-assistant` | **Date**: 2026-10-26 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/019-dashboard-assistant/spec.md`

## Summary

A fifth assistant scope, `dashboard`, follows the automation assistant's shape: one tool
class with an action enum, a server-validated immutable proposal, and a page that owns
the conversation through the workspace panel's slot and draws the proposal itself.

The server learns the **Add panel** rules: `PanelSuggestions` ports the ranking from
`suggest.ts`, pinned to the portal by a shared golden fixture in `contracts/dashboards/v1`.
Proposals pass a claims lint, are completed from the applied profiles, and are
validated by `DashboardDefinition::validateDocument`, the array entry point spec 004
planned. New dashboards are created through an extracted `SaveDashboard` action with
`origin = assistant` on their first revision. Panels for an existing dashboard are
re-validated by the server and added to the editor's local draft by the portal.

The portal gains an assistant route for new dashboards and an edit-mode slot for
existing ones, both drawing proposals with a `DashboardGrid` extracted from
`DashboardWorkspace`. Unmet requests are counted by category for operations, and offer
a pre-filled Feature request ticket. Limits become threshold bands with an offer to hand
the alert to the automation assistant.

## Technical Context

**Language/Version**: PHP 8.4 / Laravel 13; TypeScript, React 19

**Primary Dependencies**: `laravel/ai` 1.2 (agents, tools, fakes), TanStack Query,
react-grid-layout (existing), `@iot-os/ui` (`Panel`, `Badge`, `Alert`, `Button`,
`StatusMark`, sonner helpers), `packages/charts` through the existing panels

**Storage**: PostgreSQL 17 with TimescaleDB: one new table, two new nullable columns

**Testing**: PHPUnit on PostgreSQL (CI; locally a throwaway TimescaleDB), agents faked
with `DashboardAssistant::fake` and tools called directly; Vitest for the parity
fixture and pure portal logic; Playwright with a mocked API; a manual evaluation
command against a real provider (research R17)

**Target Platform**: `api`, `assistant-worker` and `portal` in the Compose stack and the
single-node release

**Project Type**: web application (Laravel API and worker, React portal)

**Performance Goals**: options and previews feel immediate (previews use the panels'
existing data hooks; no model call); a proposal of up to six panels within three
replies for 90% of in-model requests (SC-005)

**Constraints**: within the per-reply spend limit for the configured model (R16); tool
output ≤ `assistant.max_context_characters`; draft summary ≤
`assistant.max_draft_characters`; ≤ 20 panels per proposal; ≤ 100 panels per dashboard;
works with the assistant disabled (the default)

**Scale/Scope**: 2 migrations, 1 enum, 6 services or actions, 1 agent, 1 tool class, 1
console command, about 6 portal components or routes, 1 shared fixture

## Constitution Check

*Checked before research and again after the design below.*

| Principle | Status |
| --- | --- |
| I. Laravel owns intent | Pass. The agent, tools, validation and creation live in Laravel; the portal talks only to Laravel; the runtime is untouched. |
| II. Immutable versions | Pass. Proposals are immutable; dashboards keep revision snapshots; nothing activates. |
| III. Tenant isolation | Pass with tests. Conversations, proposals and decisions resolve the organization from the route and check membership first; tools and apply re-check `Device.view` and dashboard abilities; `validateDocument` refuses other organizations' devices, workflows and geofences. Tests prove another organization's conversations, proposals and devices are unreachable (SC-006). |
| IV. Contracts first | Pass. The suggestion rules shared by PHP and TypeScript get a golden fixture in `contracts/dashboards/v1` read by both test suites (ADR-015). API changes extend pending operations without adding new ones; supplements document the new errors; `packages/api-client` changes in the same pull request. No user uuid is exposed. |
| V. AI proposes, people approve | Pass. No tool writes a dashboard, ticket or automation; only the review's **Create dashboard** and **Add to dashboard** apply, each re-checking permissions; text in the conversation approves nothing. Dashboards work with the assistant off. |
| VI. Show uncertainty | Pass. Previews show missing data as missing; `discover` gives each latest value its age; time zone differences are server notes, not model prose. |
| VII. Durable messaging | Pass. No messages are emitted; decisions are idempotent by `request_id` and proposal status; unmet counts use an atomic upsert. |
| VIII. One design system | Pass. Kit `Panel`, `Badge`, `Alert`, `Button` and the sonner helpers; the extracted `DashboardGrid` is a portal component, not a kit one; no new kit component, so no new story. `check-ui` must pass. |
| IX. Verified where it runs | Pass. PostgreSQL CI; rebuilt `api`, `assistant-worker` and `portal`; quickstart C in the running portal with a real provider; evaluation results recorded in the pull request. |

No ADR is needed: AI orchestration in Laravel is ADR-002, the parity fixture follows
ADR-015, and charts are unchanged (ADR-012).

## Design

### Dashboards domain (shared with spec 004)

- `DashboardDefinition::validateDocument(array, Organization, bool $updating): array`;
  `validate(Request, …)` delegates with unchanged behaviour (spec 004 T075).
- `Actions/SaveDashboard`: `create(Organization, User, array $document, ?string $origin)`
  and `update(Dashboard, User, array $document, int $revision, ?string $origin)`, moved
  out of `DashboardController::store`/`update`/`snapshot` with identical responses (spec
  004 T076). The controller calls it.
- Migration: `dashboard_revisions.origin` (nullable string 16); the revisions list and
  **Version history** show it.
- `Services/PanelSuggestions`: `suggest(array $candidates)`, `incompatibility(string $type, array $candidates)`,
  `source(array $device, array $parameter, int $index, array $thresholds = [])`; plus
  `TONES` and the palette, all checked against the shared fixture.
- `Services/DashboardLayout::append(array $layouts, string $id, string $placement)`,
  the port of `appendLayout` (`lg`, 12 columns, half width, 6 rows).

### Assistant domain

- `Enums/AssistantScope` (`profile`, `automation`, `adapter`, `help`, `dashboard`) used
  by the three `in:` rules in `AssistantController` and the run allowlist in
  `RunAssistant`.
- Migration: `assistant_conversations.dashboard_id` (nullable FK, `nullOnDelete`) and
  `assistant_unmet_requests`.
- `AssistantAccess`: a `dashboard` branch (new: `Dashboard.create`; existing: edit
  ability; both: `Device.view`; existing with a null `dashboard_id`: 410).
- `AssistantController`: `settings`, `index`, `store` and `message` branches for the
  scope (target validation: existing dashboard requires `target`, new refuses it);
  `decide` accepts dashboard proposals and delegates to `DashboardProposalService`.
- `Agents/DashboardAssistant`: `MaxSteps(8)`, `MaxTokens(4000)`, provider options as
  `WorkflowAssistant`; instructions cover the target, the answers, the latest proposal
  summary, the truthfulness rules and the out-of-model categories; replays the last six
  exchanges.
- `Tools/DashboardAssistantTools`: `discover`, `options`, `offer_options`,
  `ask_questions`, `preview_dashboard`, `record_unmet`, `offer_alert`
  ([tools contract](contracts/assistant-tools.md)).
  `discover` uses `DeviceDirectory`/`DeviceView` as the MCP `find_devices` tool does.
- `Services/AssistantQuestions`: the `ask_questions` validation and storage extracted
  from `ProfileAssistantTools`, used by both tool classes.
- `Services/DashboardProposalService`: `preview` (validation order in the data model:
  shape, `DashboardClaims`, completion, incompatibility, `validateDocument`, limits;
  supersede and store in a transaction that re-checks the run) and `apply` (create or
  re-validate, idempotent, as the API contract describes).
- `Services/DashboardClaims`: the R11 lint with word lists in `config/assistant.php`
  (`dashboard.claims`).
- `Services/UnmetRequests::record(string $category)` with the atomic upsert; pruning in
  `routes/console.php`; `Operations` emits `iot_assistant_unmet_requests{category}` for
  the last 30 days.
- `Console/EvaluateDashboardAssistant` (`assistant:evaluate-dashboards`) with the
  dataset in `resources/assistant/dashboard-evaluation.json`.
- `RunAssistant`: chooses `DashboardAssistant` for the scope (no SDK memory, as
  automation).

### Portal

- `dashboards/DashboardGrid.tsx`: the read-only grid extracted from `DashboardWorkspace`
  (widgets, layouts, view, `preview`, `group`, optional per-panel `badge`); the workspace's view mode
  uses it.
- `dashboards/assistant/DashboardAssistant.tsx`: the conversation body (messages,
  `Questions`, option cards with small previews, proposal card, unmet and alert actions),
  rendered into the rail with `usePanelSlot`; polls the conversation detail every second
  while a run is active, as `WorkflowAssistant` does.
- `dashboards/assistant/AssistantDashboardPage.tsx` at `dashboards/assistant/:conversation?`:
  the new-dashboard page. Header with name, time range, access and **Create
  dashboard**; `DashboardGrid` of the latest proposal; per-panel reason and diagnostics;
  example requests before the first proposal.
- `dashboards/assistant/ProposedPanelDetails.tsx`: a proposed panel's type, title, devices,
  parameters, units, settings, bands as ranges, reason and diagnostics; used by the
  assistant page and the edit-mode proposal. Proposals are drawn with `preview` set, so
  Controls never send commands.
- `DashboardWorkspace`: in edit mode registers the slot with the existing-dashboard
  conversation and sends the draft summary with each message; renders the latest
  pending proposal's panels after the draft's, badged **Proposed** and excluded from
  save; **Add to dashboard** calls the decision, adds the returned widgets with
  `appendLayout(…, "bottom")`, and offers **Undo** in the toast.
- Library: **Create with assistant** beside **New dashboard** when `capabilities.dashboards.create`
  and the assistant is enabled.
- `assistant/suggestions.ts`: a `dashboard` action on the Dashboards page ("Build a
  dashboard with the assistant"); `panel/context.tsx`: hand-off `{to: "dashboard", text, id}`.
- `assistant/Questions.tsx`: the structured-question card extracted from `AssistantPanel`.
- `support/NewTicketPage.tsx`: accepts `location.state.draft = {title, body}`.
- `dashboards/model.ts`: `bandColor` maps the tone hex values to semantic variables;
  `bandRange()` words a band as a range for the review.
- `packages/api-client`: dashboard assistant calls and types.

### Documentation

`docs/features/assistant.md` (the scope, tools, limits, measured cost per model),
`docs/features/dashboards.md` (entry points, proposals, revision origin), the help guide
`apps/api/resources/help/dashboards.md` with a bumped revision, `docs/roadmap.md` (the
item moves to done; server-side panel queries stay next), `docs/ops/monitoring.md` for
the new metric, and a panel on the Grafana platform dashboard.

## Project Structure

### Documentation (this feature)

```text
specs/019-dashboard-assistant/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── assistant-api.md
│   ├── assistant-tools.md
│   └── panel-suggestions-fixture.md
├── checklists/requirements.md
└── tasks.md            # /speckit-tasks
```

### Source Code (repository root)

```text
contracts/dashboards/v1/panel-suggestions.fixture.json                          # new
apps/api/
├── config/assistant.php
├── database/migrations/2026_10_27_000000_add_dashboard_revision_origin.php      # new
├── database/migrations/2026_10_27_010000_add_dashboard_assistant_scope.php      # new
├── app/Domain/Dashboards/
│   ├── Actions/SaveDashboard.php                                                # new
│   ├── Services/DashboardDefinition.php
│   ├── Services/PanelSuggestions.php, Services/DashboardLayout.php              # new
│   ├── Models/DashboardRevision.php
│   └── Http/Controllers/DashboardController.php
├── app/Domain/Assistant/
│   ├── Enums/AssistantScope.php                                                 # new
│   ├── Agents/DashboardAssistant.php                                            # new
│   ├── Tools/DashboardAssistantTools.php                                        # new
│   ├── Tools/ProfileAssistantTools.php
│   ├── Services/DashboardProposalService.php, DashboardClaims.php,
│   │   UnmetRequests.php, AssistantQuestions.php                                # new
│   ├── Services/AssistantAccess.php
│   ├── Models/AssistantConversation.php, Models/AssistantUnmetRequest.php (new)
│   ├── Console/EvaluateDashboardAssistant.php                                   # new
│   ├── Http/Controllers/AssistantController.php
│   └── Jobs/RunAssistant.php
├── app/Support/Operations.php
├── resources/assistant/dashboard-evaluation.json                                # new
├── resources/help/dashboards.md
├── routes/console.php
└── tests/Feature/Domain/
    ├── Dashboards/PanelSuggestionsContractTest.php, SaveDashboardTest.php       # new
    └── Assistant/DashboardAssistantTest.php, DashboardProposalTest.php          # new
packages/api-client/src/assistant.ts, src/index.ts, src/dashboards.ts
apps/portal/src/
├── dashboards/DashboardGrid.tsx                                                 # new
├── dashboards/assistant/DashboardAssistant.tsx, AssistantDashboardPage.tsx,
│   ProposedPanelDetails.tsx                                                     # new
├── dashboards/DashboardWorkspace.tsx, LibraryPage.tsx, VersionHistory.tsx,
│   model.ts, suggest.ts, suggest.test.ts
├── assistant/Questions.tsx (new), AssistantPanel.tsx, suggestions.ts
├── panel/context.tsx, help/HelpPanel.tsx, App.tsx
└── support/NewTicketPage.tsx
apps/portal/e2e/dashboard-assistant.spec.ts                                      # new
contracts/openapi/supplements/assistant.yaml, supplements/dashboards.yaml
deploy/release/monitoring/grafana/dashboards/platform.json
docs/features/assistant.md, docs/features/dashboards.md, docs/roadmap.md, docs/ops/monitoring.md
```

**Structure Decision**: the Dashboards domain owns validation, saving, suggestions and
layout, so spec 004's agent drafts can reuse them; the Assistant domain owns the scope,
agent, tools, proposals and unmet counts. The portal keeps dashboard UI under
`src/dashboards`.

## Delivery

No stacked pull requests: each is based on `main` and opened after the one before it
merges.

1. **Documents**: this spec, plan and tasks (documents only); merging it accepts the plan.
2. **Dashboard foundations**: `validateDocument`, `SaveDashboard`, revision `origin`,
   `PanelSuggestions`, `DashboardLayout`, the parity fixture, `DashboardGrid`, tone band
   colours, and the ticket draft state. Useful on its own and unlocks spec 004 PR 7; it
   ticks spec 004's T075 and T076 as delivered here.
3. **Dashboard assistant**: the scope, agent, tools, proposals, unmet counts, portal
   assistant route and edit-mode slot, hand-offs, evaluation command, metrics and docs.
   Rebuild and quickstart C and D before review.

## Complexity Tracking

No violations.
