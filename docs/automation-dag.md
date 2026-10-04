# DAG automation v2

The preview is opt-in per organization. Existing `automation-workflow.v1`
geofence workflows retain their compiler, state, permissions and deployment API.
V2 uses the same committed telemetry consumer and acknowledgement boundary, with
separate execution state and a transactional action outbox.

## Authoring and deployment

The portal's **Automations** page includes a controlled React Flow editor,
keyboard-accessible node/connection forms, a cross-device template, validation,
optional saved-revision simulation and explicit activation review. Saved inactive
workflows expose Reactivate without requiring another simulation in the current
browser tab. Layout is separately
revisioned; moving nodes does not alter execution or the semantic draft.

Under `/api/v1/organizations/{organization}/workflows`:

| Endpoint | Purpose |
| --- | --- |
| `GET /dag/node-types` | Authoritative Go node registry and form schemas |
| `GET /dag/resources` | Searchable, paginated applied device parameters |
| `GET /dag` | V2 workflow directory |
| `POST /dag/validate` | Side-effect-free candidate compilation |
| `GET, PUT /dag/settings` | Revision-checked preview and organization stop controls |
| `POST /`, `GET, PUT /{workflow}` | Versioned authoring, selected by schema version |
| `PUT /{workflow}/layout` | Positions/viewport with independent revision |
| `POST /{workflow}/simulate` | Exact saved revision, synthetic steps and clock |
| `POST /{workflow}/deployments` | Immutable activation/disable; 202 means pending |
| `GET /{workflow}/execution` | State, latest node trace, timer and consumer health |
| `GET /{workflow}/actions` | Paginated action outcomes |
| `GET /{workflow}/timeline?before={id}` | Recent evaluations, 20 per page with an older-entry cursor |
| `GET /{workflow}/timeline/{evaluation}` | Deployed node evidence and correlated action delivery |
| `POST /dag/commands/{command}/reconcile` | Explicit reconciliation after fresh target-state observation |

Deployment request fields remain operation UUID, target state, draft revision and
expected generation. V2 activation also accepts one `command_grants` entry per
selected command setting (legacy nodes have one): node ID, binding, exact value, cooldown seconds, maximum per minute
and expiry. This initial grant form approves exact values, not arbitrary ranges.
Retries reuse the complete original request. Grants and snapshots are immutable.
Workflow view/manage/activate permissions are copied from corresponding existing
Device grants at migration, including custom roles and direct assignments.
Device.command is checked independently and is never added by this migration.

## Execution semantics

- One execution/correlation key represents the explicitly bound device set;
  dynamic groups and multi-key fan-out are not part of this version.
- Connections use named typed ports. Cross-source reconvergence requires a join.
  Unknown, false and skipped branches remain distinct. Arithmetic has no scripts. Multiplication requires a dimensionless operand; division accepts a dimensionless divisor or matching units (yielding a dimensionless ratio). Compound units are rejected.
- Windows operate directly on numeric device sources, using observed time and
  UTC epoch alignment. Duration is 1–86400 seconds; slide divides duration, with
  at most 100 overlapping windows. Lateness is 0–3600 seconds. Sample average is
  arithmetic mean, not a time-weighted average. Partial activation windows are
  skipped, and minimum sample evidence is mandatory.
- A persisted broker cutoff is drained before finalization. Closed windows never
  reopen. Required missing evidence yields unknown. Final results remain usable
  until the following window deadline; joins require identical window identity.
- Source freshness is explicit. Invalid/historical/future/pre-activation readings
  cannot create fresh evidence. Unknown does not clear active alert episodes.
- State, timer deadlines and intent identities commit before broker ack. Restart
  uses database state; stream incarnation/retention gaps fail readiness.
- One alert lifecycle per graph is supported. Its existing alert detail and
  notification preferences remain usable; the first binding is the primary
  device shown by legacy alert/integration views. Other devices remain visible
  in the graph and node traces.
- Persisted source buffers are capped at 10,000 samples per source. Exceeding the
  cap suspends the execution visibly rather than dropping evidence. The latest
  trace is bounded to 1,000 node evaluations. Compilation cache holds 256 plans.

## Actions and operations

The Execution tab includes a live execution timeline. Evaluations are committed
in the same transaction as runtime state and action intents. Each entry records
the triggering telemetry or due timer, deployed generation and revision, input
and output values, and reasons for false, unknown, suppressed or triggered steps.
Editing a draft does not rewrite historical node configuration. Action delivery
is linked by exact intent IDs and distinguishes authorization, sending, target
observation and device confirmation. Missing worker records remain pending.

