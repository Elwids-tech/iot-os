# Visual and conversational workflow builder

Status: proposed implementation plan, 2026-09-25. This document schedules work;
it does not mark the editor, assistant tools or external workflow authoring as
implemented. Current request is planning only.

## Outcome

An organization user can create a geofence automation visually or through a
conversation, simulate it, review its behavior, explicitly activate an exact
saved revision, and follow execution and resulting alerts. The same editor can
be hosted by an independent React application without importing portal code.

First example: select a GPS tag, draw a paddock boundary, require sustained
outside evidence, and produce an alert using the existing notification policy.
In a cattle application, its backend resolves the animal and paddock to core
device/binding and polygon references. The core does not acquire cattle tables.

## Verified source baseline

Repository inspection on 2026-09-25 found:

| Capability | Current source status |
| --- | --- |
| Four-node graph, draft revisions, compiler and simulation | Committed; `2a0d91d` |
| Immutable deployment snapshots, desired/applied acknowledgement, durable evaluation and timers | Committed; `ee70891` |
| Alert episodes, acknowledgement/comments, queued email | Committed; `640c571` |
| Notification preferences and manual delivery recovery | Committed; `77d3c25` |
| Application access and TypeScript integration SDK | Present as uncommitted work; outside this planning change |
| React Flow editor, editor package, workflow assistant tools | Still to build |

This is a source review, not a fresh runtime acceptance run. Prior delivery
evidence and current limits are recorded in [authoring](../../docs/automation-workflows.md),
[execution](../../docs/durable-workflow-execution.md), and
[alerts](../../docs/workflow-alerts.md). Revalidate the baseline when implementing.
Do not merge, overwrite or count the integration work as delivered merely
because its files exist.

## Architecture and scope decisions

1. React Flow is the authoring canvas. Go remains the authoritative compiler
   and runtime; Laravel owns authorization, saved revisions, deployment intent,
   audit and assistant orchestration. There is one executable contract.
2. V1 is a constrained directed chain, not arbitrary DAG execution:
   `location → geofence membership → sustained condition → alert condition`.
   Start from this template; unsupported edges, branches and node types are
   unavailable. Broadening topology requires a versioned runtime contract first.
3. One source device and one polygon per workflow in this release. No implicit
   herd-wide fan-out or automatic tag reassignment. Device/configuration changes
   follow the existing suspension and explicit reactivation behavior.
4. The editor is reusable from its first implementation, but only the core host
   is integrated initially. Prove portability in a second host before publishing
   packages or committing to marketplace/plugin lifecycle features.
5. Keep canvas layout separate from execution. Dragging a node must not create a
   new execution definition or imply that the active workflow changed.
6. AI proposes reviewed draft edits using the same services and compiler. Draft
   approval and activation are distinct. No arbitrary scripts, ERP actions or
   automated device-command nodes in this release.

## Workstream 1 — Authoring services and editor contracts

Deliver first; other work depends on it.

- Extract workflow validation/compilation and draft saving from
  `WorkflowController` into reusable application services. Existing REST routes,
  the assistant and future integration endpoints call these services. Preserve
  atomic revision history, scope checks and optimistic concurrency.
- Add side-effect-free candidate validation with structured diagnostics keyed
  by node ID, field path and error code. Go remains authoritative for topology,
  polygon geometry and evaluator settings. Forms may give faster local feedback.
- Enrich the node registry with versioned configuration schemas, required
  fields, supported connections and capability descriptions. Share contract
  fixtures; prevent registry/schema/compiler drift with contract tests.
- Expose tenant-scoped source choices: devices, applied configurations and
  eligible numeric GPS parameters with units. Do not make users enter UUIDs.
  Distinguish an editable selection from a binding that is ready to activate.
- Add separately revisioned layout storage for node positions and viewport.
  Layout writes cannot change `draft_revision`, `definition_hash`, active
  execution or pending deployment. Ignore obsolete positions safely by node ID.
