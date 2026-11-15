# ADR-044: Geofence Rules Join DAG Automation in Stages, Location Semantics First

**Status:** Proposed
**Date:** 2026-11-14
**Amends:** [ADR-011](ADR-011-dag-automation-in-go.md) (how and when workflow v1 is retired)
**Relates to:** [ADR-025](ADR-025-review-follows-current-birth.md), [ADR-027](ADR-027-adapter-fed-activation-and-applied-generation.md), [ADR-042](ADR-042-store-telemetry-once.md)

## Context

The runtime has two automation engines. Geofence rules (workflow v1,
[`internal/rules`](../../services/runtime/internal/rules)) are one fixed chain per
geofence and device. DAG automations (workflow v2,
[`internal/dag`](../../services/runtime/internal/dag)) are general graphs.
[ADR-011](ADR-011-dag-automation-in-go.md) says v1 "will be retired by moving
geofences onto v2 (the `geofence.v1` DAG node already exists)", and the
[roadmap](../roadmap.md#next) repeats it. An architecture review recommended doing
that now.

This record is the investigation that has to come first. It asks what a geofence
rule does that a DAG with a `geofence.v1` node does not, what the two engines
really duplicate, and how running rules and their open alerts would be carried over.
Nothing here is built.

### What is already shared

Less is duplicated than "two engines" suggests.

| Concern | Today |
| --- | --- |
| Consumer, checkpoint, deduplication | One. `workflow-evaluator-v1` reads the committed stream; [`ConsumeRuleTelemetry`](../../services/runtime/internal/storage/rules.go) evaluates rules, then DAGs, and moves `rule_checkpoint` in one transaction. `rule_inputs` deduplicates for both |
| Deployment fencing | One table, `rule_heads` (generation, operation, last outcome), used by both `DeployRule` and [`DeployDAG`](../../services/runtime/internal/storage/dag.go) |
| Deployment outcome | One event, `workflow.deployment.v1`, and one handler, [`WorkflowDeploymentService::event`](../../apps/api/app/Domain/Automation/Services/WorkflowDeploymentService.php), which also handles `workflow.suspended.v1` for both |
| Deployment pointers | One place, [`Workflow`](../../apps/api/app/Domain/Automation/Models/Workflow.php) (`deploymentRequested`, `deploymentSucceeded`, `deploymentRefused`, `executionSuspended`) |
| Polygon geometry | One. The DAG node calls [`rules.SpatialCondition`](../../services/runtime/internal/rules/spatial.go) |
| Alert episodes | One projector, [`AlertProjector::project`](../../apps/api/app/Domain/Automation/Services/AlertProjector.php), reached by two routes (below) |

### What is duplicated

| Concern | Geofence rule | DAG automation |
| --- | --- | --- |
| Deploy message | `workflow.deploy.v1` | `workflow.deploy.v2`; the same envelope with a different `definition` ([`handleControl`](../../services/runtime/internal/app/application.go)) |
| Deploy function | `DeployRule`: lock the head, compare generations, stop the old execution, insert the new one, write the outcome | `DeployDAG`: the same steps, about 40 lines repeated |
| Execution state | `rule_executions` (definition, hash, state, enabled, stopped reason, started) | `dag_executions`: the same columns plus `next_timer` and `last_trace` |
| Idempotent outputs | `rule_transitions` | `dag_intents` |
| Binding check | [`rules.CheckDevice`](../../services/runtime/internal/rules/deployment.go) | `checkDAGBindings`; differs in detail (see the table below) |
| Timers | `TickRules`: when the consumer is idle, every enabled rule in every organization is loaded, compiled, stepped and its state rewritten, each second | `TickDAGs`: a stored `next_timer` per execution and a broker cutoff in `dag_clock` |
| Compile endpoint | `POST /internal/workflows/compile` | The DAG compile and validate endpoints |
| Laravel request | [`WorkflowDeploymentService::request`](../../apps/api/app/Domain/Automation/Services/WorkflowDeploymentService.php) | [`DagDeployment::request`](../../apps/api/app/Domain/Automation/Services/DagDeployment.php): the same idempotency, generation and applied-configuration checks, then grants |
| Permissions | `Device.view`, `Device.manage`, `Device.activate` | `Workflow.view`, `Workflow.manage`, `Workflow.activate` |

The duplicated code is small: about 250 lines of Go in
[`storage/rules.go`](../../services/runtime/internal/storage/rules.go) and
[`rules/workflow.go`](../../services/runtime/internal/rules/workflow.go), about 40
lines of PHP, and the v1 workflow and deployment schemas in
[`contracts/rules/v1`](../../contracts/rules/v1). The rule's state machine
([`evaluator.go`](../../services/runtime/internal/rules/evaluator.go)), the geometry
and [`location.Resolve`](../../services/runtime/internal/location/location.go) are
not duplicated and are needed whichever engine runs them.

### What a geofence rule does that a DAG does not

The nearest DAG is two `source.parameter.v1` nodes (latitude, longitude), a
`join.v1` in `latest` mode (the compiler requires it), `geofence.v1`,
`sustained.v1` and `action.alert.v1`. Two of the differences below were confirmed
by running that graph through the DAG evaluator in a throwaway test, not only by
reading the code; they are marked **(run)**.

| Behaviour | Geofence rule | DAG with `geofence.v1` today |
| --- | --- | --- |
| Pairing coordinates | [`location.Resolve`](../../services/runtime/internal/location/location.go): latitude and longitude from the same event, with equal observed and received times and provenance. Never combined across events | Each source keeps its own latest value and the join pairs them. A message carrying only a new latitude is paired with the previous longitude, and the node returns a known answer for a place the device never was **(run)** |
| Trusted time | A fix needs `timestamp_source: source`; future skew is limited by the binding | The source node does not look at `timestamp_source`; a reading observed after the evaluation time is ignored, with no skew allowance |
| Accuracy | The uncertainty band is the larger of the policy's buffer and the fix's reported accuracy; a binding can require accuracy | The node has no accuracy input. The buffer is a constant, and its limit is 10,000 m against the rule's 100,000 m |
| Sustained evidence | `outside_for_seconds` (0 allowed), `minimum_samples`, `max_gap_seconds`; duplicate, out-of-order and historical fixes never count | `sustained.v1` has a duration of 1 to 86,400 s only. No sample count, no gap limit, no immediate mode |
| An unknown fix during an episode | Pending evidence is dropped; the episode stays active until a fix is seen inside | `sustained.v1` restarts its clock after an unknown value, so its output goes false, the alert clears, and the same absence raises a second alert when the duration passes again **(run:** activated, cleared, activated for one continuous absence with one bad reading**)** |
| Entered and exited | A second transition kind, `workflow.membership.v1`, on a direct inside-to-outside change or back | No such output. `action.event.v1` fires on true only, needs a cooldown of at least one second and journals `automation.triggered.v1` |
| How an alert reaches Laravel | The transition is projected inside the runtime inbox transaction ([`WorkflowDeploymentService::event`](../../apps/api/app/Domain/Automation/Services/WorkflowDeploymentService.php)). It cannot expire | An intent is stored, then [`DagActions::tick`](../../apps/api/app/Domain/Automation/Services/DagActions.php) carries it out from `automation-worker`. It needs automations turned on in the organization, no emergency stop, the deploying user still holding `Workflow.activate`, and the worker reaching it within five minutes ([`intent`](../../services/runtime/internal/dag/evaluator.go)); otherwise it is cancelled or expires. An expired clear leaves an alert open |
| Who deployed it | A person or an integration application; the application path passes no user ([`GeospatialController`](../../apps/api/app/Domain/Integrations/Http/GeospatialController.php)) | `DagDeployment::request` requires a user, and every action is re-authorized against that user |
| Opt-in and stop | Always available; the emergency stop does not touch it | Off by default per organization (`automation_settings.enabled`); the stop cancels alerts too |
| Binding check | A device that needs review suspends the rule as `binding_changed`; coordinates must be mapped, numeric, reporting, not derived | `device_review_required` is a separate reason; any mapped parameter of the right type and unit passes |
| Cost per message | Rules are selected by device in SQL; one state update | Every enabled execution of the organization is loaded and decoded, then filtered by device in Go; each evaluation also writes a `dag_evaluations` row with its full trace. The compile cache holds 256 plans and is emptied when full |
| Limits | One rule per geofence and device | One alert action per graph, so still one graph per geofence and device |

And around the engine, in Laravel and the readers:

| Surface | Depends on v1 through |
| --- | --- |
| Location map (`POST location-map/query`, portal and integration API) | [`location_map.go`](../../services/runtime/internal/app/location_map.go) reads `rule_executions` for `condition`, `active` and the geometry |
| Dashboard workflow panels (`GET workflows/{w}/location-overview`) | [`workflow_overview.go`](../../services/runtime/internal/app/workflow_overview.go) reads the binding, geometry and state from `rule_executions` |
| Rule execution (`GET workflows/{w}/execution`) | [`workflows.go`](../../services/runtime/internal/app/workflows.go) reads `rule_executions` |
| Transition history (`GET workflows/{w}/transitions`) | `automation_transitions`, which DAG alerts do not write |
| Geofence events and the integration events `geofence.entered.v1`, `geofence.exited.v1`, `geofence.wandering_started.v1`, `geofence.wandering_resolved.v1` | [`GeofenceEventJournal`](../../apps/api/app/Domain/Geospatial/Services/GeofenceEventJournal.php), called from the two v1 transition branches, using the transition's `id`, `event_id` and `occurred_at` |
| Bulk assignment (up to 100 devices a save), activation batches, per-item retry | [`GeofenceService`](../../apps/api/app/Domain/Geospatial/Services/GeofenceService.php) builds the v1 graph and calls `WorkflowDeploymentService::request` per item |
| Integration API (`geofences`, `location-map/query`, abilities `geofences:read`, `geofences:activate`, `locations:read`) | The same service, with no user as actor |
| Device moves | `GeofenceService::removeDevice` disables each assignment's workflow |
| Listings | `Workflow::kind()` calls anything that is not v2 a geofence; `GET /workflows` lists v1 by default; only `automation` workflows can be archived |
| Operations | The `workflow_executions` gauge counts `rule_executions` only ([`Operations.php`](../../apps/api/app/Support/Operations.php)) |

So the `geofence.v1` node is the polygon test and nothing else. The fix
resolution, the evidence policy, the episode that survives an unknown fix, the
second kind of transition and the alert route that cannot expire all live in the
rule engine. No DAG test covers the geofence node.

## Options

**A. Keep both engines.** No risk and no work. The costs
[ADR-011](ADR-011-dag-automation-in-go.md) lists stay: two permission models, lists
that show one kind, a stop that covers one engine, and `TickRules` rewriting every
rule's state each idle second.

**B. Convert now: geofence rules become generated DAGs behind the same screens and
API.** `GeofenceService` would emit a v2 graph per assignment. With today's nodes
that graph alerts on positions that never happened, clears and re-raises an alert
after one bad reading, has no entered or exited events, cannot be saved by an
integration application, does nothing in an organization with automations off, and
can lose an alert when the worker is slow. Every row of the first table has to be
closed in the DAG engine before the first rule is converted, and the conversion
then carries live state and open alerts across engines. The code it removes is the
250 lines of Go and 40 of PHP above.

**C. Stages.** Make the DAG engine right about location first, which is worth doing
for DAG automations whatever happens to v1. Then remove the plumbing that is
duplicated for no reason. Convert the rules last, behind a gate.

## Decision

**Take option C. Geofence rules are not converted until the DAG engine reproduces
them exactly, and that is proved by running both engines on the same input. The
conversion itself is a separate go-ahead.**

### Stage 1: location in the DAG engine

1. A new source node, `source.location.v1`, takes a location binding and resolves
   each event with `location.Resolve`. Its output is a fix: a point, its accuracy,
   and unknown with a reason otherwise. `geofence.v1` gains a `fix` input and uses
   the larger of its buffer and the fix's accuracy. Graphs that feed it latitude
   and longitude keep working, and the editor steers new graphs to the fix.
2. A sustained condition that matches the rule's policy: sample count, largest gap,
   and a zero duration. This is a new node version, because changing `sustained.v1`
   would change running automations.
3. An alert that holds through unknown evidence. Today an unknown reading in the
   middle of an episode clears and re-raises any alert that sits behind
   `sustained.v1`, a temperature threshold as much as a geofence. Whether that is
   fixed in place or by a new node version is a spec question; the rule's behaviour
   is the target.
4. Parity tests: the fixtures in [`contracts/rules/v1`](../../contracts/rules/v1)
   (`simulation.fixture.json`, `simulation.expected.json`) and the cases in
   [`rules/evaluator_test.go`](../../services/runtime/internal/rules/evaluator_test.go)
   run through both engines and must produce the same activated and cleared
   sequence.

Stage 1 changes nothing for geofence rules.

### Stage 2: one set of plumbing

1. One deploy function in the runtime for the head, the generation check, stopping
   the old execution and the outcome; `DeployRule` and `DeployDAG` keep only what
   differs. It stops the other engine's execution of the same workflow in both
   directions. Today only `DeployDAG` does
   ([`storage/dag.go`](../../services/runtime/internal/storage/dag.go)); `DeployRule`
   leaves a DAG execution running, which stage 3's rollback depends on.
2. One deployment request path in Laravel. `GeofenceService` and the DAG controller
   call the same service; the engine decides only the compile call and the message
   type.
3. Rules get a stored next-timer like DAGs, so an idle runtime stops rewriting
   every rule each second.
4. A workflow records what manages it (`geofence` or a person), instead of deriving
   it from the schema version. Lists, archiving and the editor read that.
5. Hand-authoring v1 graphs through `POST /workflows`, `PUT /workflows/{w}` and
   `simulate` is closed. No portal screen uses it. Geofence workflows are written
   only by `GeofenceService`.

### Stage 3: conversion, behind a gate

Stage 3 starts only when stage 1's parity tests pass, a soak on the pilot shows
no difference, and the owner says go. It needs, beyond stages 1 and 2:

- a membership output in the DAG engine and a Laravel branch that journals it as
  the same geofence events;
- alert transitions from a geofence-managed execution projected in the inbox
  transaction as now, not through `automation-worker`: no expiry, no deploying
  user, no dependence on the automation preview or the emergency stop;
- executions selected by device, a timeline that does not store a trace per fix
  for managed executions, and a compile cache that does not thrash with thousands
  of plans;
- the location map, the location overview and the execution read answering from
  `dag_executions` in the same response shape.

Whether stage 3 is worth doing is weighed again at the gate. After stages 1 and 2
what remains of v1 is one evaluation loop, one table and one schema.

## Migration and rollback (stage 3)

**Same workflow, same UUID.** A geofence assignment keeps its workflow row. Its
UUID is what dashboards, notification recipients, the alert filter and the
assignment's `workflow_uuid` in the API refer to. Conversion is a new deployment of
that workflow at the next generation with a v2 definition.

**No gap and no double evaluation.** `DeployDAG` stops the workflow's rule
execution and inserts the DAG execution in one transaction, and
`ConsumeRuleTelemetry` selects enabled executions inside its own transaction. Each
committed event is therefore evaluated by exactly one of the two.

**State is carried, not restarted.** A new execution normally starts unknown, and
"episodes are not carried across versions"
([automation](../features/automation.md#geofence-rule-execution)). A conversion
that did that would leave the rule's open alert open for good, because its
execution is frozen, and would open a second alert for the same absence. So a
conversion deployment names the execution it replaces, and the runtime seeds the
new state from the rule's: condition, active, episode number, outside-since, sample
count, last observed time, last event and expiry. It keeps the rule's `started_at`,
so readings observed before the swap and consumed after it are not dropped as
pre-activation evidence.

**Open alerts follow.** An alert episode is keyed by deployment and episode number
([`AlertProjector`](../../apps/api/app/Domain/Automation/Services/AlertProjector.php)).
When Laravel records a conversion deployment as succeeded it moves the workflow's
open alerts from the replaced deployment to the new one, keeping their numbers. The
carried episode counter continues, so the next clear finds its alert and the next
activation takes a new number. Transition IDs change formula across engines; the
journal deduplicates by ID and no transition is emitted twice, because only one
engine evaluates each event.

**Order.** One organization at a time, by a command that converts each assignment
and compares the carried state. The pilot first.

**Rollback.**

- Before removal: the same command the other way. It deploys the v1 graph kept in
  `automation_workflow_revisions`, carrying state back by the same rule. This is
  why stage 2 makes `DeployRule` stop a DAG execution.
- A runtime older than stage 1 cannot compile a converted execution and would
  suspend it. Converted organizations are converted back before such a rollback.
  The runtime that can run both is released and soaked first, and conversion is
  never part of a release's own migration.
- v1 code, the `workflow.deploy.v1` handler and `rule_executions` are removed one
  release after the last organization is converted, in their own PR.

## What does not change

For people: **Locations → Geofences**, drawing and assigning, activation batches
and retries, the location card and bindings, the map with its inside, outside and
wandering states, dashboard workflow panels, alert episodes with their history,
acknowledgements and email recipients, and the permissions on those screens
(`Device.view`, `Device.manage`, `Device.activate`).

For integration applications: the `geofences` and `location-map/query` endpoints
and their abilities, the response shapes, the four `geofence.*.v1` events with the
same snapshot, alert events, and workflow UUIDs.

What does change, at stage 2: v1 graphs can no longer be hand-authored through the
workflow API. At stage 3: a geofence workflow's execution read comes from the DAG
engine, and `GET workflows/{w}/transitions` serves history recorded before the
conversion unless the spec keeps writing it.

## Consequences

**Easier**

- DAG automations get a correct location input. Today a graph with `geofence.v1`
  can alert on a position assembled from two messages.
- An unknown reading no longer splits one alert episode into two, for any
  sustained condition.
- One deployment path to change, in each of the runtime and Laravel.
- An idle runtime stops writing every rule's state each second.
- If stage 3 happens, it is a swap between two engines already shown to agree,
  not a rewrite under live alerts.

**Harder**

- The DAG registry grows two or three node types or versions, and the editor and
  assistant must offer the right ones.
- Two engines remain until stage 3, so ADR-011's "v1 is legacy" stays true for
  longer. Stage 2 removes the visible differences that can be removed without
  touching evaluation.
- Stage 3 adds a class of DAG execution that is exempt from the automation
  preview, the emergency stop and the worker. That is a second behaviour inside one
  engine in place of a second engine.

**Decisions left to the owner**

- Whether the emergency stop should also silence geofence alerts. This record
  assumes not: the stop exists for automated actions, and a geofence rule only
  reports.
- Whether geofence screens stay on `Device.*`. This record assumes yes and drops
  the roadmap's item to move them to `Workflow.*`; the remaining v1 workflow
  endpoints become read-only instead.
- Whether to stop after stage 2.

**Size**

| Stage | PRs | Content |
| --- | --- | --- |
| 1 | 2 | Runtime: `source.location.v1`, fix input and accuracy, sustained policy, alert hold, parity tests, contracts. Then editor, assistant, docs and atlas |
| 2 | 2 | Runtime: shared deploy, symmetric stop, rule timers. Then Laravel: one request path, the managed-by marker, lists, closing v1 authoring |
| 3 | 4 | Runtime outputs and readers; Laravel generation and projection; the conversion command with carry and rollback; removal |

Each stage is a spec under [Spec Kit](../dev/specs.md), with the atlas diagrams
(`geofence-rules`, `dag-evaluation`, `dag-deploy`) updated in the PR that changes
what they show.
