# Portable automation authoring

## Timing and boundaries

React Flow is a good fit for the next authoring UI, starting with the geofence
pipeline already supported by Go. It is a canvas and interaction library, not
our durable execution engine. Its [computing flows guide](https://reactflow.dev/learn/advanced-use/computing-flows)
also describes handling data outside the canvas, including on a server.

Start with the four supported nodes. Branching, joins, schedules, external
actions, retries and device commands require explicit execution semantics and
must be introduced incrementally. A canvas should never offer a node simply
because it is easy to draw.

Laravel owns organization permissions, draft authoring, revision history,
eventual immutable activation snapshots and audit. Go validates executable
semantics, simulates, and will own durable evaluation, timers and transitions.
The browser never subscribes directly to internal NATS or calls private Go APIs.

## Implemented in this slice

`automation-workflow.v1` is a framework-neutral graph document with server-owned
workflow/version UUIDs, typed nodes, node configuration, and source/target edges.
See `contracts/rules/v1/workflow.schema.json` and `workflow.fixture.json`.
Array order does not control execution. Go checks graph topology and compiles
to the existing `geofence-rule.v1` definition, retaining its evaluator/hash and
inside/outside/unknown semantics.

The only accepted topology is:

```
location.source.v1 → geofence.membership.v1
                  → condition.sustained.v1 → alert.condition.v1
```

The alert node emits simulated condition transitions; it does not send a
notification. Unsupported nodes, duplicate IDs/edges, disconnected chains,
cycles, branches and unknown configuration fields are rejected.

Public API base: `/api/v1/organizations/{organization_uuid}/workflows`.

| Method/path | Contract |
| --- | --- |
| GET `/node-types` | Supported input/output type registry |
| GET `/` | Tenant-scoped pagination, `per_page` 1–100 |
| POST `/` | `{name, workflow}`; returns a saved draft at revision 1 |
| GET `/{workflow_uuid}` | Saved graph, draft revision and definition hash |
| PUT `/{workflow_uuid}` | `{name, workflow, draft_revision}`; stale edits return 409 |
| POST `/{workflow_uuid}/simulate` | `{draft_revision, steps:[{at,event:null\|committed_event}]}` |

Every successful save generates a new server-owned version UUID, appends a
revision snapshot and audit entry atomically. Incoming workflow/version UUIDs
are replaced by server identities. Clients must retain the returned identity
and draft revision. Revision history has no update/delete endpoint. Database
administrators are not prevented from modifying records directly.

The initial capability gate reuses `Device.view` for reads and `Device.manage`
for authoring, registry and simulation. Separate automation author/activate
permissions and external application credentials are follow-up work. Membership
is checked independently of the supplied binding; device and configuration
references must belong to the organization. Draft validation is not a check
that hardware is online or that the chosen configuration is currently applied.
Parameter compatibility and deployment-generation readiness must be checked
when implementing activation.

Simulation always starts from fresh state using the saved compiled definition;
it accepts 1–1000 steps, pins the draft revision and returns it with the result.
Events are synthetic input, scoped to the bound organization/device. No live
telemetry is read and no rule, command, notification or live state is created.
Saving requires the runtime compiler to be available; runtime failure does not
leave a partially saved draft. Client retry after a lost create response is not
yet idempotent; fetch existing drafts before creating another.

The original authoring slice has now been extended with
[durable activation and execution](durable-workflow-execution.md), including
deployment acknowledgements, condition transitions and restart-safe timers.
The visual editor and conversational workflow tools remain deferred.

## Reusable editor and SDK plan

Build a React package such as `@iot-os/workflow-editor` with controlled document
state, typed node forms, validation display, simulation traces and host adapters
for loading/saving and selecting resources. Keep React Flow node positions,
viewport and presentation metadata separate from executable semantics; do not
persist the library's entire internal state as the runtime contract. This
initial contract has no layout field; add separately versioned presentation
storage alongside the editor.

| Concern | Core portal | Independent vertical application |
| --- | --- | --- |
| Editor | Shared React package | Same package in React/Next.js or Laravel Inertia React |
| Resource selection | Organization devices and location bindings | Animals/paddocks resolved to authorized device/binding IDs |
| Authentication | Current user and organization session | Scoped application credentials through its backend; never browser secrets |
| Persistence/execution | Core authoring API and Go runtime | Same core API/runtime; domain records remain in the vertical database |
| Additional actions | Registered core capabilities | Versioned approved connectors with permission, retry and idempotency contracts |

A React package is directly usable in Inertia React; Vue/Blade applications need
a React mount or an embedded editor. PHP and Node SDKs wrap the same public
APIs/events, not separate evaluators. Prioritize one real application integration
before promising a plugin marketplace or multiple complete SDKs. Third-party
applications cannot upload arbitrary executable code to the runtime. ERP/SAP
connectors belong behind authenticated services, with credential references
resolved server-side rather than stored in graph documents.

## Conversational editing

Use the existing assistant proposal/review pattern. Proposed tools are:
read workflow, list allowed node types/resources, propose graph edits against a
base revision, validate, simulate, and apply a reviewed draft. Tool handlers call
the same authoring services as the editor under the user's organization and
permissions. No parallel AI-only graph schema or execution route.

For example, “Alert if this cow stays outside the north paddock for a minute”
requires resolving the animal's current tag assignment and paddock geometry,
then presenting the resulting binding, duration and behavior when GPS is
unknown. Ambiguous domain references require clarification rather than invented
IDs or boundaries. Saving the reviewed proposal produces a new draft; activation
is a distinct, permission-checked operation on an exact validated version.
Conversation alone must not silently turn a draft into live device control.

## Next delivery sequence

1. Durable activation and execution are implemented; see the linked execution
   guide for the limits and verified recovery behavior.
2. Next: durable alert/notification delivery and a cattle demonstration from
   simulated GPS through restart recovery.
3. Visual authoring is deferred at the user's request. Later add the constrained
   React Flow editor and conversational graph proposal/review tools using these
   same services.
4. Then scoped external app access, first SDK and package extraction validated
   in a second host.

Editor implementation can overlap durable execution work, but operational
activation should not be exposed until recovery and authorization are verified.