- Keep incomplete edits in the controlled local editor state for V1. Save a
  server draft only when it satisfies the current complete-graph contract.
  Clearly show unsaved state and preserve it across conflicts/navigation prompts;
  do not promise cross-device recovery of an invalid unsaved graph.
- Define `Workflow.view`, `Workflow.manage` and `Workflow.activate` capabilities.
  Migrate existing effective access deliberately, preserving custom roles and
  keeping notification permissions consistent. Existing `Device.*` gates remain
  until this migration is tested; resource membership checks remain mandatory.

Acceptance: existing clients still work; invalid graphs produce node-specific
errors without writes; tenant escapes fail; stale saves preserve client edits;
layout-only writes do not change execution semantics; permission migration tests
cover default/custom roles, revocation and cross-organization requests.

## Workstream 2 — Shared React editor and core authoring page

Proposed package: `packages/workflow-editor` (`@iot-os/workflow-editor`). Use
`@xyflow/react`, the existing React/TypeScript stack and shared shadcn components.
React is a peer dependency. Do not import portal routes, cookie clients,
organization context, or assistant secrets into the editor package.

The package accepts a controlled workflow, layout, capabilities, diagnostics and
host callbacks. The core host owns fetching, organization selection, saving,
deployment operations and navigation. Resource pickers and geofence editing are
replaceable host integrations. Expose stable domain callbacks, not React Flow's
internal node objects as public API.

Core page:

- Workflow directory with draft/deployment status and create-from-template.
- Canvas, node inspector, source selector, polygon editor and condition fields.
- Searchable selectors with search inside the selector. Empty/unsupported GPS
  configurations explain what is missing.
- Geofence drawing/editing plus GeoJSON import, with the current single-ring,
  extent, latitude and uncertainty restrictions shown before save. The map
  renderer must not silently change coordinate order or evaluator semantics.
- Summary of outside duration, minimum observations, freshness and uncertainty.
  Unknown GPS must never be presented as safe/inside or as a cleared alert.
- Undo/redo for local graph edits, explicit Save, conflict recovery, unsaved
  navigation protection, loading/error states, keyboard access and dark mode.
- A form/list alternative for editing the supported chain without drag-and-drop;
  a usable compact-screen inspector rather than a desktop-only canvas.

Acceptance: create, edit, save and reopen a geofence workflow without raw JSON;
change layout without changing execution; invalid edges cannot be saved; a
conflicting remote edit does not discard local work. Test rendered behavior and
accessibility, including preservation of the user's unsaved drafts on rebuild.

## Workstream 3 — Simulation, activation and observation in the editor

- Include named deterministic scenarios: re-entry, sustained exit, boundary
  uncertainty, stale GPS, historical points and gaps. Reuse existing fixtures.
- Show a per-step trace with timestamp, condition, evidence, transition and
  reason. Identify it as simulation, independently of live execution.
- Run the initial simulation on the exact saved revision. If local edits differ,
  require a valid save before running; never label an older trace as current.
- Show draft revision separately from desired/applied execution. Activation
  review includes source/configuration, polygon, thresholds, simulation status,
  replacement implications and current notification settings.
- Call the existing idempotent deployment API, retain operation UUIDs across
  retries, and poll acknowledgement. A 202 response displays pending. Handle
  failure, disable, superseded versions and `binding_changed` suspension.
- Link execution state/transitions to existing alert detail and notification
  preferences. Notification settings retain their independent revision. Do not
  implicitly enable email when saving or activating a workflow.

Acceptance: a saved simulated workflow activates only after runtime
acknowledgement; recovery after a lost HTTP response does not duplicate the
operation; editing a deployed workflow leaves its execution snapshot unchanged;
simulator → active episode → email opt-in → re-entry → clear is observable.
Restart during pending evidence preserves the existing recovery guarantees.

## Workstream 4 — Conversational workflow authoring

Reuse the existing assistant run, event, budgeting and proposal/review patterns.
Its current conversation and proposal services are profile-oriented: introduce
an explicit workflow target/adapter without weakening profile authorization or
silently reusing profile-specific fields. Keep profile onboarding compatible.

