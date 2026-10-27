# Research: Dashboard Assistant

Findings from the code as of `main` 9c03eb8, and the decisions they lead to. Paths are
relative to the repository root.

## R1. One rule set for options, on the server and in the portal (FR-007, SC-002)

**Finding.** The ranking rules live only in the portal:
[`suggest.ts`](../../apps/portal/src/dashboards/suggest.ts) (`suggestPanels`,
`incompatibility`, `sourceFor`, `panelFor`). The server has the hard limits in
`DashboardDefinition` (counter-only Consumption, one unit, gauge limits, colour and state
types) but no ranking, hints or reasons. The assistant runs on the server, so it cannot
call the TypeScript.

**Decision.** Port the ranking to PHP as `App\Domain\Dashboards\Services\PanelSuggestions`
(`suggest`, `incompatibility`, `source`), and pin both implementations to one golden
fixture, `contracts/dashboards/v1/panel-suggestions.fixture.json`: cases of candidate
parameters (kind, data type, unit, format, display hints, range, writable) with the
expected ranked types and reasons, the expected incompatibility reason per type, and the
expected source defaults (palette colour by index, the neutral base band). PHPUnit and
Vitest both read it, as `expressions.fixture.json` is read by PHP and Go today
(ADR-015). A rule change edits the fixture, both implementations and their tests in one
pull request.

**Alternatives considered.**
- The portal computes options and sends them with the message: the server cannot trust
  them, and the model would see different rules from the review.
- Run the TypeScript on the server (Node sidecar): a new runtime dependency for ~150
  lines of rules.
- Let the model pick types freely and rely on save validation: validation allows types
  that mislead (a time series titled as usage), and the options would drift from **Add
  panel**.

## R2. Validating a proposal without saving it (FR-014, FR-018)

**Finding.** `DashboardDefinition::validate(Request, Organization, bool $updating)` is
already pure: it only reads, throws `ValidationException`, and returns the document with
each source's unit, data type, format, display widget, device name and label rewritten
from the applied profile. It takes a `Request`; `restore` fakes one with `merge`. Spec 004
planned the same entry point for agent dashboard drafts (its task T075) and a
`SaveDashboard` action (T076); neither is built.

**Decision.** Build both here, as spec 004 described them, so its PR 7 reuses them:
- `DashboardDefinition::validateDocument(array $document, Organization, bool $updating): array`,
  with `validate(Request, …)` delegating to it unchanged.
- `App\Domain\Dashboards\Actions\SaveDashboard` (`create`, `update`) extracted from
  `DashboardController::store`/`update`/`snapshot`, controller responses unchanged.

**Alternatives considered.** Validating proposals with a fake `Request` (as `restore`
does): works, but spreads request-faking into a second domain and leaves spec 004 to do
the refactor anyway.

## R3. Device visibility (FR-003)

**Finding.** Device access is organization-level: `DeviceAuthorization` checks
membership and the `Device.view` permission; there are no per-user device lists.
`DashboardDefinition` checks only that devices belong to the organization.

**Decision.** Every dashboard assistant tool and both apply paths call
`DeviceAuthorization::authorize($user, DevicePermission::VIEW, $organization)` in addition
to the dashboard checks, matching spec 004's rule for dashboard drafts. Panels that name a
workflow (alerts, location) also need `Workflow.view` (`DagAuthorization::authorize(…, 'view')`);
geofences are covered by `Device.view`, as in `GeofenceController`. Controls panels need
`Device.command`, and `discover` reports a parameter as writable only when the person has it.

## R4. Where the conversation lives and how the page sees proposals (FR-002, FR-017)

**Finding.** The workspace panel ([`panel/context.tsx`](../../apps/portal/src/panel/context.tsx),
[`HelpPanel.tsx`](../../apps/portal/src/help/HelpPanel.tsx)) docks as a 440 px rail from
1280 px and is a sheet below. A page that owns an assistant registers a slot with
`usePanelSlot` and portals its conversation into the rail; the automation editor does
this, which is how it owns its proposals and applies them to its own state. There is no
global proposal store. Hand-offs between pages use `startTask(…, {to, text, id})` plus
navigation state carrying the id.

