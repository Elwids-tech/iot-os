# Saved automation scenarios

Open a saved v2 workflow and select **Simulation → Saved test scenarios**.
Create a named scenario, add timed steps, set expectations, and save it before running.
The workflow must also be saved. Testing never activates a workflow or sends live device commands.

Each scenario starts at 0 seconds and subsequent steps must increase in time. A step
can advance the clock or send one complete message from one source-bound device.
Include the desired readings; omitted parameters retain earlier evidence until their
freshness expires. Bad-quality/null values can test unknown evidence. Reading age is
relative to that step, and observations before scenario start are ignored by the runtime.
The deterministic clock starts at 2030-01-01 00:00:00 UTC, including window alignment.

Every action node defaults to zero expected requests at every step. A Set Device State
node emits one request per setting. Optional output checks specify a node, port
(usually `out`), and either a known JSON scalar or unknown. False, zero, and unknown
are distinct. Invalid or removed bindings/nodes must be corrected before running.

Results show expected versus actual checks and link failures to the relevant node's
simulation trace. Incomplete/truncated evidence fails the run. Delivery acknowledgement
and physical device behavior remain part of live execution, not simulation assertions.

Scenarios and runs record revisions. Changing the workflow or scenario requires a new
run to verify those edits. An older scenario can be explicitly tested against the
current saved workflow revision after reviewing its bindings and expectations.
The latest 20 run snapshots are retained for each scenario; a workflow supports up to
50 scenarios, each with up to 100 steps over seven simulated days. Local scenario edits
survive editor tab switches and participate in the unsaved-changes navigation guard.

API endpoints under `/api/v1/organizations/{organization}/workflows/{workflow}`:

- `GET/POST /scenarios`: list/create.
- `PUT/DELETE /scenarios/{scenario}`: update/delete with optimistic `revision`.
- `GET/POST /scenarios/{scenario}/runs`: read retained results/run against an explicit
  `draft_revision` and scenario `revision`.

Read operations require Workflow.view; mutations and simulation require Workflow.manage.
All routes enforce organization/workflow ownership and the v2 feature gate.