Tools: read workflow; describe allowed nodes; find authorized sources; propose
changes against a base revision; validate candidate; simulate an exact revision;
request review; apply the approved proposal as a draft. No tool may directly
write execution tables, invoke the broker or bypass deployment authorization.

A proposal records base revision, candidate content hash, semantic diff,
diagnostics and simulation provenance. Review covers source, polygon, timing and
alert behavior. Re-check current permission and revision when applying it. If a
human edited the canvas meanwhile, return a conflict and regenerate/review the
proposal; never silently overwrite the new draft. Map assistant changes back to
the same editor state after successful application.

Ask focused questions for ambiguous devices, boundaries or timing. In the core,
use device terminology; animal/paddock resolution is provided by a vertical
adapter. Do not invent animal assignments or geofence coordinates. Treat domain
labels, imported documents and telemetry as data, not tool instructions.

Acceptance: “Create an alert when this tag stays outside this paddock for one
minute” produces a reviewable, valid draft; “change it to two minutes” creates a
clear diff; refusal, stale revisions, permission loss and ambiguous references
leave saved/live workflows unchanged. Applying a draft does not activate it.

## Workstream 5 — Independent host and supported integration

Complete/review the ongoing application-access work before extending its scope.
The current TypeScript SDK source offers device/alert reads; it is not yet an
external workflow-authoring SDK. Do not equate read access with deployment rights.

Add deliberately scoped workflow read/author/simulate/deploy APIs as needed by
the reference app. Decide whether a mutation is performed by a service principal
or an identified delegated user, and audit it accordingly. Keep activation scope
separate. Credentials stay in the host backend; no broker/database access.

Build an independent minimal React host with its own backend, session and small
domain mapping store. It imports the editor package and public SDK only. It
resolves one animal/paddock to a device/binding and shows domain labels. Document
how changing a temporal tag assignment suspends or requires explicit workflow
rebinding; do not follow tag changes silently.

Verify scoped save/simulate/activation, tenant/resource isolation, revocation,
expired credentials and operation retry. Laravel Inertia React can import the
same editor; a PHP SDK is a separate API wrapper and can follow once that host
is confirmed. Vue/Blade needs a React mount or separately designed embed.

Acceptance: both core and the independent host use the same package, contract,
compiler and runtime without importing portal source. A compromised or revoked
host credential cannot read or mutate another tenant's workflows.

## Sequence, release gates and decisions

Implementation order: 1 → 2 → 3 → 4 → 5. External access work may continue in
parallel with the core editor. AI service work can start after workstream 1, but
release its review flow only with a usable editor. No completion date is assumed;
estimate each bounded slice after its contract/design review.

First usable release: workstreams 1–3, one geofence workflow end to end.
Second release: conversational creation/editing. Third: proven independent host.
Each implementation slice gets focused tests, affected container rebuilds,
served-behavior verification and its own reviewable commit. Shared package
changes must follow the repository's portal/admin rebuild requirements.

Working defaults for planning: core portal first; one device per workflow; React
reference host; TypeScript SDK first; explicit activation; no real customer email
for verification. These defaults allow workstream 1 to proceed without the cattle customer.

Resolve before the dependent slice:

- Map renderer/tile service and supported basemap requirements before polygon UI
  delivery. A host adapter and GeoJSON contract keep this replaceable.
- The cattle customer's application framework, user identity model and temporal tag ownership
  before claiming the real third-party integration complete.
- Exact role migration and application scopes before enabling new authoring or
  activation access; map existing effective permissions explicitly.

Deferred until a concrete use case: branching/join semantics, loops, schedules,
arbitrary code, ERP/SAP nodes, device-command automation, multi-device fan-out,
reusable geofence libraries, collaborative editing and a plugin marketplace.
Later command nodes must retain command permission, confirmation, idempotency
and uncertain-delivery rules rather than become unrestricted graph side effects.
