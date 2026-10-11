# ADR-011: Automation Executes as a Typed DAG in the Go Runtime

**Status:** Accepted (recorded retroactively)
**Date:** 2026-10-11; decided during pilot delivery, September–October 2026
**Relates to:** [ADR-002](ADR-002-laravel-control-plane.md), [ADR-003](ADR-003-go-data-plane.md)

## Context

The first rule engine, workflow v1 (`automation-workflow.v1`), accepts exactly
one fixed chain: `location.source.v1 → geofence.membership.v1 →
condition.sustained.v1 → alert.condition.v1`, compiled in Go to
`geofence-rule.v1` ([`rules/workflow.go`](../../services/runtime/internal/rules/workflow.go)).
It was enough for the cattle geofence demo, but customers needed thresholds,
windows, joins across devices, device commands and integration events, authored
visually and with the assistant.

## Decision

General automation is a typed directed acyclic graph, workflow v2
(`automation-workflow.v2`), compiled and executed by the Go runtime
([`services/runtime/internal/dag`](../../services/runtime/internal/dag)).

- **Node registry in Go.** Versioned node types with named, typed ports:
  sources (`source.parameter.v1`, `constant.v1`, `geofence.v1`), maths and
  logic (`math.v1`, `convert.v1`, `compare.v1`, `boolean.v1`, `branch.v1`,
  `hysteresis.v1`), time (`window.v1`, `join.v1`, `sustained.v1`,
  `cooldown.v1`) and actions (`action.alert.v1`, `action.event.v1`,
  `action.command.v1`) ([`registry.go`](../../services/runtime/internal/dag/registry.go)).
  No scripts. The portal reads the registry through the API, so the editor
  never offers a node the runtime cannot execute.
- **Laravel owns** drafts, revisions, layout (revisioned separately from
  semantics), saved scenarios, permissions (`Workflow.view`, `Workflow.manage`,
  `Workflow.activate`, plus `Device.command` for command grants), immutable
  deployment snapshots with exact-value command grants, and action
  authorization ([`Domain/Automation`](../../apps/api/app/Domain/Automation)).
- **Go owns** compilation, evaluation on the committed telemetry stream, windows,
  timers, state and the evaluation timeline. State, timers and action intents
  commit before the broker message is acknowledged.
- **Actions leave Go as intents** (`automation.intent.v1` runtime events) and are
  re-authorized by Laravel's `automation-worker` before anything happens. Device
  commands go through the normal audited command pipeline and are rechecked just
  before dispatch.
- **v2 is opt-in per organization** (`automation_settings.enabled`, default
  false) with an organization-wide emergency stop.

Workflow v1 remains only because geofences use it:
[`GeofenceService`](../../apps/api/app/Domain/Geospatial/Services/GeofenceService.php)
builds one v1 workflow and deployment per geofence assignment. v1 can also still
be created through the API, but no portal screen authors it. v1 is legacy and
will be retired by moving geofences onto v2 (the `geofence.v1` DAG node already
exists).

## Consequences

- One execution path for new automation features; v1 changes are limited to
  keeping geofences working.
- Two engines run side by side on one consumer (`workflow-evaluator-v1` evaluates
  rules and DAGs in one transaction), with different permission models: v1
  endpoints still check `Device.*`, v2 checks `Workflow.*`. The emergency stop
  does not affect v1 geofence rules.
- Some portal screens list only v1 workflows (`GET /workflows`): the Alerts
  workflow filter, the dashboard workflow picker and Settings → Notifications.
  Fixing them is part of retiring v1 ([roadmap](../roadmap.md#next)).
- Bounded memory and history are explicit: 10,000 buffered samples per source
  (exceeding it suspends the execution), 1,000 evaluations per workflow, 1,000
  steps per trace, a 256-plan compile cache.
- A single runtime instance; partitioned execution is future work.
