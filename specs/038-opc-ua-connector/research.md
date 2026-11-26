# Research: OPC UA Connector and Building Simulator

Decisions that shape the plan. Each cites the code or document it rests on. Items
marked **Verify** are assumptions the named pull request must confirm by measurement
before building on them.

## R1. Connections are records of their own, shared by data sources

- **Decision**: a new `adapter_connections` record (protocol `opcua`) holds the server
  address, security, sign-in, the accepted server certificate and the platform's
  certificate. A device adapter with source type `opcua` references one connection.
  In the tenant runtime one connection object holds one session; every OPC UA source
  on that connection registers its points with it.
- **Rationale**: an adapter is one device type
  ([adapters](../../docs/features/adapters.md)) and a building server holds many.
  One session per adapter would multiply sessions against servers that allow few, and
  would ask for the certificate trust step once per device type.
- **Alternatives**: one adapter with several profiles (changes Discovery, activation
  and the profile-move rule for every adapter); connection settings copied into each
  adapter (several sessions, several trust steps, secrets duplicated).

## R2. Client library: `node-opcua-client`, wrapped in a library with no Node-RED in it

- **Decision**: the connector core is `services/adapters/lib/opcua/` (session,
  security, browse, resolve, subscribe, quality), built on `node-opcua-client` (MIT).
  The Node-RED node is a thin wrapper. The on-site agent and the manager's browse
  routes import the same library.
- **Rationale**: the adapter runtime is Node; node-opcua is the complete, maintained
  client for it. [ADR-045](../../docs/adr/ADR-045-adapter-runtime-without-node-red.md)
  proposes dropping Node-RED, so nothing here may depend on it.
- **Alternatives**: a Go client (`gopcua`) inside the data plane (breaks ADR-023: the
  runtime ingests only Sparkplug B, and Go must not call out to tenant servers); a
  separate OPC UA service shared by tenants (breaks ADR-010 isolation).
- **Verify (PR 2)**: resident memory of a tenant runtime holding 5,000 monitored items
  at 10 s sampling. The runtime is limited to 512 MiB and 1 CPU (`manager.cjs`). If it
  does not fit with a third to spare, tenants with an OPC UA connection get a larger
  limit, set by the manager when the first connection is deployed.

## R3. No decoder: the source emits decoder-output results

- **Decision**: an OPC UA flow is source → publisher → reporter. The source emits the
  existing decoder-output shape (`sourceDeviceId`, `observedAt`, `metrics`), extended
  with an optional per-metric `quality` (`good`, `uncertain`, `bad`) and `reason`.
  `decoder-output.v1` gains these as optional fields (additive).
- **Rationale**: `lib/flow.cjs` already builds a fixed chain; the publisher owns
  births, aliases, deduplication and history marks and needs none of it rebuilt.
- **Alternatives**: generate a JavaScript decoder from the point map (a sandbox hop
  per value for typed data, and a second representation of the map to keep in step).

## R4. Quality travels as metric properties; the Go runtime gains `uncertain`

- **Decision**: the publisher sends a bad value as a null metric with the String
  properties `quality: bad` and `quality_reason`, and an uncertain value with its
  value and `quality: uncertain`. `decodeMetric` (`sparkplug/session.go`) already reads
  String properties (`timestamp_source`); it reads these two as well. `profile.go`
  stores bad as `invalid` with the reason as the diagnostic (as a null metric is stored
  today) and uncertain as a new quality `uncertain` with its value.
- **Rationale**: principle VI. The runtime has `good` and `invalid` today
  (`devices/profile.go`); a null already becomes `invalid` with no value.
- **Reason words**: `Bad_NoCommunication` → "No communication with the device",
  `Bad_SensorFailure` → "Sensor failure", `Bad_NotConnected` → "Not connected",
  `Bad_OutOfService` → "Out of service", `Bad_DeviceFailure` → "Device failure",
  `Bad_ConfigurationError` → "Configuration error"; any other bad code → "Bad value
  (<code name>)".
- **Verify (PR 5)**: every reader of `quality` (API resources, portal `statusOf`,
  dashboards, rules) treats an unknown string safely; add `uncertain` to the reading
  contract in `contracts/devices` and its fixtures.

## R5. Hearing from a device needs one good reading

- **Decision**: for adapter-fed devices, a report counts as hearing from the device
  only when at least one reading in it is neither historical nor bad.
