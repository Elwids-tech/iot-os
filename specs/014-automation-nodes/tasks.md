# Tasks: Automation Nodes for Missing Data, Schedules and States

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md)

**Tests**: required. Each node has runtime, contract, Laravel and portal tests, and each
pull request is verified in the rebuilt stack (Constitution IX, SC-001–SC-005).

**Delivery**: four implementation pull requests, in this order. Each one is based on
`main` after the previous one has merged; never stack them. Each pull request ticks its
tasks here and updates `docs/features/automation.md` and the Help guide for its nodes.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel with other [P] tasks of the same phase (different files,
  no dependency on an unfinished task)
- **[Story]**: the user story in [spec.md](spec.md) the task serves; US6 (assistant and
  Help) is delivered inside each pull request for its nodes

---

## Phase 1: Foundation for pull request 1

**Purpose**: what No data needs and later nodes reuse.

- [ ] T001 Confirm where the runtime records broker connection state that the DAG tick transaction can read (presence rows in `device_runtime`, or a connection-state table written by `services/runtime/internal/app/application.go` on connection lost and restored), and record the answer under D1 in `specs/014-automation-nodes/research.md`; if it cannot be read in the tick, stop and agree research alternative (a) with the owner before continuing
- [ ] T002 Let known values carry a reason that the trace shows in preference to the generic outcome text (D8) in `services/runtime/internal/dag/trace.go` and `services/runtime/internal/dag/types.go`, keeping every existing node's trace text unchanged; cover it in `services/runtime/internal/dag/trace_test.go`
- [ ] T003 Add `NodeState.LastFresh` and an anchor time, with zero values for existing persisted state, in `services/runtime/internal/dag/types.go`; prove old state JSON decodes in `services/runtime/internal/storage/dag_integration_test.go`

---

## Phase 2: User Story 1, No data (Priority: P1) 🎯 MVP · pull request 1

**Goal**: an alert when a device parameter has had no fresh reading for a period, which
clears when readings resume.

**Independent Test**: activate *parameter → No data (2 min) → Alert* in the local stack,
stop the simulator for that device, see the alert open within 10 s of the two minutes
and clear within 10 s of the next reading (SC-001).

### Tests for User Story 1

- [ ] T004 [P] [US1] Evaluator tests in `services/runtime/internal/dag/evaluator_test.go`: false while a reading is within the period; true at `max(LastFresh, anchor) + seconds` on a nil-event tick; unknown before a full period after activation with no reading; token `nodata:<deadline>` triggers the alert once per silence; a fresh reading clears it; unknown and anchor reset while the device's broker connection is lost (FR-005, FR-005a)
- [ ] T005 [P] [US1] Compiler tests in a new `services/runtime/internal/dag/compiler_test.go`: input must come straight from `source.parameter.v1`; `seconds` 60–604,800 and at least the binding's `fresh_seconds`; type IDs and fields of every existing node unchanged (FR-001, FR-004, FR-018)
- [ ] T006 [P] [US1] Storage integration test in `services/runtime/internal/storage/dag_integration_test.go`: the No data deadline sets `dag_executions.next_timer`, `TickDAGs` fires it only after the checkpoint passes the recorded cutoff, and a 30-minute pause with readings in the backlog never declares silence (SC-002)
- [ ] T007 [US1] Isolation test in `services/runtime/internal/storage/dag_integration_test.go`: two organizations, each with a No data workflow; losing the broker connection of the first organization's device leaves the second organization's No data unchanged, and a tick evaluates each execution only against its own devices (Constitution III)
- [ ] T008 [P] [US1] Contract cases in `contracts/rules/v2/workflow.cases.json`: a valid workflow using `nodata.v1` and an invalid one (period below freshness); `tooling/verify-devices-contracts.py` passes, and the Go tests load the same cases
- [ ] T009 [P] [US1] Scenario test in `apps/api/tests/Feature/Domain/Automation/ScenarioTest.php`: one reading, then a clock step 3 minutes later expects one alert request; a clock step 1 minute later expects none
- [ ] T010 [P] [US1] Portal tests in `apps/portal/src/automation/node-presentation.test.ts` (summary "No reading for 15 min", palette group and icon) and `apps/portal/src/automation/simulation.test.ts` (the clock step covers the No data period)

### Implementation for User Story 1

