# Data Model: Alert Limits on Charts

**Date**: 2026-11-22 | **Plan**: [plan.md](plan.md)

Nothing new is stored. One value is worked out on request, one existing list gets more
rows, and one panel setting is added.

## Alert limit (worked out, never stored)

One limit is one value on one device parameter, from one applied deployment.

| Field | Type | Meaning |
| --- | --- | --- |
| `workflow_uuid` | uuid | The automation. |
| `workflow_name` | string | Its name now. |
| `state` | `running` \| `suspended` | `suspended` when the applied deployment has a stop reason. |
| `device_uuid` | uuid | The device whose reading is compared. |
| `parameter_uuid` | uuid | The parameter. |
| `role` | `raise` \| `clear` | Whether crossing this value raises the alert or clears it. `clear` comes only from a hysteresis condition. |
| `operator` | `gt` \| `gte` \| `lt` \| `lte` \| `eq` | The side of the value on which the alert is raised (for `clear`: on which it clears), after any inversion. |
| `value` | number | In the parameter's own unit, rounded to 10 significant digits when a conversion was undone. |
| `unit` | string | The binding's unit, as the automation stores it. |
| `aggregate` | `average` \| `min` \| `max` \| null | The window treatment before comparing; null when the reading is compared directly. |
| `window_seconds` | integer \| null | The window's length; null with `aggregate`. |
| `held_seconds` | integer \| null | How long the condition must hold before the alert is raised; the sum of the hold durations on the path. |
| `combined` | boolean | True when the alert also depends on another condition. |

**Identity**: `workflow_uuid`, `device_uuid`, `parameter_uuid`, `role`, `operator`,
`value`, `aggregate`, `window_seconds`. One automation can give several limits on one
parameter.

**Rules**

- Only from the deployment named by `applied_deployment_uuid` of an automation that is
  not archived (FR-002).
- Only on a path that ends in an alert action (FR-003).
- Left out when it cannot be placed exactly (FR-007); see research R3 for the list.
- `suspended` limits are returned and are never drawn as lines (FR-002a).

## Read devices of a deployment (worked out)

The devices of the bindings named by a deployment's parameter source nodes, or the
single bound device of a geofence rule. A binding used only to send a command is not
read.

## Alert device list (existing table `automation_alert_devices`)

| Column | Meaning |
| --- | --- |
| `automation_alert_id` | The alert. |
| `device_id` | A device the alert concerns. |

**Change**: for a workflow alert the list now holds every read device of its
deployment that exists in the alert's organization, where it held the first binding
only. Existing alerts are backfilled. The primary key already prevents duplicates.

## Time series panel setting (dashboard definition)

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `config.alert_limits` | boolean, optional | absent, meaning on | `false` turns alert limits off for the panel. |

**Rules**

- Accepted only on time series panels.
- `true` is normalised to the absent key, so a saved dashboard never gains it.
- The limits themselves are never part of a dashboard (FR-021).

## States

An automation's limits follow its deployment:

| Automation | Limits returned |
| --- | --- |
| Draft, never activated | none |
| Activation pending, nothing applied | none |
| Applied and running | `running` |
| Change pending over an applied deployment | `running`, from the applied one |
| Suspended | `suspended`, from the applied one |
| Deactivated or archived | none |
