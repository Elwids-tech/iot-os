# Automation

Automations evaluate committed telemetry in the Go runtime and act on it: raise an
alert, emit an integration event, or send a device command. There are two engines
([ADR-011](../adr/ADR-011-dag-automation-in-go.md)):

- **DAG automation (workflow v2)**: general typed graphs authored in the visual
  editor. Use this for anything new.
- **Geofence rules (workflow v1)**: the fixed geofence chain that **Locations →
  Geofences** creates behind the scenes. Legacy; kept until geofences move to v2.

Alerts, notifications and the event log are in [alerts](alerts.md).

Code: Laravel [`Domain/Automation`](../../apps/api/app/Domain/Automation) and
[`Domain/Geospatial`](../../apps/api/app/Domain/Geospatial); runtime
[`internal/dag`](../../services/runtime/internal/dag),
[`internal/rules`](../../services/runtime/internal/rules),
[`internal/location`](../../services/runtime/internal/location),
[`internal/storage`](../../services/runtime/internal/storage); editor
[`packages/workflow-editor`](../../packages/workflow-editor); portal
[`src/automation`](../../apps/portal/src/automation),
[`src/geospatial`](../../apps/portal/src/geospatial). Contracts:
[`contracts/rules`](../../contracts/rules), [`contracts/location`](../../contracts/location).

## DAG automation

### Turning it on

DAG automation is an opt-in preview per organization (`automation_settings.enabled`,
default off). **Build → Automations** offers **Enable automation preview** to users
with `Workflow.activate`. The same settings hold the organization **emergency
stop**, which blocks activation and cancels every pending action (commands, alerts
and events). The stop does not affect geofence rules.

### Authoring