**Decision.** Use the slot pattern. A `DashboardAssistant` conversation component is
rendered by the page that owns the target:
- **New dashboard:** a new route, `dashboards/assistant/:conversation?`, whose main area
  shows the latest proposal through `DashboardGrid` (R5) with a header (name, time
  range, access, **Create dashboard**). Before the first proposal it shows example
  requests.
- **Existing dashboard:** `DashboardWorkspace` registers the slot while editing, so the
  Ask tab opens this dashboard's conversation, and renders the latest proposal's panels
  below the draft's, marked **Proposed**.

Below 1280 px the conversation is in the sheet; **Review dashboard** closes the sheet,
since the page already shows the proposal.

A new hand-off kind `{to: "dashboard", text, id}` lets the Dashboards page suggestions
open the assistant route with a request waiting, the same way the automation hand-off
works.

**Alternatives considered.** A separate full-page builder (rejected in clarification);
an event bus between the rail and the page (unnecessary when the page owns the
conversation).

## R5. Drawing an unsaved dashboard (FR-010, FR-017)

**Finding.** `PanelBody` (`registry.tsx`) draws one panel from a widget and a view and
fetches its own data by device; it needs no dashboard id. The full grid (react-grid-layout,
`ROW_HEIGHT` 48, breakpoints, `responsiveLayouts`) is inline in `DashboardWorkspace` and
uses the saved dashboard's uuid for the crosshair group, the context rail and query keys.

**Decision.** Extract the read-only grid into `apps/portal/src/dashboards/DashboardGrid.tsx`
(widgets, layouts, view, a `preview` flag passed to every panel so Controls never send
commands, optional group id, optional per-panel badge) and use it in the
workspace's view mode, the assistant route, and later spec 004's review page. Editing
behaviour (drag, resize, panel menus) stays in the workspace.

## R6. Layout of proposed panels

**Finding.** `appendLayout` (`model.ts`) places every new panel at half the columns wide
and 6 rows high, at the first free slot or the bottom; templates build an `lg`-only layout
with it, which the server accepts and the portal scales with `responsiveLayouts`.

**Decision.** `App\Domain\Dashboards\Services\DashboardLayout::append` ports
`appendLayout` for new-dashboard proposals (`lg` only), covered by layout cases in the
same fixture as R1. Panels added to an existing dashboard are placed by the portal's own
`appendLayout` at the bottom, so they follow whatever the person changed in the draft.

## R7. Applying: create on the server, add on the client (FR-018, FR-019, FR-020)

**Finding.** `POST …/proposals/{p}/decision` is profile-only: `approve` or `reject` with
`content_hash` and `request_id`, idempotent replays, then `apply`. Automation proposals
are used client-side only ("Use this draft"); the server refuses decisions for them.

**Decision.** Extend `decide` with a dashboard branch handled by a new
`DashboardProposalService`:
- `section = dashboard` (new dashboard), `approve`: re-validate with the person's current
  permissions, `SaveDashboard::create` with `origin = assistant`, store
  `result = {dashboard_uuid}`, set the conversation's `dashboard_id`, mark the proposal
  `applied`. A replay returns the same result; a second creation is impossible because
  the proposal row is locked and already `applied`.
- `section = dashboard_panels` (existing dashboard), `approve`: re-validate the panels
  (organization, `Device.view`, edit ability on the target) and return them with fresh
  ids; mark `applied`. The portal adds them to its local draft. Nothing is saved; the
  normal **Save dashboard** with its revision check does that.
- `reject`: `dismissed`, so the marked panels disappear.

The dashboard proposal has no SDK approval to resume (unlike profiles), so no
continuation run is queued.

## R8. Undo in the editor (US3)

