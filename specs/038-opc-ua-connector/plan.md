# Implementation Plan: OPC UA Connector and Building Simulator

**Branch**: `spec/038-opc-ua-connector` | **Date**: 2026-11-25 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/038-opc-ua-connector/spec.md`

## Summary

A building's BMS server becomes a data source. The work comes in five parts, in this
order:

- **A simulated building.** A Python OPC UA server models one office building with
  realistic values, units, statuses, faults and two naming styles. Everything else is
  built against it.
- **A connector core.** A library in `services/adapters/lib/opcua` (on
  `node-opcua-client`) owns sessions, security, browsing, resolving points and
  subscriptions. It runs in the tenant adapter runtime first and is later packaged as
  an on-site agent.
- **Connections and point maps.** Laravel owns a new **connection** record (one per
  server, shared by data sources) and stores the **point map** as an immutable adapter
  revision. The point map is a new protocol-neutral contract that later typed
  protocols reuse. There is no decoder.
- **The existing pipeline, unchanged in shape.** The OPC UA source feeds the managed
  Sparkplug B publisher, so Discovery, review, activation, storage, rules, dashboards
  and offline alerts work as they do for any adapter. Two small additions: reading
  quality gains `uncertain` and a reason, and a report made only of bad readings does
  not count as hearing from a device.
- **The hierarchy stays separate.** Spec 009 is planned and built on its own. The last
  pull request here proposes entities and placements from the server's structure and
  applies them through spec 009's services, only when that feature exists.

Decisions are in [research.md](research.md) (R1 to R17), records in
[data-model.md](data-model.md), interfaces in [contracts/](contracts/), and the
checks to run in [quickstart.md](quickstart.md).

## Technical Context

**Language/Version**: Node.js 22 (adapter manager and runtime nodes), Go 1.27
(runtime), PHP 8.4 / Laravel 13, TypeScript / React 19, Python 3.12 (simulator)

**Primary Dependencies**: `node-opcua-client` (new, MIT) in `services/adapters`;
`asyncua` (new, LGPL, development only) in `tooling/simulators/requirements.txt`;
existing `mqtt`, `protobufjs`; `laravel/ai`; TanStack Query and Table; `@iot-os/ui`

**Storage**: PostgreSQL 17 with TimescaleDB: three new tables
(`adapter_connections`, `adapter_agents`, `adapter_hierarchy_proposals`), new columns
on `device_adapters` and `adapter_tenants`. Per-connection PKI folder and, on an
agent, a bounded reading queue under the runtime's `/data`.

**Testing**: `node --test` for the library against the simulator; the adapter
integration test extended with an OPC UA scenario; `pytest` for the simulator's model
and scenarios; Go tests for quality and hearing; PHPUnit on PostgreSQL for the API,
isolation and assistant tools; Vitest and Playwright (mocked API) for the tree and the
point map editor; contract fixtures through `verify-devices-contracts.py`; a new
`tooling/verify-opcua.mjs` that drives the quickstart through the API

**Target Platform**: the Compose stack's adapter overlay plus a simulator overlay; the
single-node release; the agent as a container on a site computer (linux/amd64 and
arm64)

**Project Type**: web application plus services

**Performance Goals**: a change visible within 15 s (SC-002); 5,000 points collected
for a simulated day with no loss (SC-003); a tree level listed within 2 s

**Constraints**: tenant runtime 512 MiB and 1 CPU until R2's measurement says
otherwise; 10,000 points and 10 connections per organization; 20,000-node scan;
browse pages of 200; one session per connection; read only

**Scale/Scope**: 8 pull requests; about 4 migrations; 1 new Node library and 1 source
node; 1 Go change; about 20 API endpoints; about 10 portal components (tree, point
map editor, connection forms, status); 1 simulator; 3 contract schemas; 2 ADRs

## Constitution Check

*Checked before research and again after the design below.*

| Principle | Status |
| --- | --- |
| I. Laravel owns intent; Go executes | Pass. Laravel owns connections, point maps and proposals. The connector runs in the tenant runtime (or the agent), never in Laravel or Go. Go still ingests only Sparkplug B and gains two metric properties it reads. Browsing is a read through the manager, as Fetch now is. |
| II. Immutable versions | Pass. A point map is an adapter revision: immutable, review-checked, then deployed and acknowledged. Connection settings and secrets are snapshotted into the revision at deploy, as source secrets are today; accepting a changed server certificate redeploys the applied revision. Hierarchy edits are immediate, as spec 009 states, because the runtime does not execute them. |
| III. Tenant isolation | Pass with tests. Connections, maps, browse results, agents and proposals are organization-scoped; the session lives in the tenant's own runtime; private ranges are set only by the operator and can never cover platform networks (R10). Tests prove another organization cannot read, change or reach a server through a connection (FR-045). |
| IV. Contracts first | Pass. New: `contracts/pointmaps/v1` (point map), `contracts/adapters/v1` additions (source settings for `opcua`, decoder-output quality, runtime events for connection status and refused points, browse and check results), and `uncertain` in the reading contract. Public API changes update the OpenAPI description and `packages/api-client` in the same pull requests. |
| V. AI proposes, people approve | Pass. Assistant tools browse and read (no external effect on the server beyond reads) and produce proposals. Accepting a certificate, secrets, deploy and activation stay human. Works with the assistant off. |
| VI. Show uncertainty | Pass, and the main reason for R4 to R6: bad quality is unknown with a reason, uncertain is labelled, platform-timed readings are labelled, a steady device stays online through truthful rhythm reports, a gap during a disconnection stays a gap. |
| VII. Durable, idempotent messaging | Pass. The publisher's settle-after-acknowledgement and deduplication are reused. The agent's queue is bounded and replays oldest first as history. Reconnection uses bounded backoff with named stops. |
| VIII. One design system | Pass. `CollectionPage`/`DataTable` for connections, equipment and refused points; `Panel`; `Status`/`statusOf` for connection and quality states; `Freshness`. The address-space tree is a new kit component (`TreeTable`) with a story, built so spec 009's Entities page can reuse it. |
| IX. Verified where it runs | Pass. Each pull request rebuilds the affected containers and runs its quickstart scenario against the simulator in the stack; SC-007 adds a server the project did not write. |

Two ADRs: **ADR-052** (shared server connections and point maps for typed protocols;
OPC UA first) is part of the documents pull request. **ADR-053** (the on-site agent,
the "own edge runtime" ADR-023 leaves open) is written and accepted before PR 7.

## Design

### Simulator (`tooling/simulators`)

- `bms/model.py`: the building (site, building, 4 floors, 16 zones) and its equipment
  with every point's type, unit, range and description.
- `bms/dynamics.py`: the simulated day from a seed: occupancy schedule, outdoor
  temperature curve, zone drift towards setpoint, plant staging, meter totals.
- `bms/scenarios.py`: the named faults of US1 scenario 4, switchable at run time.
- `bms/naming.py`: the structured and flat styles over the same model.
- `bms_server.py`: the `asyncua` server (endpoints, sign-in methods, certificates
  generated at first start into `.local/devices`), the control port and options
  (`--style`, `--size`, `--speed`, `--seed`, `--security`, `--auth`).
- `bms_controls.html`: a page of scenario switches.
- `deploy/compose/compose.bms-simulator.yml`: service `bms-simulator`, port 4840 on
  the internal network and on localhost for desktop clients.

### Connector core (`services/adapters/lib/opcua`)

- `address.cjs`: the shared address check (public, plus the organization's allowed
  private ranges), used by `broker.cjs` and `poll.cjs` too (R10).
- `security.cjs`: endpoint listing and ranking, refused policies, per-connection PKI
  folder, fingerprint pinning (R9).
- `session.cjs`: connect, sign in, announced limits, reconnect with backoff, the
  failure reasons of US2 scenario 6 mapped from status codes.
- `browse.cjs`: children with paging, attributes (type, unit, range, state labels),
  branch scan with the node limit, similar-equipment search (declared type, matching
  names, name pattern).
- `resolve.cjs`: node id with namespace URI, falling back to the path of names (R7).
- `collect.cjs`: subscriptions per sampling interval, batching inside server limits,
  deadband, per-equipment grouping, the rhythm read, polling for what subscriptions
  cannot hold, refused points (R6, R12).
- `quality.cjs`: status code to `good`, `uncertain`, `bad` and the plain reason (R4).

### Adapter services (`services/adapters`)

- `lib/flow.cjs`: an `opcua` adapter is source → publisher → reporter (R3).
- `nodes/adapter.js`: source type `opcua` registers its point map with the runtime's
  connection registry (one session per connection) and forwards results; the
  publisher writes `quality` and `quality_reason` properties, sends bad values as
  null metrics, and labels rhythm reports `timestamp_source: server`.
- `manager.cjs`: routes `/opcua/endpoints`, `/opcua/test`, `/opcua/browse`,
  `/opcua/read`, `/opcua/similar`, `/opcua/check` ([manager API](contracts/manager-api.md));
  deploy passes the connection, its PKI material and the point map.
- `Dockerfile`: the runtime image gains the library; later an `agent` entry point.

### Go runtime (`services/runtime`)

- `sparkplug/session.go` `decodeMetric` reads `quality` and `quality_reason`.
- `devices/profile.go`: bad → `invalid` with the reason; uncertain → value kept,
  quality `uncertain`; `timestamp_source: server` stored as its own label.
- Hearing from an adapter device needs one reading that is neither historical nor bad
  (R5).

### Laravel (`apps/api/app/Domain/DeviceAdapters`)

- `Enums/AdapterSourceType`: `Opcua`.
- Models `AdapterConnection`, `AdapterAgent`, `HierarchyProposal`; services
  `Connections` (create, test, certificate acceptance, credentials, pause, delete,
  limits), `PointMaps` (validate against the contract, suggest keys and units, review
  check, expected rows a day), `ConnectionStatus` (from runtime events), and later
  `Agents` and `HierarchyProposals`.
- `Http/ConnectionController`, `PointMapController`; batch activation on
  `AdapterController` (R14). Routes in [contracts/api.md](contracts/api.md).
- `AdapterService::fields` accepts the `opcua` source (a connection and a point map,
  no code, no fixtures); the deploy gate for it is the review check (R11).
- Audit events for every change (FR-046). Config `adapters.opcua.*` (limits).
- Admin app: a staff-only field for an organization's private ranges.

### Onboarding assistant (`apps/api/app/Domain/Assistant`)

- `OnboardingTools` gains `opcua_browse`, `opcua_read` and `propose_point_map`;
  results are trimmed to `assistant.max_context_characters` and never include secrets.

### Portal (`apps/portal`, `packages/ui`)

- `packages/ui`: `TreeTable` (lazy levels, paging, selection, row status) with a story.
- `adapters/SourceChooser.tsx`: a fifth choice, **OPC UA server**.
- `adapters/sources/OpcuaConnection.tsx`: address, offered security, certificate
  review, platform certificate download, sign-in, test, failure reasons.
- `adapters/pointmap/`: `AddressTree.tsx` (live values), `EquipmentPicker.tsx`,
  `ReadingsTable.tsx` (key, name, unit, scale, reporting), `SimilarEquipment.tsx`,
  `Review.tsx`. Built on the shared point map types so later protocols swap only the
  address picker.
- `adapters/Overview.tsx` and `Activity.tsx`: connection status, points read and bad,
  refused points; batch **Activate** in the Devices tab.
- `packages/api-client`: connections, browse, point maps, batch activation.

### On-site agent (PR 7, after ADR-053)

- The runtime image in agent mode: enrolment, two outbound connections, the same
  connector core, a bounded disk queue ([research R15](research.md)).
- Laravel `Agents` service and routes; portal agent list, enrolment code and the
  **Runs at** choice on a connection; `manager.cjs` relays browse and deploy to an
  agent over its control topics.

### Hierarchy proposal (PR 8, after spec 009 is built)

- `HierarchyProposals` builds a proposal from equipment paths (or a tag split) and
  applies it through spec 009's services ([research R16](research.md)).
- Portal `adapters/hierarchy/Proposal.tsx`: the proposed tree with edit, drop and
  "use existing", built on `TreeTable`.

### Delivery

Every pull request branches from `main` after the previous one has merged; none is
stacked.

| PR | Contents | Stories | Verified by |
| --- | --- | --- | --- |
| 0 | Documents: spec, plan, research, data model, contracts, quickstart, tasks, ADR-052 | | review |
| 1 | BMS simulator, its overlay, tests and docs | US1 | quickstart A |
| 2 | Point map contract; connector core library with tests against the simulator; memory measurement (R2) | part of US2 to US4 | `node --test`, quickstart B |
| 3 | Connections: API, manager routes, portal connect and address tree | US2, US3 scenario 1 | quickstart C |
| 4 | Point map editor, revisions, review check | US3 | quickstart D |
| 5 | Collecting: source node, quality in publisher and Go, hearing rule, batch activation | US4 | quickstart E, SC-002 to SC-004 |
| 6 | Status, limits, certificate expiry, assistant tools, feature docs, independent server check | US5 | quickstart F, SC-005 to SC-007 |
| 7 | On-site agent (after ADR-053) | US6 | quickstart G, SC-008 |
| 8 | Hierarchy proposal (after spec 009 is built) | US7 | quickstart H, SC-009 |

Spec 009 runs beside this as its own plan and pull requests. PR 1 to PR 7 do not wait
for it.

## Project Structure

### Documentation (this feature)

```text
specs/038-opc-ua-connector/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── api.md
│   ├── manager-api.md
│   ├── point-map.md
│   └── simulator.md
├── checklists/requirements.md
└── tasks.md               # /speckit-tasks
```

### Source Code (repository root)

```text
tooling/simulators/bms_server.py, bms/, bms_controls.html, test_bms_*.py
tooling/verify-opcua.mjs
deploy/compose/compose.bms-simulator.yml
contracts/pointmaps/v1/                      # point map schema, fixtures, cases
contracts/adapters/v1/                       # opcua source settings, quality, events
services/adapters/lib/opcua/                 # connector core
services/adapters/lib/flow.cjs, nodes/adapter.js, manager.cjs, Dockerfile
services/runtime/internal/{sparkplug,devices}/   # quality properties, hearing rule
apps/api/app/Domain/DeviceAdapters/          # connections, point maps, agents, proposals
apps/api/app/Domain/Assistant/               # opcua tools
apps/api/database/migrations/
apps/portal/src/adapters/{sources,pointmap,hierarchy}/
apps/admin/                                  # private ranges per organization
packages/ui/src/components/tree-table.tsx    # with a story
packages/api-client/src/adapters.ts
docs/features/adapters.md, docs/dev/simulators-and-fixtures.md, docs/adr/ADR-052, ADR-053
```

**Structure Decision**: the connector core lives in the adapter package so the tenant
runtime, the manager's browse routes and the agent share one implementation and one
test runner. The simulator sits with the other simulators.

## Complexity Tracking

| Exception | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| A connection record shared by adapters | One server holds many device types and allows few sessions (R1) | Settings on each adapter: several sessions and several certificate trust steps per building |
| A heavy new dependency (`node-opcua-client`) in the tenant runtime | OPC UA's secure channel, sessions and subscriptions are not something to write in-house | A lighter hand-written client: months of protocol work and a security risk |
| Private address ranges per organization | A building on a site VPN has private addresses (FR-016) | Public addresses only: the cloud path would serve almost no real building until the agent ships |
| A new quality value (`uncertain`) crossing the Laravel–Go boundary | OPC UA distinguishes uncertain from bad, and principle VI forbids showing either as healthy | Mapping uncertain to good hides it; mapping it to bad throws away a usable value |
| The on-site agent is a new deployable | Most BMS servers accept no inbound connection (US6) | Third-party gateways only: works today, but every site needs someone else's product configured |