The editor ([`@iot-os/workflow-editor`](../../packages/workflow-editor), React
Flow) shows the node catalogue from the runtime's registry (`GET
workflows/dag/node-types`). Node cards are one header row (icon and the node's
name, or its kind when unnamed) and a summary of the configured value, such as
"Brightness > 80 %" or "RGB LED · alarm on, volume 20 %"; device and parameter
names come from `workflows/dag/resources`. A side with one port has an unlabelled
handle on the card edge; Geofence, Arithmetic, Boolean logic, Correlate inputs and
Branch keep labelled port rows. **Arrange** lays columns out by graph depth from
the measured card sizes and lines each card up with its inputs. Type IDs are under
**Technical details** in the docked settings panel. If the catalogue is
unavailable, existing graphs stay viewable but nodes cannot be added.

| Group | Nodes |
| --- | --- |
| Sources | `source.parameter.v1` (an applied device parameter), `constant.v1`, `geofence.v1` |
| Maths and logic | `math.v1`, `convert.v1`, `compare.v1`, `boolean.v1`, `branch.v1`, `hysteresis.v1` |
| Time | `window.v1`, `join.v1`, `sustained.v1`, `cooldown.v1` |
| Actions | `action.alert.v1`, `action.event.v1` (integration event), `action.command.v1` (Set device state) |

Graph limits: 2–100 nodes, 200 edges, 32 device bindings, at least one action and
at most one alert action ([`compiler.go`](../../services/runtime/internal/dag/compiler.go)).
Validation is side-effect free (`POST workflows/dag/validate`). Layout (positions)
is revisioned separately from the graph, so moving nodes never changes behaviour.

**Set device state** renders the chosen device's applied profile (switches,
choices, colour, sliders, numbers). Tick **Set <parameter>** for each value to
change; each ticked setting becomes its own command intent with its own grant.
Settings dispatch independently: not atomic, no ordering guarantee.

### Semantics

- One execution covers the explicitly bound devices; there are no dynamic device
  groups.
- Ports are named and typed. Joining branches from different sources needs a
  `join` node. Unknown, false and skipped stay distinct. Arithmetic has no
  scripting; compound units are rejected.
- Windows use observed time with UTC epoch alignment: duration 1–86,400 s, slide
  divides duration, at most 100 overlapping windows, lateness 0–3,600 s. Averages
  are arithmetic means of samples. Partial windows after activation are skipped and
  minimum sample counts are mandatory. Closed windows never reopen.
- Freshness is explicit. Invalid, historical, future and pre-activation readings
  never create fresh evidence. Unknown does not clear an active alert.
- State, timer deadlines and intent identities commit in the same transaction as
  the consumer checkpoint, before the broker acknowledgement. A restart resumes
  from the database.
- Bounds: 10,000 buffered samples per source (exceeding it suspends the execution
  visibly), 1,000 steps per trace, 1,000 evaluations kept per workflow, a 256-plan
  compile cache.

### Testing before activation

- **Simulate** runs the exact saved revision against synthetic steps and a
  synthetic clock; nothing live happens.
- **Saved test scenarios** (Simulation tab) are named, timed steps with
  expectations. Each starts at 0 s on a deterministic clock (2030-01-01 UTC); a
  step advances time or sends one complete message from one bound device. Every
  action node expects zero requests unless you say otherwise; output checks name a
  node and port and a value or unknown. Limits: 50 scenarios per workflow, 100
  steps over seven simulated days, the latest 20 runs kept. Runs record the
  workflow and scenario revisions they tested.

### Activation and grants

`POST workflows/{workflow}/deployments` takes an operation UUID, target state
(`active` or `inactive`), draft revision and expected generation. A 202 means
pending; the runtime acknowledges asynchronously. Retries must reuse the complete
original request.

Activation needs **one command grant per command setting**: node, binding, exact
value, cooldown, maximum per minute and expiry. Grants approve exact values, not
ranges, and need `Device.command`. Deployments and grants are immutable.

### Execution and actions

The **Execution** tab shows state, the latest node trace, timers, consumer health
and a timeline (polls every five seconds, 20 entries per page). Each evaluation
records its trigger (telemetry or timer), deployed generation and revision, inputs,
outputs and why steps were false, unknown, suppressed or triggered. Editing a
draft never rewrites history. **Explain this execution** opens the assistant on a
stored snapshot of that evaluation ([assistant](assistant.md#automation-assistant)).

Actions leave the runtime as `automation.intent.v1` events.
`automation-worker` ([`DagActions`](../../apps/api/app/Domain/Automation/Services/DagActions.php))
re-checks the organization stop, the exact deployment, the deploying user's
`Workflow.activate` and `Device.command`, grants, binding generation, deadlines
and per-target limits, then:

- **Alert**: opens or clears the workflow's alert episode ([alerts](alerts.md)).
  One alert lifecycle per graph; the first binding is the device shown in alert
  and integration views.
- **Event**: journals `automation.triggered.v1` for webhook subscribers.
- **Command**: goes through the normal command pipeline. Just before dispatch the
  runtime re-checks approval with `POST /api/internal/devices/automation-command-check`;
  if Laravel is unreachable it fails closed.

Command outcomes: accepted, dispatched, observed at target, failed, expired,
uncertain. **Uncertain or timed-out delivery stops further automated commands to
that parameter** until someone reconciles it (`POST
workflows/dag/commands/{command}/reconcile`) with a note and a fresh observation at
the target. Disabling, replacing or stopping cancels pending intents; after the
dispatch boundary a command may already have reached the device.

### API

Under `/api/v1/organizations/{organization}/workflows`
([routes](../../apps/api/app/Domain/Automation/routes/api.php)):

| Endpoint | Purpose | Permission |
| --- | --- | --- |
| `GET dag/node-types`, `GET dag`, `GET {w}`, `GET dag/resources`, `GET dag/health` | Registry, directory, read, bindable parameters (`controllable=1` also needs `Device.command`), consumer health | `Workflow.view` |
| `POST dag/validate`, `POST /`, `PUT {w}`, `PUT {w}/layout`, `POST {w}/simulate`, scenario writes and runs | Authoring and testing | `Workflow.manage` |
| `POST {w}/deployments`, `PUT dag/settings`, `POST dag/commands/{c}/reconcile` | Activation, preview and emergency stop, reconciliation | `Workflow.activate` |
| `GET {w}/execution`, `{w}/actions`, `{w}/timeline`, `{w}/timeline/{evaluation}` | Runtime state, action outcomes, timeline | `Workflow.view` (execution: `Device.view`) |

Organization Admin has all three `Workflow.*` permissions; Moderators and Members
have `Workflow.view`.

Reference graph: [`contracts/rules/v2/workflow.fixture.json`](../../contracts/rules/v2/workflow.fixture.json).

## Geofences and location

### Location bindings

A **location binding** says which applied configuration parameters are a device's
latitude, longitude (unit `deg`) and optional accuracy (`m`), with freshness
(`max_age_seconds`, default 90) and clock-skew limits (`max_future_skew_seconds`,
default 5) and whether unknown accuracy is allowed (`PUT location-bindings/{device}`).
Each save sends the binding's `revision` (0 for a new one); a stale revision gets 409.

In the portal, the device **Overview → Location** card says whether the location is
saved. When the applied profile has parameters whose keys end in latitude and
longitude, **Save location** saves them with the defaults; **Edit**, or **Set up
location** when only the `deg` units suggest coordinates, opens a sheet to choose the
parameters and limits. The sheet refuses coordinates that aren't in `deg` and
accuracy that isn't in `m`, because the runtime would never resolve a fix from them.
The GPS map panel editor lists devices that report coordinates but have no saved
location and sets them up in place. Both need device management.

The runtime resolves one committed event at a time into a **location fix**
([`location.Resolve`](../../services/runtime/internal/location)):

- Both coordinates must come from the same event with equal timestamps and
  provenance, be good quality, in range and in degrees. Values from different
  events are never combined, and there is no fallback to an older event.
- GPS requires `timestamp_source: source`; receipt-time fallbacks, corrected clocks,
  derived and legacy values give an unknown fix.
- Historical fixes can show a point but are never live-eligible.
- Unknown fixes have no point and never imply a safe location.

### Geofences

**Locations → Geofences** draws polygons on a MapLibre map and assigns them to
devices with location bindings. Saving creates one activation batch: for each
assignment, a v1 workflow named "{fence} — {device}" is compiled, saved and
deployed; removed assignments are disabled
([`GeofenceService`](../../apps/api/app/Domain/Geospatial/Services/GeofenceService.php)).
A saved geofence is always reported as saved: an item the runtime rejects, or that
cannot be requested (its device or assignment is gone, or the runtime is
unreachable), is marked failed with a diagnostic, the other items are still
requested, and failed items can be retried. Coordinates and policy values sent as
numeric strings are stored as numbers. Writes need `Device.manage` and
`Device.activate`; reads need `Device.view`. Map style: set `IOT_MAP_STYLE_URL`
(Docker) or `VITE_MAP_STYLE_URL`; without it development uses the OpenStreetMap
raster fallback with attribution.

Polygon rules (`geofence-rule.v1`): GeoJSON `[longitude, latitude]`, one closed
simple ring of 3–256 vertices, no holes or self-intersections, at least 1 m² and
1 cm edges, at most one degree across, latitudes within ±75°, no dateline or polar
regions. Membership uses a local equirectangular projection; the uncertainty band
is the larger of the configured buffer and reported accuracy, and a point inside
the band is unknown.

Each geofence rule:

- emits **entered / exited** membership transitions, and
- emits **activated / cleared** transitions when the device has been outside for
  the configured duration and sample count (activated) or is seen inside again
  (cleared). Missing, stale or uncertain fixes reset pending evidence and never
  clear an active episode.

Activated/cleared transitions become alert episodes; all four become integration
events (`geofence.entered.v1`, `geofence.exited.v1`,
`geofence.wandering_started.v1`, `geofence.wandering_resolved.v1`)
([events](../reference/events.md#integration-events)). Machine clients can manage
geofences through the integration API ([integrations](integrations.md)).

### Geofence rule execution

Geofence deployments use the same outbox, generation fencing and acknowledgement
as DAGs. Changing the device's configuration or generation suspends the rule
(`binding_changed`) until it is activated against the new binding; replacing or
disabling freezes it (`superseded`, `disabled`) without inventing a clear. A new
execution starts unknown; episodes are not carried across versions.

The v1 endpoints (`GET/POST /workflows`, `PUT {w}`, `simulate`, `deployments`,
`transitions`) still check `Device.view`, `Device.manage` and `Device.activate`,
not `Workflow.*`. Hand-authoring v1 graphs is possible only through the API.
`GET /workflows?kind=all` also lists DAG automations, for Settings → Notifications
and the Alerts workflow filter ([alerts](alerts.md#per-workflow-recipients)). Saving or
activating never turns on email; once a saved draft has an alert node, **Alert email** in
the editor header (and a link in the activation review) opens its recipients.

## Shared runtime behaviour

Both engines run in one durable consumer, `workflow-evaluator-v1`, on
`IOT_COMMITTED_TELEMETRY`. Each message's rule state, DAG state, transitions,
intents and the stream checkpoint commit together, then the message is
acknowledged; redelivery after commit is a no-op. Timers are rebuilt from stored
state after a restart; there is no in-memory-only timer.

The checkpoint records the stream's identity. If the stream is replaced or
retention drops unevaluated readings, the runtime **pauses automation only**
(devices, history and commands keep working), the portal shows "Automations are
paused", and an operator must accept the gap with
`php artisan devices:recover-workflow-checkpoint --reason="..."`
([incident runbook](../ops/incident-runbook.md#workflow-checkpoint-recovery)).
