# Implementation Plan: Alert Limits on Charts

**Branch**: `spec/037-alert-limits-on-charts` | **Date**: 2026-11-22 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/037-alert-limits-on-charts/spec.md`

## Summary

A dashboard's time series panel draws the value at which a running automation raises an
alert on the reading it shows, taken from the automation and never typed into the
panel. Alert periods also appear for every device an automation reads, not only the
first.

The approach, from [research.md](research.md):

- Laravel works the limits out by walking the applied deployment's stored graph. The
  runtime, the automation contract and how automations are evaluated do not change.
- One new read endpoint returns the limits for a set of devices. A shared fixture in
  `contracts/` is tested by both the PHP resolver and the Go evaluator, so the two
  agree on what each node means.
- The alert device fix fills the list alerts already have
  (`automation_alert_devices`) with every device a deployment reads, and backfills it.
  No alert query changes.
- The portal asks once per dashboard, draws up to 8 lines per panel in a style of
  their own, and lists every limit in the panel's legend. One optional panel setting
  turns them off.

## Technical Context

**Language/Version**: PHP 8.4 (Laravel 13); TypeScript with React 19; Go 1.27 (one
test only)

**Primary Dependencies**: `Domain/Automation` and `Domain/Dashboards` in `apps/api`;
`@iot-os/charts` (ECharts), `@iot-os/ui`, `@iot-os/api-client`, TanStack Query in
`apps/portal`. No new dependency.

**Storage**: PostgreSQL 17. No new table or column. One data migration adds rows to
`automation_alert_devices`.

**Testing**: feature tests in `apps/api/tests/Feature/Domain/Automation` and
`.../Dashboards`, run on PostgreSQL in CI; Vitest in `apps/portal` and
`packages/charts`; Playwright in `apps/portal/e2e`; `go test` in
`services/runtime/internal/dag`; `tooling/verify-devices-contracts.py` and
`php artisan contract:check` for contracts.

**Target Platform**: the existing API and portal containers. The runtime image is not
rebuilt: its only change is a test.

**Project Type**: web application (Laravel API, React portal) in the existing monorepo.

**Performance Goals**: readings draw no later than today; limits appear within two
seconds of them (SC-004). One limits request per open dashboard every 45 seconds.

**Constraints**: saved dashboards are not rewritten (FR-020). A limit that cannot be
placed exactly is left out (FR-007). Open dashboards follow an automation within one
minute (FR-016). Queries stay portable to the local SQLite test database.

**Scale/Scope**: up to 100 device identifiers per request; an organization's applied
automations are expected in the tens to low hundreds (to be measured, research R4);
at most 8 lines per panel. Three implementation pull requests.

## Constitution Check

*GATE: checked before research and again after design. No violations.*

| Principle | How the plan meets it |
| --- | --- |
| I. Laravel owns intent; Go executes | The limits are served by Laravel from its own data. The portal never talks to the runtime, and Laravel evaluates no rule: it reads thresholds out of a stored graph. |
| II. Immutable versions, explicit activation | Limits come only from the applied deployment. Drafts and pending changes contribute nothing (FR-002). No deployment row is changed. |
| III. Tenant isolation everywhere | The endpoint resolves the organization and checks membership, then `Device.view`. Tests prove another organization gets nothing and that another organization's device identifiers return nothing (FR-023). |
| IV. Contracts first | New fixture and schema under `contracts/rules/v2`, consumed by PHP and Go tests. `packages/api-client` and the OpenAPI description change in the same pull request as the endpoint. |
| V. AI proposes, people approve | No AI surface changes. Panels the assistant creates show limits by default because the setting is absent. |
| VI. Show uncertainty; never invent state | A limit that cannot be placed is not drawn. A suspended automation is named as suspended. Unavailable limits are said to be unavailable, not shown as none (FR-017). |
| VII. Durable, idempotent messaging | The projector's attach is inside the existing inbox transaction and only on first creation; the backfill is idempotent. |
| VIII. One design system | The legend uses kit components, `Status` for suspended, the named type scale; the chart option stays in `packages/charts` with a story. `check-ui` passes. |
| IX. Done means verified where it runs | Each pull request rebuilds the API or portal container and is exercised in the running stack; [quickstart.md](quickstart.md) is the script. |

No ADR is needed: no accepted decision changes, and no new table, service or
dependency is introduced.

## Decisions

Full reasoning is in [research.md](research.md).

| # | Decision |
| --- | --- |
| R1 | Laravel walks the stored definition; the runtime is not asked. |
| R2 | One fixture in `contracts/rules/v2` is tested by PHP and by the Go evaluator. |
| R3 | The walk gives up on arithmetic, two-reading comparisons, count and sum windows, unknown node types and inexact conversions. |
| R4 | One request per dashboard, every 45 seconds, no cache. |
| R5 | Alerts for every device: fill `automation_alert_devices` and backfill it. |
| R6 | The setting is `alert_limits: false`, absent when on. |
| R7 | Limits are their own mark lines; the axis ignores them; the legend lists them all. |
| R8 | The same permission as the alerts list; the link needs `Workflow.view`. |

## Design

### What a deployment reads (API, `Domain/Automation`)

A small service, `DeploymentGraph`, wraps one deployment definition and answers two
questions: which devices it reads (R5), and which alert limits it has (R3). Both the
projector and the limits endpoint use it, so "reads" has one meaning.

### Alerts for every device (API)

- `AlertProjector::project` attaches every read device of the deployment when it
  first creates the alert. Devices are looked up in the automation's organization, as
  today.
- A data migration sets the list of existing workflow alerts to the devices their
  deployments' definitions read, in chunks: missing rows are added and a device the
  automation only commands is removed. Its `down` does nothing: the list is valid for
  the earlier code as well.
- `AlertQuery`'s device and site filters already search the list. Their older match on
  the snapshot's first binding now applies only to an alert that lists no device, so a
  commanded first binding is not matched (FR-026).
- The alert's main device (`device_uuid`, `device_name`) stays the first binding.

### The limits endpoint (API)

`GET /api/v1/organizations/{organization}/workflows/alert-limits?device[]=…`, in the
Automation routes, before the `{workflow}` routes. The contract is
[contracts/alert-limits-api.md](contracts/alert-limits-api.md); the fields are in
[data-model.md](data-model.md).

- Authorizes `DevicePermission::VIEW` in the organization, as `AlertController::index`
  does.
- Loads, in one query, the organization's automations that are not archived and have
  an applied deployment, with that deployment. A deployment with a `stopped_reason` is
  suspended; otherwise it is running.
- Walks each with `DeploymentGraph`, keeps the limits whose device was asked for and
  belongs to the organization, and returns them with the time they were worked out.
- A response resource describes the shape for the OpenAPI export.

### Dashboard definition (API, `Domain/Dashboards`)

The time series allow-list in `DashboardDefinition` gains `alert_limits`, which must be
a boolean. Normalisation drops `alert_limits: true` so "on" is always the absent key.
No other panel type accepts it.

### Portal (`apps/portal`, `packages/charts`, `packages/api-client`)

- **Client**: `alertLimits(org, deviceIds, signal)` and its types in
  `packages/api-client`.
- **Data**: `useAlertLimits` in `dashboards/panelData.ts`. Each panel asks per device,
  as the other panel hooks do, through a small batcher (`createLimitBatcher`) that
  sends the devices asked for within a moment in one request (in chunks of 100), so a
  dashboard still asks once. It refetches every 45 seconds while the page is visible
  and on **Refresh**. As built this replaced a provider in the workspace: it needs no
  wiring through the 1,400-line workspace and covers the panel editor's preview by
  itself. It does not ask when the person lacks
  `capabilities.devices.view`, and treats a refusal as "no limits", not as a failure
  (FR-022a). A failed request is retried once; after that the result is "unavailable"
  with no limits (FR-017a).
- **Model**: pure functions in `dashboards/alertLimits.ts` pick a panel's limits by device
  and parameter, set aside for the legend only those whose unit is not the panel's
  (both come from the parameter's unit, so they differ only if the profile changed
  since; FR-014c), merge those that differ only by device while keeping the devices
  each covers, and choose the 8 to draw (R7). They are unit tested.
- **Chart**: `timeSeriesOption` takes `limits` and draws them as described in R7. The
  existing `thresholds`, `bands`, `areas` and `markers` are untouched.
- **Panel**: `TimeSeriesPanel` passes the limits to the chart and renders the "Alert
  limits" list in the legend: the automation's name (a link to the automation when
  `capabilities.automation.view`), the device or devices the limit covers when the
  panel draws several, the comparison and value, the treatment in words ("10 s
  average", "for 5 min", "with other conditions"), "current rule", and a suspended
  `Status`. A line that belongs to one device of several names it in its label; a
  merged line does not. Limits beyond the axis are marked above or below the chart,
  and limits in another unit as not drawn. When the limits are unavailable no limit
  line is drawn and the list says so.
- **Editor**: a **Show alert limits** switch in the time series panel's Display
  section of `PanelEditor`.
- **Kiosk and phone**: no special case; both use the same panel.

### Documentation

- `docs/features/dashboards.md`: alert limits on time series, what is left out and
  why, the setting.
- `docs/features/automation.md` and `docs/features/alerts.md`: the endpoint under API,
  and that an alert lists every device its automation reads.
- `apps/api/resources/help/dashboards.md` and `alerts.md`: the same in the help
  guides' voice.
- `docs/dev/gotchas.md`: the resolver must learn a new node type before it draws
  through it, and the fixture is where to add the case.
- `contracts/README.md`: the new fixture and schema in the `rules/v2` row.

## Project Structure

### Documentation (this feature)

```text
specs/037-alert-limits-on-charts/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── alert-limits-api.md
├── checklists/
│   └── requirements.md
└── tasks.md             # from /speckit-tasks
```

### Source Code (repository root)

```text
apps/api/
├── app/Domain/Automation/
│   ├── Services/DeploymentGraph.php            # new: read devices, alert limits
│   ├── Services/AlertProjector.php             # attach every read device
│   ├── Http/Controllers/WorkflowController.php # alertLimits action
│   ├── Http/Resources/AlertLimitResource.php   # new
│   └── routes/api.php
├── app/Domain/Dashboards/Services/DashboardDefinition.php
├── database/migrations/…_list_read_devices_on_workflow_alerts.php
└── tests/Feature/Domain/{Automation,Dashboards}/