- [ ] T011 [US1] Register `nodata.v1` (label "No data", input `in: any`, output `out: boolean`, field `seconds` bounded 60–604,800) in `services/runtime/internal/dag/registry.go`, with its compiler rules in `services/runtime/internal/dag/compiler.go`
- [ ] T012 [US1] Evaluate `nodata.v1` per D2 in `services/runtime/internal/dag/evaluator.go`, add its deadline to the next-timer minimum, and give true and false outputs reasons such as "No reading for 15 min 4 s; last reading 09:41:12"
- [ ] T013 [US1] Pass the devices with a lost broker connection into tick evaluation from the source confirmed in T001, in `services/runtime/internal/storage/dag.go`; simulation passes none (FR-005a)
- [ ] T014 [P] [US1] Palette entry, icon, tone and summary for `nodata.v1` in `packages/workflow-editor/src/presentation.ts`
- [ ] T015 [P] [US1] `NoDataConfig` (duration with the binding's freshness as a hint and minimum) in `apps/portal/src/automation/NoDataConfig.tsx`, wired through `renderConfig` in `apps/portal/src/automation/Automation.tsx`; the No data period joins the clock step in `apps/portal/src/automation/simulation.ts`
- [ ] T016 [P] [US6] Describe No data in the prompt in `apps/api/app/Domain/Assistant/Agents/WorkflowAssistant.php` (use it for silence and offline requests), with a test in `apps/api/tests/Feature/Domain/Assistant/WorkflowAssistantTest.php` that the schema tool lists `nodata.v1`
- [ ] T017 [US6] Execution explanation test in `apps/api/tests/Feature/Domain/Assistant/WorkflowAssistantTest.php`: explaining an evaluation whose trace includes a `nodata.v1` step puts its reason and a `[step:N]` citation in the evidence snapshot (FR-011)
- [ ] T018 [P] [US6] Help: No data with its unknown behaviour and an example in `apps/api/resources/help/automation-conditions.md`, revision bumped, keywords in `apps/api/resources/help/automations.md`; `php artisan help:validate` passes
- [ ] T019 [P] [US1] Docs: catalogue row, semantics and the broker guard in `docs/features/automation.md`; "No data" in `docs/architecture/glossary.md`
- [ ] T020 [US1] Mocked editor spec `apps/portal/e2e/automation-nodes.spec.ts`: add No data from the palette, set 15 minutes, see the summary and a validation message below the binding's freshness
- [ ] T021 [US1] Rebuild runtime, api, workers and portal per `.agents/skills/local-container-verification/SKILL.md` and run the Independent Test above; record the result in the pull request

**Checkpoint**: pull request 1 merges with US1 complete and US6 covering No data.

---

## Phase 3: Foundation for pull request 2

**Purpose**: the `list` field type that Schedule and State match need (D4).

- [ ] T022 Add `list` fields (`Items` of `string`, `number`, `boolean` or `object`; `MaxItems`) to the registry types in `services/runtime/internal/dag/types.go` and `services/runtime/internal/dag/registry.go`, validated in `services/runtime/internal/dag/compiler.go`, with tests in `services/runtime/internal/dag/evaluator_test.go`
- [ ] T023 [P] Add the `list` field type to `packages/workflow-editor/src/types.ts` and a generic JSON list fallback in `packages/workflow-editor/src/index.tsx`

---

## Phase 4: User Story 2, Schedule (Priority: P1) · pull request 2

**Goal**: conditions that hold only in configured time ranges and weekdays in a stored
time zone.

**Independent Test**: a saved scenario starting on Tuesday 2030-01-01 combines a boolean
door contact and *Schedule (weekdays 18:00–08:00, weekends all day)* through Boolean AND; a
door opening at 17:00 requests nothing, one at 19:00 and one on Saturday at 10:00 sound
the alarm. Live, a range ending two minutes from now flips the output in the Execution
tab within 10 s.

### Tests for User Story 2

- [ ] T024 [P] [US2] Evaluator tests in `services/runtime/internal/dag/evaluator_test.go`: inside and outside; a range that ends before it starts runs past midnight and belongs to its start weekday; boundaries on nil-event ticks; `Expires` at the next boundary; token `schedule:<node>:<range start>` triggers once per range; spring-forward start in a skipped hour begins at the transition, autumn repeated hour counted once (Europe/London 2030-03-31 and 2030-10-27); 00:00–00:00 is the whole day (FR-006, SC-003)
- [ ] T025 [P] [US2] Compiler tests in `services/runtime/internal/dag/compiler_test.go`: no inputs and not a root, so Boolean logic with one device's condition needs no Correlate; a workflow still needs a binding; rejects an unknown zone, no ranges, no weekdays, more than 8 ranges, and an invalid `HH:MM`; overlapping ranges are merged
- [ ] T026 [P] [US2] Contract cases for `schedule.v1` in `contracts/rules/v2/workflow.cases.json`
- [ ] T027 [P] [US2] Laravel tests in `apps/api/tests/Feature/Domain/Automation/DagTest.php`: `time_zone` validated with `timezone:all`; the deployed definition keeps its zone after the site's zone changes (FR-012); and in `ScenarioTest.php` the Independent Test scenario
- [ ] T028 [P] [US2] Isolation test in `services/runtime/internal/storage/dag_integration_test.go`: a Schedule boundary tick for one organization's workflow creates no timeline entries or intents for another organization's executions (Constitution III)
- [ ] T029 [P] [US2] Portal tests: Schedule summary ("Weekdays 18:00–08:00, weekends all day · Europe/Berlin") in `apps/portal/src/automation/node-presentation.test.ts`; schedule editing helpers (merging, cross-midnight labels) in `apps/portal/src/automation/schedule.test.ts`

### Implementation for User Story 2

- [ ] T030 [US2] Register `schedule.v1` (no inputs, `out: boolean`, fields `time_zone` string, `ranges` list of `{start, end}` 1–8, `weekdays` list of ISO weekdays 1–7) in `services/runtime/internal/dag/registry.go` with compiler rules in `services/runtime/internal/dag/compiler.go`
- [ ] T031 [US2] Evaluate `schedule.v1` per D3 in `services/runtime/internal/dag/evaluator.go` with `time.LoadLocation` (tzdata embedded), add the next boundary to the next-timer minimum, and give outputs reasons such as "Inside 18:00–08:00 (Europe/Berlin)"
- [ ] T032 [US2] Validate `time_zone` with `timezone:all` in `apps/api/app/Domain/Automation/Services/DagAuthoring.php`, accepting tz database links (for example a renamed zone), with the error on the node's field
- [ ] T033 [P] [US2] Palette entry and summary for `schedule.v1` in `packages/workflow-editor/src/presentation.ts`
- [ ] T034 [US2] `ScheduleConfig` in `apps/portal/src/automation/ScheduleConfig.tsx` (time ranges with `Input type="time"`, weekdays with `ToggleGroup`, zone with `SearchableSelect` pre-filled from the first bound device's reporting time zone, else the organization, else UTC) and helpers in `apps/portal/src/automation/schedule.ts`, wired through `renderConfig` in `apps/portal/src/automation/Automation.tsx`; show the zone's canonical name, and a notice when the node's zone differs from the device's current zone
- [ ] T035 [P] [US6] Describe Schedule in the prompt in `apps/api/app/Domain/Assistant/Agents/WorkflowAssistant.php` (zone from the device, combine through Boolean AND), with a test in `apps/api/tests/Feature/Domain/Assistant/WorkflowAssistantTest.php`
- [ ] T036 [P] [US6] Help: Schedule, time zones and daylight saving in `apps/api/resources/help/automation-conditions.md`, revision bumped; `php artisan help:validate` passes
- [ ] T037 [P] [US2] Docs: catalogue row and semantics in `docs/features/automation.md`; "Schedule" in `docs/architecture/glossary.md`
- [ ] T038 [US2] Extend `apps/portal/e2e/automation-nodes.spec.ts`: configure a cross-midnight weekday range and a zone, see the summary
- [ ] T039 [US2] Measure a tick with 1,000 enabled executions whose Schedule boundaries coincide, in a storage benchmark under `services/runtime/internal/storage/`; batch evaluation if a tick exceeds one second (plan Risks)
- [ ] T040 [US2] Rebuild runtime, api, workers and portal per `.agents/skills/local-container-verification/SKILL.md` and run the Independent Test above live

**Checkpoint**: pull request 2 merges with US2 complete.

---

## Phase 5: User Stories 3 and 4, State match, Not and Range (Priority: P2) · pull request 3

**Goal**: conditions on switches, modes and text values, negation, and two-sided bands
in one node.

**Independent Test**: saved scenarios send `mode` = `alarm`, `off`, `panic` and expect
State match (`alarm`, `panic`) true, false, true and Not false, true, false; send 1, 5
and 9 °C and expect Range (2–8, outside) true, false, true. Live, RGB LED mode changes
drive State match in the Execution tab.

### Tests for User Stories 3 and 4

- [ ] T041 [P] [US3] Evaluator and compiler tests for `state.v1` and `not.v1` in `services/runtime/internal/dag/evaluator_test.go`: exact, case-sensitive matching; values typed to the input (booleans for boolean, strings for string); numeric inputs rejected; 1–16 values; unknown or stale in gives unknown out (FR-007, FR-008)
- [ ] T042 [US4] Evaluator and compiler tests for `range.v1` in `services/runtime/internal/dag/evaluator_test.go` and `services/runtime/internal/dag/compiler_test.go`: inclusive bounds for inside, the complement for outside, `low < high` required, unknown in gives unknown out (FR-009)
- [ ] T043 [P] [US3] Contract cases for `state.v1`, `not.v1` and `range.v1` in `contracts/rules/v2/workflow.cases.json`
- [ ] T044 [P] [US3] Laravel tests in `apps/api/tests/Feature/Domain/Automation/DagTest.php`: State match values outside the parameter's allowed values are rejected with the error on the field; a draft referencing another organization's device is rejected (Constitution III); scenarios from the Independent Test in `ScenarioTest.php`
- [ ] T045 [P] [US3] Portal tests in `apps/portal/src/automation/node-presentation.test.ts`: summaries "mode is alarm or panic", "not", "outside 2–8 °C"

### Implementation for User Stories 3 and 4

- [ ] T046 [US3] Register `state.v1` (`in: any`, `out: boolean`, `values` list of scalars 1–16) and `not.v1` (`in: boolean`, `out: boolean`) in `services/runtime/internal/dag/registry.go`, with compiler rules in `services/runtime/internal/dag/compiler.go` and evaluation in `services/runtime/internal/dag/evaluator.go` per D5
- [ ] T047 [US4] Register and evaluate `range.v1` (`in: number`, `out: boolean`, `low`, `high`, `mode` `inside`/`outside`) in the same three files
- [ ] T048 [US3] Check State match values against the source parameter's allowed values in `apps/api/app/Domain/Automation/Services/DagAuthoring.php`, following the node's input edge to its `source.parameter.v1` binding (D6)
- [ ] T049 [P] [US3] Multi-value text input `TagInput` in `packages/ui/src/components/tag-input.tsx` with a story in `apps/storybook/src/components/TagInput.stories.tsx`, only if no existing kit component fits
- [ ] T050 [US3] `StateMatchConfig` in `apps/portal/src/automation/StateMatchConfig.tsx`: the parameter's allowed values from `dag/resources` (`parameters[].validation`) as a `ToggleGroup` or checkbox list, *is true* / *is false* for booleans, `TagInput` for free strings, and for a numeric parameter a message pointing to Compare or Range; wired through `renderConfig` in `apps/portal/src/automation/Automation.tsx`
- [ ] T051 [P] [US3] Palette entries and summaries for `state.v1`, `not.v1` and `range.v1` in `packages/workflow-editor/src/presentation.ts`
- [ ] T052 [P] [US6] Describe State match, Not and Range in the prompt in `apps/api/app/Domain/Assistant/Agents/WorkflowAssistant.php`, with a test in `apps/api/tests/Feature/Domain/Assistant/WorkflowAssistantTest.php`
- [ ] T053 [P] [US6] Help for the three nodes in `apps/api/resources/help/automation-conditions.md`, revision bumped; `php artisan help:validate` passes
- [ ] T054 [P] [US3] Docs: catalogue rows and semantics in `docs/features/automation.md`
- [ ] T055 [US3] Extend `apps/portal/e2e/automation-nodes.spec.ts`: pick enum values for State match, enter Range bounds and see the low ≥ high message
- [ ] T056 [US3] Rebuild runtime, api, workers and portal per `.agents/skills/local-container-verification/SKILL.md` and run the Independent Test above live

**Checkpoint**: pull request 3 merges with US3 and US4 complete.

---

## Phase 6: User Story 5, Rate of change (Priority: P3) · pull request 4

**Goal**: the change of a reading over a period, or its rate per second, minute or
hour.

**Independent Test**: a saved scenario sends 4.0 °C at 0 s, 5.5 °C at 300 s and 7.5 °C at
540 s; Rate of change (600 s, change) outputs 3.5 at 540 s and Compare (> 3) requests one
alert. Live, a simulator temperature ramp drives the alert.

### Tests for User Story 5

- [ ] T057 [P] [US5] Evaluator tests in `services/runtime/internal/dag/evaluator_test.go`: change and per-second, per-minute and per-hour rates; unknown with fewer than two samples or a stale latest reading; samples older than the period dropped on the next step or tick; the oldest sample's expiry in the next-timer minimum; the shared 10,000-sample bound; a counter reset reported as a negative change (FR-010)
- [ ] T058 [P] [US5] Compiler tests in `services/runtime/internal/dag/compiler_test.go`: input straight from a source; `seconds` 60–86,400; a rate's compound unit is rejected by Arithmetic and Unit conversion
- [ ] T059 [P] [US5] Contract cases for `rate.v1` in `contracts/rules/v2/workflow.cases.json`, and the Independent Test scenario in `apps/api/tests/Feature/Domain/Automation/ScenarioTest.php`
- [ ] T060 [P] [US5] Isolation test in `services/runtime/internal/storage/dag_integration_test.go`: another organization's readings never enter a Rate of change buffer, and its executions keep separate samples (Constitution III)
- [ ] T061 [P] [US5] Portal tests: summary "change over 10 min" and `°C/min` units in `apps/portal/src/automation/node-presentation.test.ts`; the clock step covers the period in `apps/portal/src/automation/simulation.test.ts`

### Implementation for User Story 5

- [ ] T062 [US5] Register and evaluate `rate.v1` (`in: number`, `out: number`, `seconds` 60–86,400, `output` `change`/`per_second`/`per_minute`/`per_hour`) per D7 in `services/runtime/internal/dag/registry.go`, `compiler.go` and `evaluator.go`
- [ ] T063 [P] [US5] Palette entry and summary in `packages/workflow-editor/src/presentation.ts`; `RateConfig` in `apps/portal/src/automation/RateConfig.tsx` wired through `renderConfig`; the period joins the clock step in `apps/portal/src/automation/simulation.ts`
- [ ] T064 [P] [US6] Describe Rate of change in the prompt in `apps/api/app/Domain/Assistant/Agents/WorkflowAssistant.php` with a test; Help in `apps/api/resources/help/automation-conditions.md`, revision bumped
- [ ] T065 [P] [US5] Docs: catalogue row and semantics in `docs/features/automation.md`
- [ ] T066 [US5] Rebuild runtime, api, workers and portal per `.agents/skills/local-container-verification/SKILL.md` and run the Independent Test above live

**Checkpoint**: pull request 4 merges with US5 complete.

---

## Phase 7: Polish and close-out

- [ ] T067 With the assistant enabled in the local stack, send one plain-language request per user story 1–5 (for example "alert me when GPS Demo Tracker stops reporting for 10 minutes, but only at night", "sound the alarm when the RGB LED mode is alarm or panic", "alert when the fridge is outside 2–8 °C", "alert when the cold room warms by more than 3 °C in 10 minutes") and confirm each yields a compiler-validated proposal using the matching nodes (SC-004), using the assistant in `apps/api/app/Domain/Assistant/Agents/WorkflowAssistant.php`; record the results in pull request 4
- [ ] T068 Run `/speckit-converge`; add any gap it reports as a task here and deliver it before closing
- [ ] T069 Confirm SC-005: the existing workflow, simulation, scenario and assistant tests pass unchanged and `contracts/rules/v2/workflow.fixture.json` compiles to the same definition
- [ ] T070 Freeze `specs/014-automation-nodes/` after the last pull request merges: lasting behaviour lives in `docs/features/automation.md`, and the roadmap entry in `docs/roadmap.md` is removed

---

## Dependencies & Execution Order

### Phase dependencies

- Phase 1 → Phase 2 is pull request 1. Phase 3 → Phase 4 is pull request 2, started from
  `main` after pull request 1 merges. Phase 5 is pull request 3 and Phase 6 is pull
  request 4, each after the previous one merges. Phase 7 follows pull request 4.
- T001 gates T013; if T001 finds no readable connection state, the owner decides before
  pull request 1 continues (research D1, alternative a).

### User story dependencies

- **US1** depends only on Phase 1.
- **US2** needs the `list` field type (Phase 3); it does not depend on US1's node, only
  on pull request 1 having merged (shared files, no stacking).
- **US3 and US4** need the `list` field type from pull request 2.
- **US5** reuses window samples and the timer from earlier pull requests.
- **US6** is spread across all four; T067 checks it end to end.

### Within each pull request

- Tests first and failing, then registry and compiler, then evaluator, then Laravel,
  then editor and portal, then assistant, Help and docs, then the live check.

## Parallel Example: pull request 1

```text
After T001–T003:
  T004 evaluator tests        T005 compiler tests       T006 storage test
  T008 contract cases         T009 scenario test        T010 portal tests
After T011–T013:
  T014 editor entry           T015 NoDataConfig         T016 assistant prompt
  T018 Help                   T019 docs
Then, one at a time: T007 isolation test after T006, T017 explanation test after
T016 (each shares a file with the task before it)
```

## Implementation Strategy

### MVP first

Pull request 1 (No data) alone closes the biggest gap: silent devices become
automatable. Stop after it and validate SC-001 and SC-002 in the stack before starting
pull request 2.

### Incremental delivery

Each pull request is complete on merge: runtime, contract cases, Laravel validation,
editor, assistant prompt, Help and docs for its nodes. The catalogue grows by one pull
request at a time, and no merged state has a node the editor or assistant cannot
handle.
