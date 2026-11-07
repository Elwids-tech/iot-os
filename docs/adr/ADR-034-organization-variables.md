# ADR-034: Organization Variables Are Automation Inputs

**Status:** Proposed
**Date:** 2026-11-07
**Relates to:** [ADR-011](ADR-011-dag-automation-in-go.md), [ADR-014](ADR-014-control-plane-data-plane-http-integration.md), [ADR-028](ADR-028-activity-log.md), spec 014 (automation nodes, draft)

## Context

A DAG automation reads two kinds of input: a device parameter binding
(`source.parameter.v1`) and a fixed number (`constant.v1`)
([`registry.go`](../../services/runtime/internal/dag/registry.go),
[`workflow.schema.json`](../../contracts/rules/v2/workflow.schema.json)). A value that
comes from outside the platform can enter only as telemetry, through an HTTP adapter
source (spec 020): it is then stored as readings, charted and retained like a
measurement.

A digital twin publishes KPI targets for machines: a target throughput for a line, a
ceiling for a spindle's vibration. Such a target is not a measurement. An automation
should compare a reading with it, and an operator should be able to change it in the
twin without anyone redeploying the automation. Today the only way is a constant in the
DAG, which means a new deployment per target change, and deployment is a person's act
that no application may perform.

Constitution II makes deployments immutable so behaviour is reproducible; principle VI
forbids inventing state when a value is missing.

## Decision

- **Organization variables.** An organization holds named, typed values. A key
  matches `[a-z0-9][a-z0-9._-]{0,127}`; the first type is `number`. Every write
  creates a new version with the value, the writer (a person or an application) and
  the time, and is recorded in the activity log. Variables are managed in the portal
  under `Workflow.manage` and by applications through
  `PUT /api/integration/v1/organizations/{organization}/variables/{key}` and
  `GET .../variables` with the new abilities `variables:write` and `variables:read`.
- **A DAG node reads one.** `source.variable.v1` binds a variable by key. At
  evaluation it emits the variable's current value; a missing or deleted variable emits
  nothing, and downstream nodes treat that as missing data (spec 014's no-data
  handling), never as zero.
- **The deployment pins the key, not the value.** This is the one place a deployed
  automation's behaviour changes without a new deployment, and it is deliberate: the
  variable is an operator-controlled input in the same sense a parameter is, and its
  versions are the record of what the automation saw. A plan that introduces the node
  records this exception in its constitution check.
- **Variables reach the runtime like definitions.** A write produces a
  `variables.changed.v1` control message through the outbox and `IOT_DEVICE_CONTROL`,
  carrying the organization, key, value and version; the runtime applies a version only
  if it is newer than what it holds. `GET /api/internal/devices/state` carries each
  organization's current variables so a restarted runtime reconciles.

## Consequences

- Contracts: `variables.changed.v1` in `contracts/internal/control`, the variables
  section of the control-state snapshot, and `source.variable.v1` in
  `contracts/rules/v2`, each with fixtures and consumer tests (constitution IV).
- The portal's automation editor gains a Variable source node and a Variables page
  under Automation; the activity log and the admin timeline show variable versions.
- The twin pushes a KPI target on publish only when the KPI's author switched it on;
  the key is the twin's to choose and the platform does not interpret it.
- Reports, when they exist, can cite the variable version in force at any time, which
  is what makes a KPI report auditable.
- A deleted variable does not fail an automation; it makes its comparisons unknown,
  which the alert and event nodes already handle as no data.