**Finding.** `DashboardWorkspace` has no history stack; removing a panel offers **Undo**
in its toast (restores the previous draft).

**Decision.** **Add to dashboard** follows the same pattern: snapshot the draft, add the
panels, and show a success toast with **Undo** that restores the snapshot. A general
undo history for the dashboard editor is out of scope.

## R9. Conversation target and context (FR-004, US3 acceptance 2)

**Finding.** Each scope has its own nullable foreign key on `assistant_conversations`
(`device_profile_id`, `automation_workflow_id`, `device_adapter_id`). Scope names are
repeated in three `in:` rules in `AssistantController`, an allowlist in `RunAssistant`
and branches in `AssistantAccess`. Automation sends its current draft as `target` with
each message (capped by `assistant.max_draft_characters`) and replays the last six
exchanges instead of SDK memory.

**Decision.**
- Add `dashboard_id` (nullable, `nullOnDelete`) and record the target kind in
  `onboarding_state.target_kind` (`new` or `dashboard`), so a deleted dashboard does not
  turn a conversation into a new-dashboard one. A `dashboard` conversation whose
  `dashboard_id` became null answers 410 with "This dashboard was deleted."
- Introduce `App\Domain\Assistant\Enums\AssistantScope` and use it for the repeated `in:`
  lists and the run allowlist. The roadmap's full scope registry stays separate.
- The existing-dashboard message carries a compact `target`: the draft's revision and,
  per panel, id, type, title and source pairs (no thresholds or layout), at most 100
  panels and `assistant.max_draft_characters`. It is context only; apply re-validates
  everything.
- Replay the last six exchanges, as automation does.

## R10. Tools the model gets (FR-005, FR-006, FR-011, FR-012, FR-022, FR-028)

**Decision.** One `DashboardAssistantTools` class with an `action` enum and
`arguments_json`, like `WorkflowAssistantTools`, logging refusals as "Dashboard assistant
tool refused". Actions:

| Action | Purpose |
| --- | --- |
| `discover` | Find devices by search, site, tag or profile; return up to 10 devices per page with their applied parameters (kind, data type, unit, range, hint, writable), reporting time zone, and latest value with its age. |
| `options` | For source pairs, the ranked options and incompatibilities from `PanelSuggestions`, plus notes (different time zones, more than four counters, mixed units). |
| `offer_options` | Show the person up to three validated options (type, title, reason, settings) for those sources, in rank order; the portal draws each with a small preview. |
| `ask_questions` | Up to three structured questions; shared with the profile tools through an extracted `AssistantQuestions` helper. |
| `preview_dashboard` | Complete, lint, lay out and validate a proposal, store it, emit `proposal`. Returns the proposal id or the reasons it was refused. |
| `record_unmet` | Count an unmet request by category and store a ticket draft (title, body) in the conversation for **Ask the team for this panel**. |
| `offer_alert` | Store an alert request for **Set up an alert**. |

Tool output is capped by `assistant.max_context_characters`, as for automation.

## R11. Truthful titles (FR-023)

**Decision.** `DashboardClaims` lints every proposed panel's title, description and
reason before validation. English word lists in `config/assistant.php`
(`dashboard.claims`) define what is refused:
- aggregation or ranking words (total, sum, combined, overall, average, mean, top,
  rank, highest, lowest, most, least) on a panel whose sources come from more than one
  device;
- average, mean, total, sum or trend words on latest-value panels (Status, Gauge, Table,
  Controls);
- usage words (usage, consumption, used, per hour, per day) on a time series of a
  counter;
- calculation words (ratio, per unit, efficiency, forecast) on any panel.

A refused proposal returns the panel and the rule to the model, which renames it. The
lists are covered by fixture cases.

## R12. Time zones (FR-024)

**Finding.** Consumption cuts buckets in each source device's reporting time zone (site,
then organization, then UTC), exposed as `reporting_timezone` on device detail.

