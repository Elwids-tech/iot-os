# Implementation Plan: Automation Nodes for Missing Data, Schedules and States

**Branch**: `spec/014-automation-nodes` | **Date**: 2026-10-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/014-automation-nodes/spec.md`

## Summary

Six node types join the Go registry, compiler and evaluator: `nodata.v1`,
`schedule.v1`, `state.v1`, `not.v1`, `range.v1` and `rate.v1`. Two of them are
time-driven and plug into the existing timer: their deadlines join the
`next_timer` minimum that windows, sustained conditions and source expiry already use,
so `TickDAGs` wakes them without telemetry and never ahead of unprocessed messages.
The registry gains a `list` field type for State match values and Schedule ranges and
weekdays. Laravel checks State match values against the bound parameter's profile and
validates Schedule time zones; the editor gets palette entries, summaries and
`renderConfig` components; the assistant's prompt and the Help guides describe the
nodes. Delivery is four pull requests in priority order, each complete on its own.
Decisions and their alternatives are in [research.md](research.md).

## Technical Context

**Language/Version**: Go 1.27 (runtime); PHP 8.4 / Laravel 13 (API); TypeScript,
React 19 (portal, `@iot-os/workflow-editor`)

**Primary Dependencies**: the runtime's `internal/dag` (registry, compiler, evaluator,
trace) and `internal/storage` (DAG state, timers); `time/tzdata` (already embedded);
`@iot-os/ui` (`ToggleGroup`, `SearchableSelect`, `Field`, `Input`); Laravel
`timezone:all` validation

**Storage**: PostgreSQL 17 / TimescaleDB. No new tables. `dag_executions` state JSON
gains node-state fields (`LastFresh`, an anchor); old state decodes with zero values.

**Testing**: Go unit tests for registry, compiler, evaluator and trace per node, and
storage integration tests for timers and persisted state (`DEVICE_TEST_DATABASE_URL`);
PHPUnit on PostgreSQL for authoring validation, scenarios and the assistant; Vitest for
editor summaries, list fields and simulation steps; mocked Playwright for the editor;
`tooling/verify-devices-contracts.py` and `tooling/verify-automation.mjs`; a live run
in the rebuilt stack with the device simulator

**Target Platform**: runtime, api and workers, portal (single-node release profile)

**Project Type**: web application with a data-plane service

**Performance Goals**: a timer-driven change within 10 seconds of its deadline (the
consumer ticks about once a second); no measurable cost for workflows that do not use
the new nodes

**Constraints**: deterministic simulation and scenarios; bounded state (Rate of change
shares the 10,000-sample bound); no new permission, endpoint or event

**Scale/Scope**: 6 node types, 1 field type, about 4 portal config components and 1 new
kit component (a multi-value text input), 4 implementation pull requests

## Constitution Check

| Principle | Status |
| --- | --- |
| I. Laravel owns intent; Go executes | Pass. Evaluation, timers and state stay in the runtime; Laravel validates drafts (profile values, time zones) and serves the registry as today. The runtime asks Laravel nothing per message. |
| II. Immutable versions | Pass. New behaviour comes from new versioned node types, existing types are unchanged, and Schedule stores its time zone in the definition so deployments do not drift with site changes. |
| III. Tenant isolation | Pass. Nodes read only their own execution's bound telemetry and state. Each pull request adds a cross-organization test: pull request 1, that one organization's lost broker connection leaves another's No data unchanged; pull request 2, that a Schedule boundary tick creates no timeline entries or intents for another organization; pull request 3, that State match profile lookups cannot reach another organization's device; pull request 4, that another organization's readings never enter a Rate of change buffer. |
| IV. Contracts first | Pass. `contracts/rules/v2` gains a cases file covering the new types and the registry's `list` field, validated in CI and loaded by the Go compiler tests. No endpoint is added or removed. `GET workflows/dag/node-types` returns the new types and the `list` field shape; its body is on `contracts/openapi/pending-schemas.json` (only status codes are checked), and its typed consumer is `@iot-os/workflow-editor` (`types.ts`), updated in pull request 2. `packages/api-client` has no node types, so it is unchanged. |
| V. AI proposes, people approve | Pass. The assistant only learns to propose the nodes; proposals go through the same compiler and review. Nothing works differently with the assistant off. |
| VI. Show uncertainty | Pass. Each node's unknown cases are explicit (FR-005–FR-010). No data is the only node that turns missing data into a known value, and only after a full observed period with the platform connected (D1, D2). |
| VII. Durable, idempotent messaging | Pass. State and timers commit with the checkpoint as today; tokens (`nodata:<deadline>`, `schedule:<node>:<start>`) keep actions idempotent across redelivery and restarts. |
| VIII. One design system | Pass. Config UIs compose `@iot-os/ui`; the one new kit component (multi-value text input) gets a story. |
| IX. Verified where it runs | Pass. Each pull request rebuilds runtime, api, workers and portal and runs its user story against the simulator in the stack. |

ADR-011 lists node types as examples of a versioned, typed registry with no scripts;
adding types follows it, so no ADR changes. The docs list in
`docs/features/automation.md` is the canonical catalogue and changes with each node.

## Design

### Runtime (`services/runtime/internal/dag`)

| Node | Ports | Config | Unknown when | Timer |
| --- | --- | --- | --- | --- |
| `nodata.v1` No data | `in: any` (straight from a source) → `out: boolean` | `seconds` 60–604,800, ≥ the binding's `fresh_seconds` | no reading and less than a full period since the anchor; broker connection lost (D1) | `max(LastFresh, anchor) + seconds` |
| `schedule.v1` Schedule | none → `out: boolean` | `time_zone` (IANA), `ranges` list of `{start, end}` `HH:MM` (1–8), `weekdays` list of ISO weekdays (1–7) | never | next boundary |
| `state.v1` State match | `in: any` (boolean or string binding) → `out: boolean` | `values` list of scalars (1–16), type matching the input | input unknown or stale | — |
| `not.v1` Not | `in: boolean` → `out: boolean` | — | input unknown | — |
| `range.v1` Range | `in: number` → `out: boolean` | `low`, `high` (low < high), `mode` `inside`/`outside` | input unknown | — |
| `rate.v1` Rate of change | `in: number` (straight from a source) → `out: number` | `seconds` 60–86,400, `output` `change`/`per_second`/`per_minute`/`per_hour` | fewer than two samples in the period, or the latest stale | oldest sample + `seconds` |

- **Registry and compiler**: the six entries; the `list` field type (D4); per-node rules
  (no-data period versus freshness, schedule time and zone parsing, merged overlapping
  ranges, state values typed to the input, `low < high`, rate output unit). Schedule is
  neither a root nor a source, so Boolean logic can combine it with one device's
  condition without Correlate (D3). A workflow still needs a binding.
- **Evaluator**: node logic per D2, D3, D5, D7; `NodeState` gains `LastFresh` and an
  anchor (zero values for existing state); `nextTimer` includes the new deadlines; known
  outputs may carry a reason that traces show (D8).
- **Broker guard (D1)**: the tick passes the set of devices whose broker connection is
  recorded as lost; No data reports unknown for them and moves its anchor to the
  restore time. The recording location is confirmed in PR 1.
- **Simulation**: unchanged mechanics; clock steps drive the new timers.

### Contract (`contracts/rules/v2`)

`workflow.cases.json` (the checker's per-schema cases file) gains valid cases that use
every new node and the `list` field, and invalid ones the schema must reject. The
existing `workflow.fixture.json` is untouched, so its compiled definition is unchanged
(SC-005). Each pull request adds the cases for its nodes, and the Go compiler tests load
the same cases so the contract and the runtime agree.

### Laravel (`apps/api/app/Domain/Automation`, `Domain/Assistant`)

- `DagAuthoring::compile`: State match values against the source parameter's allowed
  values (D6); Schedule `time_zone` with `timezone:all`; type-specific messages on the
  field.
- `ScenarioSimulation`: no change in behaviour; tests add clock-step scenarios for each
  node.
- `WorkflowAssistant` prompt: when to use No data (silence), Schedule (time of day,
  zone from the device), State match and Not (switches, modes), Range (bands) and Rate
  of change (changes over time); replace "ask about dwell" with the new nodes where
  they apply. The schema tool already serves the registry.
- Help: `automation-conditions.md` (and `automations.md` keywords) describe each node
  with its unknown behaviour and an example, revision bumped; `php artisan
  help:validate`.

### Portal and editor

- `packages/workflow-editor/src/presentation.ts`: palette group, icon, tone and summary
  for each type (FR-003); `types.ts`: the `list` field type; generic list fallback
  (JSON list editor).
- `apps/portal/src/automation`: `renderConfig` components: `NoDataConfig` (duration
  and the binding's freshness hint), `ScheduleConfig` (time ranges with `Input
  type="time"`, weekdays with `ToggleGroup`, zone with `SearchableSelect` defaulting to
  the first bound device's reporting zone), `StateMatchConfig` (allowed values as a
  `ToggleGroup` or checkbox list, or the new multi-value text input for free strings),
  `RateConfig` (period and output). `simulation.ts` clock steps cover the new periods;
  the editor warns when a Schedule's zone differs from the device's current zone.
- `packages/ui`: a multi-value text input (`TagInput`) with a story, if no existing
  component fits.

### Docs

`docs/features/automation.md` (catalogue table, semantics, the broker guard),
`docs/architecture/glossary.md` (No data, Schedule), and each pull request's Help
guide change.

## Delivery

Each pull request is based on `main` after the previous one merges; none is stacked.

1. **No data** (US1, FR-005, FR-005a, D1, D2, D8): runtime node, broker guard, timer,
   trace reasons, contract cases, editor entry and `NoDataConfig`, assistant prompt, Help and
   docs. Live check: stop a simulated device, see the alert open and clear.
2. **Schedule** (US2, FR-006, FR-012, D3, D4): `list` field type, runtime node with
   time zones and DST, Laravel zone validation, `ScheduleConfig`, prompt, Help, docs.
   Live check: a range ending two minutes from now flips the output in the Execution
   tab.
3. **State match, Not and Range** (US3, US4, FR-007–FR-009, D5, D6): runtime nodes,
   Laravel profile-value check and isolation test, `StateMatchConfig`, the kit input
   and its story, prompt, Help, docs. Live check: RGB LED mode changes drive State
   match.
4. **Rate of change** (US5, FR-010, D7): runtime node with sample pruning and timer,
   `RateConfig`, prompt, Help, docs. Live check: simulator temperature ramp.

US6 (assistant and Help) is delivered inside each pull request for its nodes. After
pull request 4, a final assistant check asks for the US6 prompt and expects a proposal
using No data, Schedule and Boolean AND (SC-004).

## Project Structure

### Documentation (this feature)

```text
specs/014-automation-nodes/
├── spec.md
├── plan.md
├── research.md
├── checklists/requirements.md
└── tasks.md            # next: /speckit-tasks
```

### Source Code (repository root)

```text
services/runtime/internal/dag/         registry.go, compiler.go, evaluator.go, trace.go, types.go (+ tests)
services/runtime/internal/storage/     dag.go (timers, broker-guard input) (+ integration tests)
contracts/rules/v2/                    workflow.cases.json
apps/api/app/Domain/Automation/        Services/DagAuthoring.php (+ tests/Feature/Domain/Automation)
apps/api/app/Domain/Assistant/         Agents/WorkflowAssistant.php (+ WorkflowAssistantTest)
apps/api/resources/help/               automation-conditions.md, automations.md
packages/workflow-editor/src/          presentation.ts, types.ts, index.tsx
apps/portal/src/automation/            NoDataConfig, ScheduleConfig, StateMatchConfig, RateConfig, simulation.ts, Automation.tsx
packages/ui/src/components/            tag-input.tsx (+ apps/storybook story), only if needed
docs/features/automation.md, docs/architecture/glossary.md
```

**Structure Decision**: no new domain, service or table; every change sits in the
existing automation path across the runtime, the API and the editor.

## Risks

- **Global ticks.** A tick steps every enabled execution in every organization. Schedule
  boundaries at round times (08:00) line up across workflows; measure a tick with
  1,000 executions in PR 2 and batch if it exceeds a second.
- **Broker-guard source (D1)** is confirmed in PR 1; if the runtime cannot read the
  connection state inside the tick transaction, PR 1 falls back to research
  alternative (a) and documents the limitation before merging, with the owner's
  agreement.
- **State match on strings that are not enums** depends on exact device output; the
  editor shows recent values from the latest readings where available.

## Complexity Tracking

No constitution violations.