History begins after this feature is installed; older traces are not backfilled.
The runtime retains up to 1,000 evaluations per workflow across deployments,
subject to earlier organization retention. Individual traces retain the last
1,000 steps and display a truncation notice. The UI polls every five seconds,
supports pause and older pages, and keeps a selected evaluation stable.

The `automation-worker` Laravel process receives durable intents through the
existing runtime inbox, then checks current authority, exact deployment, stop
state, grants, binding generation, deadlines and per-target limits. Alerts reuse
the existing projector; integration actions journal `automation.triggered.v1`
for existing authorized webhook subscribers. Command actions reuse the device
command pipeline with an explicit automation entry point.

Command acceptance is not physical success. The UI distinguishes accepted,
dispatched, observed-at-target, failed, expired and uncertain outcomes. Uncertain
or timed-out delivery prevents further automated commands to that parameter.
Reconciliation requires an authorized user, a note and a fresh observation at
the requested target. It retains the original uncertain outcome and an audit.
Disabling/replacing/organization stop cancels pending intents. Immediately before
physical dispatch the runtime rechecks approval through the private control API.
That transaction marks the dispatch boundary; after it, a request may reach the
device and cannot be undone by disabling a graph. Control API unavailability
fails closed without sending the command. No uncertain request is automatically resent.

The runtime remains single-instance under its existing exclusive lock. No
production enablement is performed by migrations. Use simulator devices first.
Historical intent identities remain retained for deduplication and audit; source
samples and latest traces are bounded. Monitor state size, timer backlog,
consumer health and pending/failed/uncertain actions before expanding rollout.

Reference graph: `contracts/rules/v2/workflow.fixture.json`. It joins finalized
temperature and pressure windows, emits an alert, and requests a pump stop.
Replace every binding with authorized applied configurations before deployment.


## Local verification

- `node tooling/test-devices.mjs --automation-only` runs isolated PostgreSQL/NATS,
  Go race/integration tests, contract validation, device simulator checks, and
  the real committed-telemetry → finalized join → alert/command → observed-target
  demonstration. It preserves the regular local stack and cleans its own services.
- From `apps/api`, `php artisan test --compact --filter='DagTest|WorkflowTest|Command'`
  covers authorization, activation, action deduplication, revocation, uncertainty,
  independent layout revisions and optimistic conflicts.
- Served portal checks exercised searchable bindings, save/reopen, simulation,
  activation review, unsaved edits, explicit conflict recovery and desktop/mobile
  layout. The temporary QA organization and its fake applied devices were removed.
- The legacy device browser script still expects the removed “Validate saved
  configuration” button. The automation-only harness excludes that unrelated
  browser script; its passing result does not certify the entire legacy browser suite.

All shell commands in this repository should be prefixed with `rtk proxy`.
Production rollout and feature enablement for real organizations remain separate.

### Commit checks on 2026-10-02

The complete PHP suite passed (195 tests, 2,181 assertions), as did portal,
admin, API-client and workflow-editor type checks, `go test ./...` and seven
release-tool unit tests. The authorization seeder assertions now include the
six new workflow permission records across the two guards.

Docker Desktop's daemon API was unresponsive and the Compose rebuild attempt
timed out. No fresh container, served-browser or disposable integration result
was obtained in this check. The earlier local verification above is historical
evidence; it does not replace a fresh rebuild or staging acceptance.

### Dynamic Set Device State

The portal's Set Device State node renders the selected device's applied profile:
boolean switches, allowed enum choices, color inputs, sliders, and numeric/text
fields. The resource picker requests `controllable=1`; the API filters active,
applied devices with mapped state commands before pagination and checks command
permission. `device_uuid` hydrates a saved selection independently of search.

Check **Set <parameter>** for each value to change. Unchecked settings are left
alone. Editing changes only the draft. Multi-setting nodes retain
`action.command.v1` and use `config.settings`, an object mapping binding roles to
scalar values, alongside `cooldown_seconds` and `ttl_seconds`. All settings must
target distinct parameters of one device configuration. Legacy `binding` / `value`
nodes remain valid; the two config forms cannot be mixed.

Runtime creates one durable intent per setting with a distinct idempotency key.
Activation requires one exact-value grant per node/binding pair. Each intent is
checked against its projection from the immutable deployment; authorization,
configuration generation, expiry, cooldown, rate limits and uncertainty remain
per target. Settings dispatch independently: this is not an atomic update and
arrival order is not guaranteed. Use separate controlled stages when an action
requires another setting to be observed first.
