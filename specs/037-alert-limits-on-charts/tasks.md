---

description: "Tasks for spec 037, alert limits on charts"
---

# Tasks: Alert Limits on Charts

**Input**: Design documents from `/specs/037-alert-limits-on-charts/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md),
[contracts/alert-limits-api.md](contracts/alert-limits-api.md),
[quickstart.md](quickstart.md)

**Tests**: included, because the spec and the constitution require them:

- an isolation test for another organization (FR-023, principle III);
- the fixture shared by the PHP resolver and the Go evaluator, and the OpenAPI drift
  check (FR-009, principle IV);
- verification in the rebuilt stack (principle IX).

API tests run on PostgreSQL in CI. In a worktree, follow the worktree API test recipe:
copy `vendor`, run `composer install`, and use a throwaway `APP_KEY`.

**Organization**: phases follow the pull requests in the plan's **Delivery** section.
Each pull request is based on `main`, opened after the one before it merges, and never
stacked. Story labels map tasks to the spec's user stories (US1 to US5).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task).
- **[Story]**: US1 to US5 from [spec.md](spec.md).
- Paths are from the repository root.
- Every verification task takes the stack rebuild lock (`.local/stack-rebuild.lock`)
  before any `docker compose` build and removes it afterwards.
- Fixtures use the documentation UUID style of `contracts/rules/v2/workflow.fixture.json`
  and no real names.

---

## Phase 1: Documents (documents pull request)

**Purpose**: merge the spec, plan and tasks before any code. Merging accepts the plan.

- [x] T001 Write the spec, research, data model, contract, quickstart, checklist, plan and tasks in specs/037-alert-limits-on-charts/
- [x] T002 [P] Add an **Alert limits on charts** entry under **Dashboards** in docs/roadmap.md, linking specs/037-alert-limits-on-charts/spec.md

**Checkpoint**: documents pull request merged.

---

## Phase 2: User Story 4 - Alert periods appear for every device an automation reads (P2) (pull request 1)

**Goal**: an automation's alert is found, listed and shaded for every device whose
readings it reads.

**Independent Test**: raise an alert from an automation that reads two devices; each
device's panel shades the period and each device's alert list contains it
(quickstart, pull request 1).

- [x] T003 [US4] Create apps/api/app/Domain/Automation/Services/DeploymentGraph.php, built from one deployment `definition` array, with `readDeviceUuids(): list<string>`: for `automation-workflow.v2`, the `device_uuid` of each binding whose `role` is named by `config.binding` of a `source.parameter.v1` node, unique, in binding order; for a geofence definition, its single `binding.device_uuid`; an empty list for a null or malformed definition. A binding named only by `action.command.v1` is not read (research R5)
- [x] T004 [P] [US4] Tests apps/api/tests/Feature/Domain/Automation/DeploymentGraphTest.php for T003: contracts/rules/v2/workflow.fixture.json reads the temperature and pressure devices and not the pump; a geofence definition reads its one device; two source nodes on one binding give the device once; a null definition gives none
- [x] T005 [US4] In apps/api/app/Domain/Automation/Services/AlertProjector.php, when `project()` first creates the alert, attach every device of `DeploymentGraph::readDeviceUuids()` that exists in the automation's organization, in place of the single `boundDevice`; keep `boundDevice` for the bell and notifications, unchanged
- [x] T006 [US4] Create migration apps/api/database/migrations/2026_12_06_000100_list_read_devices_on_workflow_alerts.php: for each deployment that has workflow alerts (`automation_alerts.kind = 'workflow'`), in chunks, work out the read devices from `definition` with the rule of T003 written inline (a migration must not depend on a service class), and `insertOrIgnore` into `automation_alert_devices` one row per alert and device of the alert's organization. Portable to SQLite and PostgreSQL. `down()` does nothing and says why (research R5)
- [x] T007 [P] [US4] Tests apps/api/tests/Feature/Domain/Automation/AlertDevicesTest.php: an alert of a two-device automation is returned by `GET alerts?device=` for each device (FR-025); not for a device the automation only commands (FR-026); its `devices` and `devices_total` list both and `device_uuid` is still the first binding; a device UUID in the definition that is not the organization's is not attached; projecting the same transition twice adds no row; the site filter of `AlertQuery::filtered` finds it by the second device's site (FR-027); offline and gateway alerts filter exactly as before (FR-028)
- [x] T008 [P] [US4] Test in apps/api/tests/Feature/Domain/Automation/AlertDevicesTest.php: an alert stored with only its first device gains the second after the migration (FR-029), and running it again changes nothing
- [x] T009 [US4] Add cases to the device move tests under apps/api/tests/Feature/Domain/Devices/Moves/: moving the second read device of an automation ends its active alert and `MovePreview` counts it, as for the first device (research R5, consequences)
- [x] T010 [US4] Resolve the open check in research.md: search apps/api/app for any path that hard-deletes a device listed in `automation_alert_devices`; if one exists, make it remove the rows as apps/api/app/Domain/Administration/Services/OrganizationDeletion.php does and add a test; record the finding under **Open checks** in specs/037-alert-limits-on-charts/research.md
- [x] T011 [P] [US4] Check how apps/portal/src/alerts/Alerts.tsx and apps/portal/src/alerts/model.ts show `devices` for a workflow alert that now lists several; adjust the wording if it reads wrongly and cover it in the existing alerts tests
- [x] T012 [P] [US4] Document in docs/features/alerts.md and apps/api/resources/help/alerts.md that an automation's alert belongs to every device the automation reads, and not to a device it only commands
- [x] T013 [US4] Verify pull request 1: take the rebuild lock, rebuild `api` and `automation-worker` (the worker is what records an automation's alert), run the migration, and follow quickstart.md **Pull request 1** steps 1 to 6 in the running portal

**Checkpoint**: an alert from a two-device automation shades both devices' panels.

---

## Phase 3: The limits endpoint (US1, US2, US3; pull request 2)

**Goal**: the API returns the alert limits of applied automations for a set of devices.
Nothing people see changes yet.

**Independent Test**: call the endpoint for the quickstart automations and compare with
quickstart.md **Pull request 2**.

- [x] T014 [P] [US2] Add contracts/rules/v2/alert-limits.schema.json and contracts/rules/v2/alert-limits.fixture.json: cases `{ "name", "workflow", "limits" }` covering every row of the **Golden fixture** table in contracts/alert-limits-api.md; each limit has `device_uuid`, `parameter_uuid`, `role` (`raise` | `clear`), `operator` (`gt` | `gte` | `lt` | `lte` | `eq`), `value`, `unit`, `aggregate` (`average` | `min` | `max` | null), `window_seconds` (integer | null), `held_seconds` (integer | null), `combined` (boolean). Add both to the `rules/v2` row of contracts/README.md
- [x] T015 [US1] Add `alertLimits(): list<array>` to apps/api/app/Domain/Automation/Services/DeploymentGraph.php, the walk of research R3: from each `action.alert.v1` upstream; `sustained.v1` adds to `held_seconds`; `cooldown.v1` passes; `boolean.v1` sets `combined` and follows both inputs; `branch.v1` passes and inverts from its `false` port (`gt`↔`lte`, `gte`↔`lt`; a hysteresis there is left out); `compare.v1` gives one `raise` limit; `hysteresis.v1` gives `raise` `gt` `activate_above` and `clear` `lt` `clear_below`; then the numeric input through `join.v1` (same port), at most one `window.v1` with `min`, `max` or `average`, `convert.v1` undone on the value (rounded to 10 significant digits), to a `source.parameter.v1` binding with `data_type` `number`. Give up on the branch for `math.v1`, `constant.v1`, `geofence.v1`, a `count` or `sum` window, a second window, a conversion whose `from` is not the binding's unit or whose units are of different families, an inverted `eq`, and any node type not listed here (FR-003 to FR-008)
- [x] T016 [P] [US2] Test apps/api/tests/Feature/Domain/Automation/AlertLimitsFixtureTest.php: `DeploymentGraph::alertLimits()` returns exactly `limits` for every case of contracts/rules/v2/alert-limits.fixture.json (SC-002)
- [x] T017 [P] [US2] Test services/runtime/internal/dag/limits_fixture_test.go: load ../../../../contracts/rules/v2/alert-limits.fixture.json; for the direct, inverted, hysteresis and converted cases, run the evaluator with a reading just either side of each limit and assert the alert is raised or cleared as the case says; no runtime code other than this test changes (FR-009, FR-030, research R2)
- [x] T018 [US1] Add `GET alert-limits` to apps/api/app/Domain/Automation/routes/api.php before the `{workflow}` routes, `WorkflowController::alertLimits` in apps/api/app/Domain/Automation/Http/Controllers/WorkflowController.php and apps/api/app/Domain/Automation/Http/Resources/AlertLimitResource.php: validate `device` as a required list of 1 to 100 UUIDs; authorize `DevicePermission::VIEW` in the organization as `AlertController::index` does; load in one query the organization's automations that are not archived and have `applied_deployment_uuid`, with that deployment; `state` is `suspended` when the deployment has a `stopped_reason`, else `running`; keep limits whose device was asked for and is the organization's; order by device, parameter, automation name, value; return `data` and `meta.checked_at` (FR-001, FR-002, contracts/alert-limits-api.md)
- [x] T019 [P] [US1] Tests apps/api/tests/Feature/Domain/Automation/AlertLimitsTest.php for every row of the **States** table in data-model.md (draft, activation pending with nothing applied, applied, change pending over an applied deployment, suspended, deactivated, archived), a geofence rule giving none, the order, each `422`, and a bounded query count with 200 applied automations
- [x] T020 [US1] Add isolation and permission cases to apps/api/tests/Feature/Domain/Automation/AlertLimitsTest.php: a member of another organization is refused; another organization's device UUID returns no rows and no automation name or identifier (FR-023, SC-007); a member without `Device.view` is refused; a member with `Device.view` and without `Workflow.view` gets the rows (FR-022)
- [x] T021 [US1] Add the `AlertLimit` type to packages/api-client/src/alerts.ts and `alertLimits(org, deviceIds, signal)` to packages/api-client/src/index.ts
- [x] T022 [US1] Run `php artisan contract:export` in apps/api and commit contracts/openapi/openapi.json; `php artisan contract:check` passes
- [x] T023 [P] [US1] Document the endpoint under **API** in docs/features/automation.md with what is left out and why, and add to docs/dev/gotchas.md that a new node type draws nothing until `DeploymentGraph` and contracts/rules/v2/alert-limits.fixture.json learn it
- [x] T024 [US1] Measure the endpoint with 200 applied automations and 100 devices on PostgreSQL and record the result under R4 in specs/037-alert-limits-on-charts/research.md; if it cannot meet SC-004, narrow the query to deployments that bind the asked devices before going on
- [x] T025 [US1] Verify pull request 2: take the rebuild lock, rebuild `api`, and follow quickstart.md **Pull request 2** steps 1 to 5

**Checkpoint**: the endpoint answers for running and suspended automations and nothing
for another organization.

---

## Phase 4: User Story 1 - See the running alert limit on a chart (P1) 🎯 MVP (pull request 3)

**Goal**: a time series panel draws and lists the limits of the parameters it shows.

**Independent Test**: with a simple automation running, a panel of that parameter shows
a labelled line and a legend row with nothing typed into the panel (quickstart, pull
request 3, steps 1, 2, 4 and 8).

- [ ] T026 [US1] Add `useAlertLimits` and an `AlertLimitsProvider` to apps/portal/src/dashboards/panelData.ts and mount the provider in apps/portal/src/dashboards/DashboardWorkspace.tsx: collect the device UUIDs of time series panels that have a numeric source and do not set `alert_limits: false`, from the saved dashboard and the draft being edited; ask `alertLimits` in chunks of 100; refetch every 45 seconds while the page is visible; retry a failed request once, then expose "unavailable" with no limits until a request succeeds (FR-017a); do not ask when `organization.capabilities.devices.view` is false, and treat a refused request as no limits and not as unavailable (FR-022a); expose the limits and whether they are unavailable (research R4, R8)
- [ ] T027 [P] [US1] Add pure functions to apps/portal/src/dashboards/model.ts with tests in apps/portal/src/dashboards/model.test.ts: a panel's limits by device and parameter; setting aside, for the legend only, those whose `unit` is not the source's (FR-014c); merging limits that differ only by device while keeping the list of devices each covers; choosing at most 8 to draw, nearest the range of the drawn values, ties by value (FR-015); the label text, for example "Pump safety > 25 °C", with the device's name added when the panel draws more than one device and the line belongs to one of them, and no device on a merged line (FR-010)
- [ ] T028 [P] [US1] Add `limits` to `TimeSeriesInput` in packages/charts/src/timeSeries.ts: mark lines in the warning colour with a dash pattern and stroke different from `thresholds`, and a dotted, lighter style for `clear`; the value axis is not given the limits (FR-011, FR-012, FR-013). Cover in packages/charts/src/builders.test.ts that `thresholds`, `bands`, `areas` and `markers` come out unchanged, and add a case to apps/storybook/src/components/Charts.stories.tsx
- [ ] T029 [US1] Confirm in the story of T028 that a limit outside the value axis is not drawn and does not widen the axis; if ECharts behaves otherwise, filter such limits out before the chart and record the finding under R7 in specs/037-alert-limits-on-charts/research.md
- [ ] T030 [US1] In apps/portal/src/dashboards/TimeSeriesPanel.tsx pass the chosen limits to the chart and add an "Alert limits" list to the legend: the automation's name, the device or devices the limit covers when the panel draws more than one device (up to three names, then a count), the comparison and the value with its unit, and "current rule"; list every limit, including those not drawn, and mark a limit in another unit as not drawn with its own unit (FR-010, FR-014, FR-014c)
- [ ] T031 [US1] Expose the value-axis extent after layout from packages/charts/src/EChart.tsx and use it in apps/portal/src/dashboards/TimeSeriesPanel.tsx to mark legend rows whose limit is above or below the chart
- [ ] T032 [US1] In the legend of apps/portal/src/dashboards/TimeSeriesPanel.tsx make the automation's name a link to `/organizations/{org}/automation/{uuid}` when `organization.capabilities.automation.view` is true, and plain text otherwise (FR-014b, FR-024)
- [ ] T033 [P] [US1] Tests in apps/portal/src/dashboards/panelData.test.ts for the device collection of T026: panels with the setting off and non-numeric sources are left out, duplicates are asked once, more than 100 devices are chunked, nothing is asked without the device view capability, a refused request gives no limits and is not unavailable, and a request that fails twice gives unavailable with no limits

**Checkpoint**: a running automation's limit is drawn and listed on its panel.

---

## Phase 5: User Story 2 - A line is drawn only where it is true (P1) (pull request 3)

**Goal**: labels say how the reading is treated, and a suspended automation is named
without a line.

**Independent Test**: quickstart, pull request 3, steps 5 to 7.

- [ ] T034 [P] [US2] Add the treatment wording to apps/portal/src/dashboards/model.ts with tests: "10 s average", "minimum over 1 min", "maximum over 1 min", "for 5 min", "with other conditions"; for hysteresis, which value raises the alert and which clears it (FR-005, US1 scenario 3)
- [ ] T035 [US2] Show the treatment in the line label and the legend row in apps/portal/src/dashboards/TimeSeriesPanel.tsx
- [ ] T036 [US2] Never pass a `suspended` limit to the chart; list it in the legend with the kit's `Status` and the words "suspended, not checking" (FR-002a, FR-014a), in apps/portal/src/dashboards/TimeSeriesPanel.tsx and apps/portal/src/dashboards/model.ts with a test

**Checkpoint**: every condition in the quickstart draws a correctly labelled line or
none.

---

## Phase 6: User Story 3 - Limits follow the automation (P2) (pull request 3)

**Goal**: open dashboards follow activations and failures are stated.

**Independent Test**: quickstart, pull request 3, steps 3 and 11.

- [ ] T037 [US3] When the limits are unavailable (a request and its one retry failed), draw no limit lines and show "Alert limits are unavailable" in the legend of apps/portal/src/dashboards/TimeSeriesPanel.tsx until a request succeeds; readings, panel thresholds and alert periods are drawn as usual and do not wait for limits (FR-017, FR-017a)
- [ ] T038 [US3] Add cases to apps/portal/e2e/dashboards.spec.ts with the alert limits route mocked: a limit is listed and labelled; a changed response moves it without a reload (FR-016); a deactivated automation removes it; a suspended one is listed as suspended; a request that fails twice removes the lines and says unavailable, and one failure followed by a successful retry leaves the line (FR-017a); a person without the device view capability sees no limits and no message (FR-022a); two devices sharing one limit give one legend row naming both; the name is a link only with the automation view capability

**Checkpoint**: an open dashboard follows an automation within a minute.

---

## Phase 7: User Story 5 - Turn alert limits off for a panel (P3) (pull request 3)

**Goal**: one optional panel setting, absent when on.

**Independent Test**: quickstart, pull request 3, steps 9 and 10.

- [ ] T039 [US5] In apps/api/app/Domain/Dashboards/Services/DashboardDefinition.php accept `alert_limits` on time series panels only; it must be a boolean; normalise `true` to the absent key (research R6, data-model.md)
- [ ] T040 [P] [US5] Tests in apps/api/tests/Feature/Domain/Dashboards/SaveDashboardTest.php: `alert_limits: false` is saved on a time series panel; `true` is stored as the absent key; a non-boolean is refused; every other panel type refuses the key; a dashboard saved without the key reads back unchanged (FR-020, SC-006)
- [ ] T041 [US5] Add `alert_limits?: boolean` to the time series config type in packages/api-client/src/dashboards.ts and a **Show alert limits** switch, on by default, to the time series panel's Display section in apps/portal/src/dashboards/PanelEditor.tsx; turning it on removes the key (FR-019)
- [ ] T042 [US5] Honour the setting in apps/portal/src/dashboards/TimeSeriesPanel.tsx: no limit lines and no "Alert limits" list when off
- [ ] T043 [P] [US5] Tests in apps/portal/src/dashboards/importExport.test.ts and apps/portal/src/dashboards/templates.test.ts that the key survives export, import and a template copy, and that no limit is ever written to a dashboard (FR-021)
- [ ] T044 [US5] Run `php artisan contract:export` in apps/api and commit contracts/openapi/openapi.json if the dashboard definition's description changed; `php artisan contract:check` passes

**Checkpoint**: one panel can turn its limits off; saved dashboards are untouched.

---

## Phase 8: Polish and verification (pull request 3)

- [ ] T045 [P] Document alert limits in docs/features/dashboards.md (what is drawn, what is left out and why, the legend, the setting) and in apps/api/resources/help/dashboards.md in the help guides' voice, without the product's name (FR-031)
- [ ] T046 Run `pnpm --filter @iot-os/portal lint`, `pnpm --filter @iot-os/portal test`, `./taskw lint` and `./taskw test`
- [ ] T047 Verify pull request 3: take the rebuild lock, rebuild `api` and `portal`, and follow quickstart.md **Pull request 3** steps 1 to 13 in the running portal, keeping any unsaved edits in open tabs
- [ ] T048 Have the line styles and the legend reviewed from screenshots of quickstart steps 1, 2, 5, 7 and 12 (light and dark themes, phone width, kiosk mode); apply the findings, rebuild and re-check (FR-011, FR-018)
- [ ] T049 Measure SC-004 in the rebuilt stack (quickstart.md **Pull request 3** step 14): on a dashboard with 20 time series panels, readings appear no later with alert limits on than off, and limits appear within two seconds of them; record the timings under R4 in specs/037-alert-limits-on-charts/research.md

**Checkpoint**: the feature is on and verified in the running stack.

---

## Dependencies & Execution Order

- **Documents** (T001, T002) first.
- **Pull request 1** (T003 to T013) after the documents.
- **Pull request 2** (T014 to T025) after 1: it adds to the `DeploymentGraph` that pull
  request 1 creates.
- **Pull request 3** (T026 to T049) after 2: it needs the endpoint and the client.

Within pull request 1: T003 before T005; T005 and T006 before T007 to T009; T013 last.

Within pull request 2: T014 before T015 to T017; T015 before T018; T018 before T019 to
T022 and T024; T025 last.

Within pull request 3: T026 to T028 before T030; T030 before T031, T032, T035 to T037
and T042; T039 before T040 and T041; T047 to T049 last.

## Parallel Example: pull request 3

```text
Together at the start: T027 (model), T028 (chart), T033 (data tests), T039 (API setting)
After T030: T031 (off the chart), T032 (link), T035 + T036 (treatment, suspended)
Tests and docs together: T038, T040, T043, T045
```

## Implementation Strategy

- **MVP**: the documents, then pull requests 1 to 3 as far as Phase 4. Pull request 1
  ships by itself and fixes an existing fault. Pull request 2 changes nothing people
  see. Phase 4 of pull request 3 is the first point at which a panel draws a limit.
- Phases 5 to 7 are in the same pull request as Phase 4 because a line without its
  treatment label, or without the suspended state, would mislead (principle VI).
- Nothing ships to the pilot without the owner's approval.

---

## Phase 9: Convergence

- [ ] T050 After pull request 3 merges, run `/speckit-converge`, add any unbuilt work here, and mark the **Alert limits on charts** entry in docs/roadmap.md as built