contracts/
├── rules/v2/alert-limits.schema.json           # new
├── rules/v2/alert-limits.fixture.json          # new
└── openapi/openapi.json                        # regenerated

services/runtime/internal/dag/
└── limits_fixture_test.go                      # new, test only

packages/
├── api-client/src/{index.ts,alerts.ts}
└── charts/src/timeSeries.ts (+ builders.test.ts)

apps/portal/src/dashboards/
├── panelData.ts, model.ts, TimeSeriesPanel.tsx, PanelEditor.tsx,
│   DashboardWorkspace.tsx
└── (tests beside each, e2e/dashboards.spec.ts)

apps/storybook/src/components/Charts.stories.tsx
docs/, apps/api/resources/help/
```

**Structure Decision**: the feature lives in the existing Automation and Dashboards
domains and the existing portal dashboards folder. No new domain, package or service.

## Delivery

The documents merge first, in one pull request. Each implementation pull request is
then cut from `main` after the one before it has merged; none is stacked on another.

| PR | Contents | Stories | Verified by |
| --- | --- | --- | --- |
| Documents | spec, plan, research, data model, contract, quickstart, tasks | | review |
| 1. Alerts for every device | `DeploymentGraph` (read devices), projector, backfill migration, tests, alerts docs | US4 | API container rebuilt; an alert from a two-device automation shades both devices' existing panels |
| 2. Limits endpoint | `DeploymentGraph` (limits), endpoint, resource, schema and fixture, Go fixture test, api-client, OpenAPI, automation docs | US1 to US3 (API part) | API container rebuilt; endpoint called for the quickstart automations |
| 3. Limits on panels | dashboard setting (API allow-list), portal data, model, chart, legend, editor switch, story, e2e, dashboards docs and help | US1, US2, US3, US5 | API and portal containers rebuilt; quickstart end to end; designer's screenshot pass |

Pull request 1 is useful by itself and fixes an existing fault. Pull request 2 changes
nothing people see. Pull request 3 turns the feature on; until it merges, no panel
draws a limit.

## Complexity Tracking

No constitution violations to justify.
