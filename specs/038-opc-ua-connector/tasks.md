---

description: "Tasks for spec 038, OPC UA connector and building simulator"
---

# Tasks: OPC UA Connector and Building Simulator

**Input**: Design documents from `/specs/038-opc-ua-connector/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/api.md](contracts/api.md),
[contracts/manager-api.md](contracts/manager-api.md),
[contracts/point-map.md](contracts/point-map.md),
[contracts/simulator.md](contracts/simulator.md), [quickstart.md](quickstart.md)

**Tests**: included, because the constitution requires them:

- isolation tests for connections, point maps, browse results, agents and proposals (III);
- contract fixtures and cases for every new cross-process shape, and the OpenAPI drift
  check (IV);
- verification in the rebuilt stack against the simulator (IX).

API tests run on PostgreSQL only. In a worktree, follow the worktree API test recipe:
copy `vendor`, run `composer install`, and use a throwaway `APP_KEY`.

**Organization**: phases follow the ten pull requests in the plan's **Delivery**
section. Each pull request is based on `main`, opened after the one before it merges,
and never stacked. Story labels map tasks to the spec's user stories (US1 to US7).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task).
- **[Story]**: US1 to US7 from [spec.md](spec.md).
- Paths are from the repository root.
- Every verification task takes the stack rebuild lock (`.local/stack-rebuild.lock`)
  before any `docker compose` build and removes it afterwards.
- Fixtures, docs and the simulator use `example.com`, `.test` hosts, documentation
  addresses and the names "Example Campus" and "Example Tower" only.
- New code and docs follow the limits and names in [data-model.md](data-model.md).

---

## Phase 1: Documents (pull request 0)

**Purpose**: merge the spec, plan, tasks and ADR before any code. Merging accepts the
plan.

- [x] T001 Write the spec, research, data model, contracts, quickstart, checklist, plan and tasks in specs/038-opc-ua-connector/
- [x] T002 [P] Add docs/adr/ADR-052-server-connections-and-point-maps.md and its row in docs/adr/README.md
- [x] T003 [P] Add the **OPC UA connector** entry under **Devices and adapters** in docs/roadmap.md, naming spec 009 as the prerequisite of its last pull request

**Checkpoint**: pull request 0 merged.

---

## Phase 2: The simulated building (pull requests 1a and 1b) — User Story 1 (P1)

**Goal**: a BMS server to build against: Example Tower as planned in
[building.md](building.md), with its own control loops and command points.

**Independent Test**: [quickstart A](quickstart.md#a-the-simulated-building-pr-1a-and-1b).

### Pull request 1a: the building, its physics and its controls

- [x] T004 [US1] Add `asyncua` and `PyYAML` (pinned) to tooling/simulators/requirements.txt and note their licences and development-only use in docs/dev/simulators-and-fixtures.md (asyncua 2.1.0, PyYAML 6.0.3; licences noted with the simulator's section)
- [x] T106 [US1] Create tooling/simulators/bms/buildings/example-tower.yaml and tooling/simulators/bms/buildings/building.schema.json: the levels, zones (outlines), equipment (key, type, level, zone, feeds, position `x, y, z`, facing, footprint), point library (key, name, kind, data type, unit, range, states, command limits, Brick class where one exists) and sizes of [building.md](building.md), with the keys of its **Names and keys** section (pumps take their key kind from their role, so the booster pumps are `BP`; the lifts are listed at the ground landing; state labels are quoted, since YAML reads a bare `On` as true)
- [x] T005 [US1] Create tooling/simulators/bms/model.py: load the model file, check it against the schema, and build the equipment and points for `standard` (706 points, 84 devices), `tower` (2,466 points, 294 devices) and `large` (30 office floors, at least 5,000 points); `--export-model` prints it as JSON (`large` puts 22 more office floors above the plant floor, L11 to L32)
- [x] T107 [P] [US1] Create tooling/simulators/bms/physics.py: the interface (step the clock, read values, apply a command) and the built-in physics of building.md **How the building behaves** (weather, people, zone heat balance with sun and blinds, coil and plant load, electricity and water that add up) (zones have an air node and a structure node; perimeter zones whose box cannot heat have heating under the glazing)
- [x] T108 [P] [US1] Create tooling/simulators/bms/controls.py: the local control loops of building.md **Controls** (zone box, air handling unit, chilled water plant, heating plant, car park ventilation, lighting, blinds, generator and transfer switch) and the command points with their limits and hand mode (plus morning warm-up, supply air reset in cool weather, the night low limit and demand ventilation at the zone box)
- [x] T006 [P] [US1] Create tooling/simulators/bms/dynamics.py: a seeded, repeatable simulated day (schedules by zone kind, the weather curve and `--season`, totals that only rise) with an adjustable speed
- [x] T009 [US1] Create tooling/simulators/bms_server.py: the `asyncua` server with namespace `urn:example:bms:example-tower`, the structured style (folders and typed objects, object types declared), `AnalogItemType` points with `EURange` and `EngineeringUnits`, discrete types with labels, command points writable only by the `operator` sign-in and refused with `BadOutOfRange`, `BadTypeMismatch` or `BadUserAccessDenied`, the options `--size --speed --seed --season --writes --export-model --port --host --control-port`, and the control port's `GET /state` and `POST /write` (1a serves the unencrypted endpoint with anonymous and name-and-password sign-in; the operator's password is generated into `.local/devices/bms-simulator.json`)
- [x] T011 [P] [US1] Create tooling/simulators/test_bms_model.py, test_bms_physics.py and test_bms_controls.py: the model file against its schema and the totals in building.md; the same seed gives the same day; totals never fall; sub-meters add up to the main meter within 1%; every control loop reaches its setpoint; every command kind accepted, out of range, wrong type, not allowed and in hand mode (unittest, so CI's simulator job runs them; test_bms_server.py adds the reads and writes through a client)
- [x] T109 [US1] Run quickstart A steps 1, 2, 5, 7, 8 and 9 and record the result in the pull request (steps 1, 2, 5, 7, 8 and 9 pass; recorded in the pull request)

### Pull request 1b: faults, naming styles, security and the stack

- [ ] T007 [P] [US1] Create tooling/simulators/bms/scenarios.py: the eighteen scenarios of the simulator contract, each switchable at run time with an optional target
- [ ] T008 [P] [US1] Create tooling/simulators/bms/naming.py: the `flat` style (one folder of tags such as `ET_L03_VAV_2.ZN-T`) beside the structured style, over the same model
- [ ] T110 [US1] Extend tooling/simulators/bms_server.py with `--style --security --auth --strict-trust --node-ids`, certificates and test sign-in values (including `operator`) generated into `.local/devices/` at first start, and `POST /scenarios/{name}` on the control port
- [ ] T010 [P] [US1] Create tooling/simulators/bms_controls.html: scenario switches and a small form that writes a command through the control port, in the style of tooling/simulators/fire_watch_controls.html
- [ ] T111 [P] [US1] Create tooling/simulators/test_bms_scenarios.py: every scenario's effect; both styles expose the same points
- [ ] T012 [US1] Create tooling/simulators/test_bms_server.py: one browse and read through an `asyncua` client for each security and sign-in choice, `--strict-trust` refusing an unknown client, and `--node-ids renumber` changing numeric ids while paths stay
- [ ] T013 [US1] Create deploy/compose/compose.bms-simulator.yml (service `bms-simulator`, internal network, port 4840 also on `127.0.0.1`, control port on `127.0.0.1` only) and a small image definition deploy/docker/bms-simulator/Dockerfile on `python:3.12-slim`
- [ ] T014 [P] [US1] Document the simulator in docs/dev/simulators-and-fixtures.md (the building and its model file, options, commands, scenarios, controls page, the overlay, and that a passing simulator run is not verification against a real building) and add it to the list in tooling/README.md
- [ ] T015 [US1] Run all of quickstart A in the stack and record the result in the pull request

**Checkpoint**: any standard OPC UA client can browse the tower, see a zone go offline,
and move a zone's temperature by writing its setpoint.

---

## Phase 3: Contract and connector core (pull request 2) — foundation for US2 to US4

**Purpose**: the point map contract and the library every later phase uses. No product
surface yet.

- [ ] T016 Add contracts/pointmaps/v1/point-map.v1.schema.json, point-map.v1.fixture.json (the structured zone controller map and a flat one) and point-map.v1.cases.json (rules of [contracts/point-map.md](contracts/point-map.md): unique keys and source ids, `sample_ms` ≥ 1000, `rhythm_seconds` 60 to 3600, namespace URIs never indexes, percent deadband needs a range), and list it in contracts/README.md
- [ ] T017 [P] Extend tooling/verify-devices-contracts.py (or the contracts runner it uses) to validate contracts/pointmaps/v1 fixtures and cases
- [ ] T018 Add `node-opcua-client` (exact version) to services/adapters/package.json and package-lock.json, and confirm services/adapters/Dockerfile builds the runtime and manager targets on linux/amd64 and linux/arm64
- [ ] T019 [P] Create services/adapters/lib/opcua/address.cjs: one address check (public addresses, plus allowed private CIDRs; never loopback, link-local, metadata or the platform networks passed in), and make services/adapters/lib/broker.cjs and lib/poll.cjs use it with unchanged behaviour (research R10)
- [ ] T020 [P] Create services/adapters/lib/opcua/quality.cjs: status code to `good` | `uncertain` | `bad` and the plain reasons of research R4
- [ ] T021 Create services/adapters/lib/opcua/security.cjs: endpoint listing ranked strongest first, refusal of `Basic128Rsa15` and `Basic256`, a per-connection PKI folder, SHA-256 fingerprint pinning with automatic trust switched off (research R9)
- [ ] T022 Create services/adapters/lib/opcua/session.cjs: connect, sign in (anonymous, name and password, certificate), read the server's announced limits and clock difference, reconnect with pauses from 1 s to 5 min, and map failures to the nine reasons of [contracts/api.md](contracts/api.md)
- [ ] T023 [P] Create services/adapters/lib/opcua/browse.cjs: children in pages of 200, attributes (data type, unit, range, state labels, storable or the reason not), branch search stopping at 20,000 nodes, and similar equipment by declared type, matching names or a name pattern
- [ ] T024 [P] Create services/adapters/lib/opcua/resolve.cjs: node id with namespace URI, falling back to `TranslateBrowsePathsToNodeIds` on the path of names (research R7)
- [ ] T025 Create services/adapters/lib/opcua/collect.cjs: one subscription per sampling interval, monitored items in batches inside the server's limits, queue size 1, deadband on the server or in the client, one result per equipment per second, the rhythm read stamped with the server's time, polling for points beyond the limits, and the refused-points list (research R6, R12)
- [ ] T026 [P] Create services/adapters/test/opcua-address.test.cjs and opcua-quality.test.cjs (pure unit tests)
- [ ] T027 Create services/adapters/test/opcua-session.test.cjs, opcua-browse.test.cjs, opcua-resolve.test.cjs and opcua-collect.test.cjs, run against the simulator started by the test: each security and sign-in choice, each failure reason, paging, renumbered node ids, change reports, rhythm reports, bad and uncertain quality, refused points, reconnect after `server_restart`
- [ ] T028 Add the simulator to the adapter job in .github/workflows/ci.yml so T027 runs in CI
- [ ] T029 Measure the tenant runtime's resident memory and CPU holding 5,000 monitored items at 10 s sampling (simulator `--size large`, runtime limits from services/adapters/manager.cjs), record the figures in specs/038-opc-ua-connector/research.md under R2, and state whether the runtime limit must rise for organizations with a connection

**Checkpoint**: the library connects, browses and collects from the simulator under test; the memory decision is recorded.

---

## Phase 4: Connect and browse (pull request 3) — User Story 2 (P1), US3 scenario 1

**Goal**: a manager reaches **Connected** and sees the building as a live tree.

**Independent Test**: [quickstart C](quickstart.md#c-connect-and-browse-pr-3).

- [ ] T030 [US2] Create the migration for `adapter_connections` in apps/api/database/migrations/ with the fields of [data-model.md](data-model.md): `protocol` `opcua`; `name` 1–120 unique in the organization; `runs_at` `platform`|`agent`; `security_policy` `None`|`Basic256Sha256`|`Aes128_Sha256_RsaOaep`|`Aes256_Sha256_RsaPss`; `security_mode` `None`|`Sign`|`SignAndEncrypt`; `identity` `anonymous`|`username`|`certificate`; `state` `draft`|`awaiting_trust`|`connected`|`unreachable`|`stopped`|`paused`; encrypted `secrets`; json `server_certificate`, `pending_server_certificate`, `status`, `refused_points`
- [ ] T031 [P] [US2] Create the migration adding `private_ranges` (json) to `adapter_tenants`
- [ ] T032 [US2] Create apps/api/app/Domain/DeviceAdapters/Models/AdapterConnection.php (`secrets` encrypted and hidden) and add `Opcua` to Enums/AdapterSourceType.php with its label **OPC UA server**
- [ ] T033 [US2] Create apps/api/app/Domain/DeviceAdapters/Services/Connections.php: create, update, the 10-connection limit (`adapters.opcua.max_connections`), the duplicate check (same endpoint, security and identity), generation of the platform certificate (self-signed RSA 2048, 5 years, application URI `urn:iot-os:<organization uuid>:opcua:<connection uuid>`), certificate acceptance, credentials, pause, resume, and deletion refused while a data source uses it
- [ ] T034 [US2] Add the manager routes `/opcua/endpoints`, `/opcua/test`, `/opcua/browse`, `/opcua/read` and `/opcua/search` to services/adapters/manager.cjs per [contracts/manager-api.md](contracts/manager-api.md), with a session per connection closed after 2 idle minutes, and their schemas, fixtures and cases in contracts/adapters/v1/
- [ ] T035 [US2] Extend apps/api/app/Domain/DeviceAdapters/Services/AdapterManager.php with the OPC UA calls, passing the connection, its secrets and the organization's `private_ranges`
- [ ] T036 [US2] Create apps/api/app/Domain/DeviceAdapters/Http/ConnectionController.php and register the connection and browsing routes of [contracts/api.md](contracts/api.md) in apps/api/app/Domain/DeviceAdapters/routes.php (`Device.manage`, organization resolved first, browsing throttled 60 a minute per connection, secrets write-only)
- [ ] T037 [US2] Record one audit event without secret values for create, change, pause, resume, delete, certificate acceptance and credential change (FR-046)
- [ ] T038 [P] [US2] Add `adapters.opcua.*` limits to apps/api/config/ and a staff-only **Private ranges** field for an organization in apps/admin/src/pages/ with validation that refuses loopback, link-local, metadata and platform ranges
- [ ] T039 [US2] Create apps/api/tests/Feature/Domain/DeviceAdapters/ConnectionTest.php: every route, each failure reason passed through with its fix, limits, duplicate refusal, deletion refused when in use, secrets never returned, audit events, and another organization getting `404` on every route including browsing (FR-045)
- [ ] T040 [US2] Regenerate the OpenAPI description (`contract:export`), update the supplement in contracts/openapi/ and add connection and browsing types and methods to packages/api-client/src/adapters.ts
- [ ] T041 [P] [US3] Create packages/ui/src/components/tree-table.tsx (lazy levels, paging, selection, row status, keyboard navigation) with a story in apps/storybook, and export it from the kit
- [ ] T042 [US2] Add the **OPC UA server** choice to apps/portal/src/adapters/SourceChooser.tsx with what the person will need (address, sign-in, someone who can trust a certificate on the server)
- [ ] T043 [US2] Create apps/portal/src/adapters/sources/OpcuaConnection.tsx: address, offered security with the strongest preselected, certificate review with fingerprint, platform certificate download with instructions, the unencrypted warning and **Not encrypted** label, sign-in, **Test**, each failure reason with its fix, and reuse of an existing connection
- [ ] T044 [US3] Create apps/portal/src/adapters/pointmap/AddressTree.tsx on `TreeTable`: one level at a time, live value, unit, status and data type per point, name search, unstorable points greyed with the reason
- [ ] T045 [P] [US2] Add Vitest tests for the connection form's state logic and a Playwright test with a mocked API for connect, certificate review and the tree in apps/portal
- [ ] T046 [US2] Rebuild the affected containers and run quickstart C against the simulator; record the result

**Checkpoint**: Connected from the portal; every failure reason produced on purpose; the tree shows live values.

---

## Phase 5: Choose readings (pull request 4) — User Story 3 (P1)

**Goal**: a reviewed point map saved as an immutable revision.

**Independent Test**: [quickstart D](quickstart.md#d-choose-readings-pr-4).

- [ ] T047 [US3] Create the migration adding `adapter_connection_id` (nullable FK) to `device_adapters`
- [ ] T048 [US3] Create apps/api/app/Domain/DeviceAdapters/Services/PointMaps.php: validation against contracts/pointmaps/v1, suggested keys, names, units and data types from server attributes, the point count against `adapters.opcua.max_points` (10,000), and expected rows a day from points and rhythm
- [ ] T049 [US3] Extend AdapterService::fields in apps/api/app/Domain/DeviceAdapters/Services/AdapterService.php to accept the `opcua` source: a connection and a point map, no code, no fixtures; store the map in the draft and in each revision's `definition.point_map` with the connection's non-secret settings, and its secrets in `secret_snapshot`
- [ ] T050 [US3] Add `/opcua/similar` and `/opcua/check` to services/adapters/manager.cjs with schemas, fixtures and cases in contracts/adapters/v1/
- [ ] T051 [US3] Make `POST device-adapters/{adapter}/test` run the review check for this source type (per equipment and reading a value, status and problem; totals; limit result), store it in `test_result`, and let deploy accept only the exact revision that passed (research R11)
- [ ] T052 [US3] Add `POST device-adapters/{adapter}/point-map/suggest` and the `nodes/similar` route in apps/api/app/Domain/DeviceAdapters/Http/PointMapController.php and routes.php
- [ ] T053 [US3] Allow a point map to target an existing published profile or create a new device type, reusing the adapter flow's profile drafting and publishing (apps/portal/src/adapters/ProfilePublishCard.tsx and its API)
- [ ] T054 [US3] Create apps/api/tests/Feature/Domain/DeviceAdapters/PointMapTest.php: contract validation errors as field errors, suggestions, the limit, review check gating deploy, revision immutability, another organization refused
- [ ] T055 [US3] Update the OpenAPI description and packages/api-client/src/adapters.ts with the point map types and routes
- [ ] T056 [P] [US3] Create apps/portal/src/adapters/pointmap/EquipmentPicker.tsx (mark a node as equipment, tick points) and ReadingsTable.tsx (key, name, unit, scale, offset, sampling, deadband, with the defaults of FR-031)
- [ ] T057 [P] [US3] Create apps/portal/src/adapters/pointmap/SimilarEquipment.tsx (by type, by names, by pattern; missing readings shown; remove any)
- [ ] T058 [US3] Create apps/portal/src/adapters/pointmap/Review.tsx (devices, readings, points, expected rows a day, a current value per reading, every problem) and wire the steps into apps/portal/src/adapters/Routes.tsx and SetupSteps.tsx in place of Decode for this source type
- [ ] T059 [P] [US3] Add Vitest tests for point map editing logic and a Playwright test with a mocked API for the editor and review
- [ ] T060 [US3] Rebuild and run quickstart D on both naming styles; record the result (SC-006)

**Checkpoint**: 14 zone controllers found and reviewed in both styles; nothing is collecting yet.

---

## Phase 6: Start collecting (pull request 5) — User Story 4 (P1)

**Goal**: building data stored, with quality shown truthfully.

**Independent Test**: [quickstart E](quickstart.md#e-start-collecting-pr-5).

- [ ] T061 [US4] Find where the runtime decides an adapter device was heard, and whether an all-null DDATA counts today; record the finding in specs/038-opc-ua-connector/research.md under R5 before changing it
- [ ] T062 [US4] Extend contracts/adapters/v1/decoder-output.v1 (optional per-metric `quality`, `reason`, and `timestampSource` `source`|`server`|`receipt`) and runtime-event.v1 (kinds `connection_status`, `refused_points`, `server_certificate`) with fixtures and cases
- [ ] T063 [US4] Make services/adapters/lib/flow.cjs build source → publisher → reporter for an `opcua` adapter, passing the connection, PKI material and point map
- [ ] T064 [US4] Add the `opcua` source to services/adapters/nodes/adapter.js: a connection registry with one session per connection, registration of each adapter's point map, results forwarded to the publisher, events to the reporter, and the manager's browse routes using the live session when one exists
- [ ] T065 [US4] In the publisher (services/adapters/nodes/adapter.js and lib/sparkplug.cjs) write the `quality` and `quality_reason` properties, send bad values as null metrics, and label rhythm reports `timestamp_source: server`
- [ ] T066 [US4] In services/runtime/internal/sparkplug/session.go read `quality` and `quality_reason`; in internal/devices/profile.go store bad as `invalid` with the reason, uncertain as quality `uncertain` with its value, and `server` as a timestamp source; apply the hearing rule of research R5; add Go tests for each
- [ ] T067 [US4] Add `uncertain` and the `server` timestamp source to the reading contract in contracts/devices/ with fixtures, and make every reader handle them: API resources, the portal's `statusOf`/`Status` in packages/ui, dashboards and rule evaluation (uncertain is not good for a rule unless the rule says so; record the choice in docs/features/devices.md)
- [ ] T068 [US4] Apply the clock bounds (more than 5 minutes ahead or 24 hours behind is stored at receipt time and labelled) in services/adapters/lib/opcua/collect.cjs with a test using the `clock_wrong` scenario
- [ ] T069 [US4] Derive an OPC UA device's automatic *Offline after* from the revision's rhythm where the poll interval is used today (apps/api, offline alerts)
- [ ] T070 [US4] Add `POST device-adapters/{adapter}/candidates/activate` (up to 200, queued, a result per source) to AdapterController and AdapterService, with tests, the OpenAPI update and the api-client method (research R14)
- [ ] T071 [US4] Name each equipment source by its node's display name extended with parent names until unique, keep its path as the source id, and show it in the Devices tab, Discovery and Add device
- [ ] T072 [P] [US4] Add multi-select **Activate** to the data source's Devices tab in apps/portal/src/adapters/ and show unknown-with-reason and uncertain readings on the device page with kit components
- [ ] T073 [US4] Extend services/adapters/integration/verify.cjs with an OPC UA scenario: deploy, DBIRTH per equipment, change and rhythm DDATA, bad as null with properties, redeploy keeping sources
- [ ] T074 [US4] Create tooling/verify-opcua.mjs driving quickstart B to E through the API, with one automated check per simulator scenario (SC-004)
- [ ] T075 [US4] If T029 found the runtime limit too low, raise it in services/adapters/manager.cjs for tenants with an OPC UA deployment and document it in docs/features/adapters.md
- [ ] T076 [US4] Rebuild the manager, runtime image, Go runtime, API family and portal; run quickstart E, the large building for a simulated day (SC-003), and `./taskw devices:test` unchanged (SC-010); record the results

**Checkpoint**: 16 devices storing readings; the offline zone shows unknown; a steady zone stays online.

---

## Phase 7: Run it (pull request 6) — User Story 5 (P2)

**Goal**: a connection someone can keep healthy for years.

**Independent Test**: [quickstart F](quickstart.md#f-run-it-pr-6).

- [ ] T077 [US5] Create apps/api/app/Domain/DeviceAdapters/Services/ConnectionStatus.php: apply `connection_status`, `refused_points` and `server_certificate` events (idempotent), keep the last ten problems, and move a connection to `stopped` with reason `server_certificate_changed`
- [ ] T078 [US5] Make accepting a changed certificate redeploy the applied revision and resume collecting, audited (FR-012)
- [ ] T079 [P] [US5] Add a daily check for certificates expiring within 30 days (the server's and the platform's) that marks the connection and notifies people with `Device.manage` once, scheduled in apps/api/routes/console.php
- [ ] T080 [US5] Refuse deployment over the point limit with the excess stated, in the review check and at deploy (FR-037)
- [ ] T081 [P] [US5] Show connection status, points read and bad, values in the last hour, refused points by equipment and reading, and the last problems in apps/portal/src/adapters/Overview.tsx and Activity.tsx, with **Review certificate** when stopped
- [ ] T082 [US5] Add `opcua_browse`, `opcua_read` and `propose_point_map` to apps/api/app/Domain/Assistant/Tools/OnboardingTools.php and the agent's instructions; results trimmed to `assistant.max_context_characters`, no secrets, proposals only; tests with the agent faked proving it cannot accept a certificate, deploy or activate
- [ ] T083 [P] [US5] Render a point map proposal as a reviewable card in apps/portal/src/adapters/OnboardingAssistant.tsx
- [ ] T084 [US5] Extend apps/api/tests/Feature/Domain/DeviceAdapters/ConnectionTest.php for status events, certificate change, expiry notice, the limit and isolation of status and refused points
- [ ] T085 [P] [US5] Write the **OPC UA server** section of docs/features/adapters.md (connection, security, point map, quality and time rules, limits, failure reasons), update docs/features/assistant.md, docs/architecture/overview.md (remove OPC UA from "not built"), docs/dev/gotchas.md with anything that surprised, and a help guide that does not name the product
- [ ] T086 [US5] Run the connector against an OPC UA server the project did not write (research R13) from tooling/verify-opcua.mjs and record stored readings (SC-007)
- [ ] T087 [US5] Rebuild and run quickstart F; record the result

**Checkpoint**: the cloud path is complete (SC-001 to SC-007).

---

## Phase 8: On-site agent (pull request 7) — User Story 6 (P3)

**Goal**: collect from inside a building with no inbound opening.

**Independent Test**: [quickstart G](quickstart.md#g-on-site-agent-pr-7).

- [ ] T088 [US6] Write docs/adr/ADR-053 (on-site agent: identity and revocation on both brokers, how secrets are wrapped for it, control topics, whether ADR-045 lands first) and have it accepted before the rest of this phase
- [ ] T089 [US6] Create the migration for `adapter_agents` (`enrolment_code_hash`, `enrolment_expires_at` 24 hours single use, `enrolled_at`, `revoked_at`, `version`, `last_seen_at`, json `buffer`) and add `adapter_agent_id` to `adapter_connections`
- [ ] T090 [US6] Create Models/AdapterAgent.php, Services/Agents.php and the agent routes of [contracts/api.md](contracts/api.md), with isolation tests and audit events
- [ ] T091 [US6] Add an `agent` entry point and image target to services/adapters/Dockerfile running the connector core without Node-RED: enrolment, the two outbound connections, the deployed revision received over the control topic
- [ ] T092 [US6] Add the bounded disk queue (24 hours, oldest dropped first with a count) and replay oldest first, sending readings older than twice the rhythm as historical (FR-052), with tests that cut the uplink
- [ ] T093 [US6] Relay browse, check, deploy and status between services/adapters/manager.cjs and an agent, so every route of [contracts/manager-api.md](contracts/manager-api.md) behaves the same for `runs_at: agent` (FR-053)
- [ ] T094 [P] [US6] Add the agent list, enrolment code (shown once), revoke, version notice with the update command, and the **Runs at** choice to the portal under apps/portal/src/adapters/
- [ ] T095 [P] [US6] Document running and updating the agent in docs/features/adapters.md and docs/ops/
- [ ] T096 [US6] Run quickstart G with the agent on a network the platform cannot reach into; record the result (SC-008)

**Checkpoint**: a building connects with outbound connections only.

---

## Phase 9: Hierarchy proposal (pull request 8) — User Story 7 (P3, needs spec 009 built)

**Goal**: building data lands in the organization's own hierarchy, reviewed by a person.

**Independent Test**: [quickstart H](quickstart.md#h-hierarchy-proposal-pr-8-with-spec-009-built).

- [ ] T097 [US7] Confirm spec 009 is merged and offers the services research R16 needs (create entity, place device, a rules check without saving); if not, stop and raise it against spec 009
- [ ] T098 [US7] Create the migration for `adapter_hierarchy_proposals` (`tag_split`, `items` with states `proposed`|`edited`|`dropped`|`applied`|`refused`, `applied_by`, `applied_at`)
- [ ] T099 [US7] Create apps/api/app/Domain/DeviceAdapters/Services/HierarchyProposals.php: build from equipment paths or a tag split, suggest types from the organization's types by depth and name, edit, drop, use an existing entity, apply through spec 009's services with its permission and rules, and offer additions only on a later run; registered only when the entities feature is present
- [ ] T100 [US7] Add the proposal routes of [contracts/api.md](contracts/api.md) (`404` when the feature is absent), tests for apply, refusals with the rule, additions only, isolation, and a test that no entity or placement carries a protocol or node address (FR-062)
- [ ] T101 [P] [US7] Create apps/portal/src/adapters/hierarchy/Proposal.tsx on `TreeTable` (rename, retype, merge, move, drop, use existing, apply) shown only when the feature is present
- [ ] T102 [P] [US7] Document the proposal in docs/features/adapters.md and in the hierarchy's feature doc
- [ ] T103 [US7] Run quickstart H; record the result (SC-009)

**Checkpoint**: the simulated building is proposed, edited and applied; a second run adds nothing.

---

## Phase 10: Close out

- [ ] T104 Run `/speckit-converge` and fix what it finds
- [ ] T105 Set ADR-052 (and ADR-053) to Accepted, update docs/roadmap.md, and freeze specs/038-opc-ua-connector/ per docs/dev/specs.md

---

## Dependencies

- Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7, each a merged pull request before the next branches from `main`.
- Phase 8 needs Phase 7 and an accepted ADR-053.
- Phase 9 needs Phase 6 and spec 009 built; it does not need Phase 8.
- T029 (memory) gates T075. T061 (hearing today) gates T066.

## Parallel opportunities

- Phase 2, pull request 1a: T107, T108 and T006 after T005; T011 beside them. Pull request 1b: T007, T008, T010, T111, T014.
- Phase 3: T019, T020, T023, T024, T026 beside T021 and T022.
- Phase 4: T031, T038, T041 and T045 beside the API work; T041 can start as soon as Phase 3 merges.
- Phase 5: T056, T057 and T059 beside the API work.
- Phase 7: T079, T081, T083 and T085.
- Spec 009's plan and build run beside Phases 2 to 8.

## Implementation strategy

- **First increment**: Phase 2 alone. The simulator is useful by itself and fixes what "a building" means.
- **Minimum useful product**: Phases 2 to 6 (US1 to US4): a reachable building's data stored and alerted on.
- **Then**: Phase 7 makes it operable, Phase 8 makes real buildings reachable without a VPN, Phase 9 joins the hierarchy.
- Stop after any phase and the stack still works: each pull request is complete and verified against the simulator.