- **Rationale**: a BMS reports a dead field controller as bad quality on every point.
  Counting those reports would keep a dead controller online
  ([offline alerts](../../docs/features/alerts.md#offline-alerts): "only a new reading
  counts").
- **Verify (PR 5)**: where the runtime decides "heard" for adapter devices, and whether
  an all-null DDATA counts today. If it does, this is a behaviour change for every
  adapter, to be stated in the pull request.

## R6. A reporting rhythm keeps steady devices online

- **Decision**: besides change reports, the connection reads each equipment's points
  once per rhythm (5 minutes by default) and publishes them with the **server's**
  timestamp of that read, labelled `timestamp_source: server`. Change reports carry
  the source timestamp.
- **Rationale**: subscriptions are silent while nothing changes, and adapter devices
  are judged by silence. A rhythm report truthfully says "at this time the server
  confirmed this value". Re-sending the old source timestamp would be marked
  historical by the publisher (`nodes/adapter.js`, older than the newest sent) and
  would not count.
- **Cost**: 5,000 points at a 5-minute rhythm store about 1.4 million rows a day
  before any change reports. The rhythm is a setting (1 minute to 1 hour) and the
  review states the expected rows per day.
- **Alternatives**: a presence-only heartbeat with no values (leaves each parameter's
  freshness stale on the device page); treating the session as the device's presence
  (a connected server says nothing about one field controller).

## R7. Equipment is identified by its path of names; node addresses are hints

- **Decision**: `sourceDeviceId` is the equipment's browse path from the connection's
  root, as namespace URI and name pairs rendered to one string. The point map stores
  each address as a node id with its namespace **URI** (never the index) plus the path
  of names. On connect the library resolves paths with
  `TranslateBrowsePathsToNodeIds` when a stored node id does not resolve.
- **Rationale**: namespace indexes and, on some servers, numeric node ids change
  across restarts. Paths are what a person recognises, and they give US7 its
  structure.

## R8. Browsing before deploy runs in the manager with short-lived sessions

- **Decision**: `adapter-manager` gains routes to list endpoints, test a connection,
  browse, read and resolve, as it has `/poll-test` for Fetch now. Laravel passes the
  connection's settings and secrets with each call; the manager keeps a session per
  connection for 2 idle minutes, then closes it. When the connection has a deployed
  revision, the manager asks the tenant runtime's live session instead, so a server
  never sees two sessions for one connection.
- **Rationale**: browsing must work before a first deployment (FR-020), and the
  precedent (Fetch now) already runs source code in the manager.
- **Risk**: servers with a single-session limit. The failure reason "server too busy"
  covers it and names the session limit.

## R9. Certificates

- **Decision**: Laravel generates the platform's certificate per connection
  (self-signed, RSA 2048, 5 years, application URI
  `urn:iot-os:<organization uuid>:opcua:<connection uuid>`), stores the key encrypted
  with the connection's secrets, and serves only the certificate for download. The
  runtime writes both into a per-connection PKI folder under `/data` at deploy.
  Accepted policies: `Basic256Sha256`, `Aes128_Sha256_RsaOaep`,
  `Aes256_Sha256_RsaPss`; `None` behind the warning; `Basic128Rsa15` and `Basic256`
  are refused as unsafe. The server certificate is pinned by SHA-256 fingerprint after
  a person accepts it; the library's automatic trust is switched off.
- **Rationale**: a key that lived only in the runtime's volume would be lost with it,
  and the site's BMS administrator would have to trust a new certificate.

## R10. Private addresses are allowed per organization by the operator

- **Decision**: `adapter_tenants` gains `private_ranges` (a list of CIDRs), edited only
  in the admin app by platform staff, and passed to the manager with each call. The
  guard in `lib/broker.cjs` becomes a shared address check that accepts public
  addresses plus those ranges. A range may never include loopback, link-local,
  metadata addresses or the platform's own container networks. The existing
  development switch (`IOT_ADAPTER_ALLOW_PRIVATE_BROKERS`) lets the local stack reach
  the simulator.
- **Rationale**: tenant containers join the platform network (a known risk in
  ADR-010), so "any private address" would let a tenant point a connection at
  platform services.

## R11. The point map is a protocol-neutral contract

- **Decision**: `contracts/pointmaps/v1/point-map.v1.schema.json` with fixtures and
  cases. The map's shared part is readings (key, name, data type, unit, scale, offset,
  reporting) and equipment (source id, display name); each carries an `address` whose
  shape depends on `protocol`. `opcua` is the only protocol defined now.
- **Rationale**: ADR-023 ("point maps need their own contract and editor when the
  first typed protocol is specified") and principle IV. Modbus registers, BACnet
  objects and OBIS codes slot in as further address shapes.
- A point map revision stores no decoder code. Its deploy gate, in place of the
  decoder test, is a **review check**: the manager resolves every point of every
  equipment once and returns a value, status and problem per point. A revision is
  deployable when the check finds no structural problem; a point missing on some
  equipment is a warning (US3 scenario 4).

## R12. Subscriptions

- **Decision**: one subscription per sampling interval in use; monitored items created
  in batches inside the server's `OperationLimits`; queue size 1, newest kept;
  `DataChangeFilter` on status and value with a percent deadband when the point has a
  range and the server supports it, otherwise the deadband is applied in the client.
  Values are grouped per equipment into one result per second. Points beyond the
  server's monitored-item limits are read by polling at the rhythm.
- **Reconnect**: growing pauses from 1 s to 5 min; the session and subscriptions are
  rebuilt, and refused points are tried again.

## R13. Simulator: Python `asyncua`, one fixed building

- **Decision**: `tooling/simulators/bms_server.py` with a small `bms/` package
  (building model, dynamics, scenarios, naming styles), run from the simulators'
  Python environment and as the Compose service `bms-simulator` in a new overlay
  `compose.bms-simulator.yml`. Scenarios are switched through a local HTTP control
  port and a small controls page, as `fire_watch_box.py` does. Analog points use
  `AnalogItemType` with `EURange` and `EngineeringUnits`; on/off and named states use
  the discrete item types with their labels. The structured style declares object
  types (air handling unit, zone controller, chiller, meter); the flat style does not.
- **Rationale**: the other simulators are Python, and a server written with a
  different library than the client exposes interoperability mistakes that a
  node-opcua server would hide. `asyncua` is LGPL; it is a development tool that is
  never shipped.
- **Independent server (SC-007)**: Microsoft's OPC PLC server container is the first
  candidate, run locally by the verification script; any vendor's demo server also
  satisfies the criterion.

## R14. Several sources are activated in one request

- **Decision**: a batch route activates up to 200 candidates as one queued operation
  with a per-source result, reusing `AdapterService`'s single activation.
- **Rationale**: a floor of zone controllers is 30 to 100 identical sources; one
  dialog per source is not usable (FR-041).

## R15. The on-site agent is the same image in agent mode

- **Decision (direction; ADR-053 settles it before PR 7)**: the runtime image runs
  with an enrolment code and no Node-RED. It makes two outbound TLS connections: to
  the platform broker as the adapter's Sparkplug edge node, as the managed publisher
  does from the tenant runtime today, and to its organization's tenant ingress broker
  for control (the deployed revision, browse requests, status). A bounded disk queue
  holds 24 hours of readings; replayed readings older than twice the rhythm are sent
  as historical.
- **Rationale**: both brokers are already reachable from outside for devices, each
  with per-identity access rules, so the agent needs no new public service.
- **Open for ADR-053**: the agent's identity and revocation on both brokers, how
  secrets are wrapped for it, and whether ADR-045 lands first.

## R16. The hierarchy proposal consumes spec 009; it does not shape it

- **Decision**: a `HierarchyProposals` service in `DeviceAdapters` builds a proposal
  from the stored equipment paths and applies it only through spec 009's own services
  (create entity, place device, check type rules). It is registered only when the
  entities feature is present. Proposals are stored with the data source.
- **What this feature needs from spec 009's plan**: a way to check a batch of entity
  creations and placements against the type rules without writing, and services
  callable from another domain. No field for a protocol or node address.

## R17. Limits

- **Decision**: `adapters.opcua.max_points` (10,000) and `max_connections` (10) per
  organization, checked by Laravel when a revision is saved and deployed; the scan
  limit (20,000 nodes) and browse page size (200) are enforced in the library.

## R18. The building is one model file

- **Decision (2026-11-25, with the owner)**: Example Tower is defined once, in
  `tooling/simulators/bms/buildings/example-tower.yaml`, planned in
  [building.md](building.md). The simulator builds its address space, physics and both
  naming styles from it and can export it. A 3D model of the building and the check of
  the hierarchy proposal read the same keys and positions.
- **Rationale**: the owner wants a digital twin of the simulated building. Without one
  definition, the simulator, the 3D model and the expected hierarchy become three
  hand-kept copies. Names follow the Brick vocabulary where it has a term, so the
  building reads like a real one.
- **Alternatives**: the building written in Python (nothing else could read it); a full
  Brick or IFC model as the source (far more than the simulator needs, and neither
  carries the point limits and sizes).
- **Verify in PR 1a**: each Brick class named in the model file exists in the Brick
  release the file cites.

## R19. Built-in physics behind an interface

- **Decision**: the simulator runs simple physics of its own behind a three-call
  interface (step the clock, read values, apply a command).
- **Rationale**: the local stack needs a server that starts in seconds in a small
  container and is repeatable from a seed. A search on 2026-11-25 found open source
  building simulators with good physics and controls (BOPTEST on Modelica, Sinergym on
  EnergyPlus), but none that speaks OPC UA, and each brings a heavy run-time. The
  interface leaves room to put one of them behind the same server later.
- **Alternatives**: BOPTEST as the engine from the start (its buildings and point names
  are fixed, so the floor-by-floor plan and the 3D model would have to follow one of
  its test cases); no physics, only curves (commands would change nothing, so
  automations could not be shown).
- **Not verified**: the size of BOPTEST's container and whether it can be paced in real
  time. A spike before anyone commits to it.

## R20. The simulator has controls; the connector still reads only

- **Decision (2026-11-25, with the owner)**: the simulated building has local control
  loops and 531 command points, writable only by an operator sign-in and inside each
  point's limits. The connector, the point map and the platform in this spec do not
  write. Writing is a later spec with its own ADR (which points may be written, limits,
  audit, release of an override, and the path from a device command to an OPC UA
  write).
- **Rationale**: the owner wants to set up automations against the building. Controls
  are cheap to build into a simulator from the start and costly to add to a building
  that was modelled as curves. Keeping the connector read only keeps pull requests 2 to
  7 as planned.
- **Alternatives**: add writing to this spec (reverses a decision merged the same day
  and widens every pull request); leave controls out of the simulator until the writing
  spec (the building and its 3D model would be redone).