**Decision.** `discover` returns each device's reporting time zone; `options` and
`preview_dashboard` add a note when a Consumption panel's counters report in different
zones. The note is stored in the proposal's `diagnostics` and shown under the panel in
the review, so it does not depend on the model repeating it.

## R13. Unmet request counts (FR-027)

**Finding.** Operations metrics (`GET /internal/ops/metrics`, `App\Support\Operations`)
only emit gauges; counter-like values are persisted (`operation_http_buckets`) and read
on scrape.

**Decision.** New table `assistant_unmet_requests` (`day`, `category`, `count`, unique
on day and category), incremented by `record_unmet`, pruned after 400 days by the
existing schedule. Operations emits `iot_assistant_unmet_requests{category}` as the last
30 days' count. The platform Grafana dashboard gets a panel. No organization or text is
stored.

## R14. Ticket and alert hand-offs (FR-028, FR-012)

**Finding.** `NewTicketPage` reads `type` and `from` from the query string and always
starts with an empty title and description. Automation hand-offs use panel context plus
navigation state.

**Decision.**
- `NewTicketPage` accepts `location.state.draft = {title, body}` and pre-fills the form;
  the type comes from the existing `type=feature` query. Draft text never goes in the
  URL.
- **Set up an alert** reuses the existing automation hand-off
  (`startTask("auto", {to: "automation", text, id})` and `automation/new` with the id in
  state), shown only when the person can use the automation assistant
  (`Workflow.manage` and the organization's automation preview).

## R15. Revision origin (FR-018)

**Finding.** `dashboard_revisions` has no note or source column; `created_by` is the
only author field.

**Decision.** Add nullable `origin` (`assistant`, later `agent` for spec 004) to
`dashboard_revisions`, set by `SaveDashboard` when given, returned in the revisions
list, and shown in **Version history** as "Created with the assistant".

## R16. Cost per reply

**Finding.** `RunAssistant` fails a run whose cost exceeds the per-reply reservation
(default $0.04). A run with several tool steps re-sends its context each step.

**Decision.** Keep tool output compact (R10), cap the agent at 8 steps and 4000 output
tokens, and measure cost per request with the evaluation command (R17). The feature
documentation states the measured cost per model and the per-reply limit it needs; the
admin page already warns when a model's estimate exceeds the limit. No separate budget.

## R17. Evaluation (SC-004, SC-005)

**Decision.** `php artisan assistant:evaluate-dashboards {--organization=} {--user=}`
runs a dataset (`apps/api/resources/assistant/dashboard-evaluation.json`, at least 20
requests, at least five outside the panel model) against the configured provider in the
local stack's simulated devices, and reports per request: proposal or unmet category,
replies used, claims refused, cost. It is run by hand before release and after prompt
changes, never in CI (it needs a provider key).

## R18. Contract and client changes

**Finding.** All assistant operations and all dashboard operations are listed in
`contracts/openapi/pending-schemas.json` (shrink-only), with supplements in
`supplements/assistant.yaml` and `supplements/dashboards.yaml`.

**Decision.** No new operations: the assistant endpoints gain the `dashboard` scope and
fields, and the revisions list gains `origin`. Supplements document the new 409/410/422
responses; nothing is added to the pending list. `packages/api-client` gains the
dashboard assistant calls and types in `assistant.ts`.

## R19. Threshold colours from words (FR-012)

**Finding.** Saved band colours must be hex; the threshold editor has no presets. The
palette colours render through `--series-N` variables (`seriesColor`), and the neutral
base band through the muted text colour (`bandColor`). Profile state tones (`good`,
`info`, `warning`, `critical`) map to semantic variables (`TONE_COLOR`).

**Decision.** The model names a tone per band; the server stores a fixed hex per tone,
listed in the R1 fixture so both sides agree. `bandColor` maps those hex values back to
the semantic variables, so assistant-made bands follow the skin and theme. The review
states each band as a range from its inclusive lower bound ("80 °C and above").
