# Feature Specification: OPC UA Connector and Building Simulator

**Feature Branch**: `spec/038-opc-ua-connector`

**Created**: 2026-11-25

**Status**: Draft

**Input**: Owner request: "I want to implement an OPC UA adapter so that I can connect
to buildings easily. Simulate a BMS properly first. It should map onto the entity
hierarchy, which stays independent of the OPC UA protocol: it maps the structure of an
organization and its physical hierarchy, the placement of data sources."

## Context

[ADR-023](../../docs/adr/ADR-023-protocol-connectors.md) already decided how OPC UA
arrives: every protocol is a connector that owns only its protocol's mechanics, typed
protocols use a reviewable **point map** instead of a decoder, and the connector runs
where the server can be reached (in the tenant's runtime for a reachable server, in an
edge gateway with a Sparkplug B uplink on a plant network). None of it is built. No
simulator speaks OPC UA, and the point map has no contract or editor ("specified with
the first typed connector", [spec 021](../021-data-first-onboarding/spec.md) US8).

The entity hierarchy is spec 009 (a draft on the branch `spec/009-entity-hierarchy`,
not planned or built). It is independent of any protocol and
already has a Buildings preset (Site → Building → Floor → Zone → Room) and the placement
of a device or a single parameter at any entity.

Reading the code and the two specs turned up four facts that shape the requirements:

1. **An adapter is one device type; a building server holds many.** A device adapter
   picks one published profile and its sources are that type's serial numbers
   ([adapters](../../docs/features/adapters.md)). One building management system (BMS)
   server exposes air handling units, room controllers, chillers and meters together,
   and servers limit how many sessions a client may open. The server link therefore has
   to be shared by several adapters (FR-010).
2. **Subscriptions go quiet when nothing changes.** Adapter devices are judged by their
   own silence, and only a new reading counts as hearing from one
   ([offline alerts](../../docs/features/alerts.md#offline-alerts)). An OPC UA
   subscription reports changes, so a steady room would look offline unless the
   connector also reports on a rhythm (FR-032).
3. **Outbound connections accept only public addresses.** The polling and vendor-broker
   sources refuse private addresses (`services/adapters/lib/broker.cjs`,
   `lib/poll.cjs`). A building reached over a site VPN, and the simulator in the dev
   stack, have private addresses (FR-016).
4. **Readings already carry quality.** The runtime stores `good` or `invalid` with a
   diagnostic and no value (`services/runtime/internal/devices`). OPC UA gives every
   value a status code, and a BMS reports a field controller that stopped answering as
   bad quality, not as silence (FR-033, principle VI).

One caution recorded for the owner: most building controllers speak BACnet. OPC UA is
usually offered one level up, by the BMS server or a site gateway. This feature targets
that supervisory server. BACnet and Modbus stay separate connectors (ADR-023).

**Decisions taken with the owner, 2026-11-25**

- **Cloud first, on site next.** One connector core. It first runs in the tenant
  adapter runtime and connects out to a reachable server. The same core is then
  packaged as an on-site agent that dials out (US6).
- **Separate specs, linked.** This feature ships without spec 009. Its last story
  proposes entities and placements from the server's structure and is switched on only
  once spec 009 is built (US7). The connector never writes the hierarchy by itself.
- **Read only.** No setpoints, no method calls.

**Boundaries that do not change**

- The data plane ingests only Sparkplug B. The connector's output goes through the
  managed publisher, Discovery, review and activation as they are (FR-040).
- Revisions are immutable and nothing runs until it is deployed and acknowledged
  (principle II). Nothing a server reports is stored as telemetry until a person
  activates its device.
- No role or permission changes: every action needs `Device.manage`, as adapters do.
- AI proposes, people approve; everything works with the assistant disabled
  (principle V).
- Existing adapters, sources, decoders and routes keep working. API changes are
  additive.

**Terms**

- *Server*: an OPC UA server, here a building's BMS server or site gateway.
- *Connection*: an organization's saved link to one server: its address, security
  choice, sign-in and the trusted server certificate. It holds one session.
- *Node*: one item in the server's address space: a folder, an object or a variable.
- *Point*: a variable node with a value (a temperature, a valve position, an alarm).
- *Equipment*: a node whose points belong to one physical thing (one air handling unit,
  one meter). Each equipment becomes one source, then one device.
- *Point map*: for one device type, which point feeds each reading, with its unit,
  scale and reporting settings, and the list of equipment it applies to.
- *Data source*: what people see a device adapter called in the journey (spec 021).
- *On-site agent*: the connector packaged to run inside the building's network.
- *Simulator*: the simulated BMS server this feature adds for development and tests.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A simulated building to build against (Priority: P1)

A developer starts a simulated BMS server in the local stack. It exposes one realistic
office building over OPC UA, behaves like a building over a day, and can be told to
misbehave. Every later story is built and verified against it.

**Why this priority**: nobody on the team has a BMS on their desk, and the owner asked
for the simulation first. It also fixes what "a building" means before the connector
is designed.

**Independent Test**: start the simulator, connect any standard OPC UA client, browse
Site → Building → Floor → Zone, read a zone temperature with its unit and a good
status, switch on the "controller offline" scenario and see that zone's points turn bad
while the rest stay good.

**Acceptance Scenarios**:

1. **Given** the simulator is running, **Then** it exposes one site with one building
   of four floors and four zones a floor, holding: 2 air handling units, 16 zone
   controllers (one per zone), a chilled water plant (2 chillers, 2 pumps, a cooling
   tower), a heating plant (a boiler, 2 pumps), electricity meters (one main, one per
   floor), a water meter and a heat meter. Together they expose at least 400 points.
2. **Given** any point, **Then** it has a data type (number, on/off, a named state or
   text), a display name, a description, an engineering unit where it has one, a source
   time and a status.
3. **Given** the simulated day, **Then** values follow it: occupied and unoccupied
   hours, an outdoor temperature curve, zones drifting towards their setpoint, plant
   starting and stopping with load, and meter totals that only rise. The clock can run
   faster than real time, and a given seed always produces the same day.
4. **Given** a named scenario is switched on, **Then** the building shows it: a damper
   stuck, a filter alarm, a chiller trip, a field controller offline (its points turn
   bad with a "no communication" status), a failed sensor (one point bad), a server
   restart, a changed server certificate, a wrong server clock, and a meter replaced
   (its total starts again from zero).
5. **Given** the naming style option, **Then** the same building is exposed either
   **structured** (folders for site, building, floor and zone, with each equipment as
   an object) or **flat** (one long list of vendor-style tag names such as
   `B1_F03_VAV_2.ZN-T` with no folders), because real sites come both ways.
6. **Given** the security options, **Then** the simulator offers an unencrypted
   endpoint and an encrypted one, and accepts anonymous, name-and-password and
   certificate sign-in, each of which can be switched off to force the others.
7. **Given** a size option, **Then** the simulator can expose a larger building of at
   least 5,000 points for load checks.

---

### User Story 2 - Connect to a building's server (Priority: P1)

A manager chooses "It's an OPC UA server" as their data's origin, enters the server's
address, picks how to secure and sign in, confirms the server's identity, and sees
**Connected**. When it fails, the page says why and what to do.

**Why this priority**: security set-up is where OPC UA connections fail in practice;
nothing else can happen before it.

**Independent Test**: against the simulator's encrypted endpoint with name-and-password
sign-in: enter the address, review and accept the server's certificate fingerprint,
download the platform's certificate, sign in, and reach **Connected**. Repeat with a
wrong password and with the server not trusting the platform: each shows its own
reason and fix.

**Acceptance Scenarios**:

1. **Given** a server address, **When** the person asks what the server offers,
   **Then** its security choices are listed from strongest to weakest with the
   strongest preselected, together with the sign-in methods it accepts.
2. **Given** the first connection, **Then** the server's certificate is shown (name,
   fingerprint, validity) and nothing more is sent until the person accepts it. The
   accepted certificate is remembered for the connection.
3. **Given** an encrypted choice, **Then** the person can download the platform's
   certificate for this connection, with instructions to trust it on the server, and
   can come back to this step and continue.
4. **Given** the person chooses the unencrypted option, **Then** they must confirm a
   warning that values and sign-in details can be read on the network path, and the
   connection is labelled **Not encrypted** wherever it is shown.
5. **Given** a sign-in method, **Then** the person enters a name and password or
   uploads a certificate and key, or chooses anonymous. Secrets are never shown again.
6. **Given** a failure, **Then** the page names one of: address not reachable, address
   not allowed, no shared security choice, server certificate changed, server does not
   trust the platform's certificate, sign-in refused, server too busy (session limit),
   server clock too far out, or timed out. Each has a one-line fix.
7. **Given** a connection that works, **Then** it is saved and offered when the person
   later adds another device type from the same server, with no second sign-in.

---

### User Story 3 - See the building and choose readings (Priority: P1)

The manager browses the server as a tree with live values, opens one piece of
equipment, ticks the points to keep, and names the device type. The platform finds the
other equipment of the same shape and shows the point map for review.

**Why this priority**: this is the point map editor every typed protocol will reuse,
and it replaces writing a decoder.

**Independent Test**: on the simulator's structured building, open one zone
controller, keep zone temperature, setpoint, damper position and occupancy, and name
the type "Zone controller". The review lists all 16 zone controllers with those four
readings, each with unit and a current value. Repeat on the flat style by giving the
tag pattern; the same 16 are found.

**Acceptance Scenarios**:

1. **Given** a connection, **Then** the server's tree loads one level at a time, wide
   levels are paged, and each point shows its current value, unit, status and data
   type. A tree can be searched by name within the part already opened and by scanning
   a chosen branch.
2. **Given** the person marks a node as equipment and ticks points under it, **Then**
   each ticked point becomes a reading with a suggested key and name (from the point's
   name), a suggested unit (from the server's unit when it gives one), and its data
   type. All are editable.
3. **Given** one mapped equipment, **When** the person asks for similar equipment,
   **Then** the platform lists nodes with the same points: by the server's type when it
   declares one, otherwise by matching point names under sibling nodes, or by a name
   pattern the person gives for flat tag lists. The person removes any they do not
   want.
4. **Given** similar equipment that lacks one of the mapped points, **Then** it is
   listed with that reading marked missing, and it can still be included.
5. **Given** a reading, **Then** the person can set a scale and offset, and how it
   reports: how often it is sampled, and how much a number must change to count.
   Defaults suit a building (FR-031).
6. **Given** points of a kind the platform cannot store (lists of values, structures,
   very long text), **Then** they are shown greyed with the reason and cannot be
   ticked.
7. **Given** the review, **Then** it states how many devices and readings the map will
   create, shows a current value for each reading of one equipment, and lists every
   problem (duplicate keys, a point used twice, a missing unit on a number) before it
   can be saved.
8. **Given** an existing published device profile fits, **Then** the person can map
   points onto its readings instead of creating a new type.

---

### User Story 4 - Start collecting (Priority: P1)

The manager deploys the reviewed point map. Each equipment appears as a source waiting
to be activated, exactly like a vendor device's serial number. Activated devices show
live values, units, and unknown where the building does not know.

**Why this priority**: it is the outcome: building data stored, charted, alerted on.

**Independent Test**: deploy the "Zone controller" map from US3 and activate the 16
sources at once. Within a minute each device shows four readings with units. Switch on
"controller offline" for one zone: that device's readings turn unknown with the reason
and it goes offline by the normal rule; the other 15 are unaffected. Leave a zone
steady for 30 minutes: it stays online.

**Acceptance Scenarios**:

1. **Given** a saved point map, **When** it is deployed and the runtime acknowledges
   it, **Then** each equipment is listed as a waiting source named after its node, with
   its current readings as a preview, in the data source's Devices tab, Discovery and
   Add device.
2. **Given** waiting sources, **Then** the person can activate one, several or all of
   them in one action, and each becomes a device named after its equipment.
3. **Given** an activated device, **Then** each reading is stored at the time the
   server says the value was measured, with its unit, and labelled when that time came
   from the platform instead (FR-034).
4. **Given** a point reports bad quality, **Then** the reading is stored as unknown
   with the server's reason in plain words (no communication, sensor failure, not
   connected, out of service), never as its last value, zero or a healthy value. An
   uncertain quality keeps the value and is labelled uncertain.
5. **Given** every point of a device is bad, **Then** the device is not counted as
   heard from, and it goes offline by the existing rule.
6. **Given** a steady value, **Then** the device still reports at least once every
   reporting rhythm (FR-032) and stays online.
7. **Given** the connection to the server drops, **Then** the data source shows
   **Server unreachable** with the time and reason, the connector retries with growing
   pauses, devices go offline by the existing rule, and when it reconnects collecting
   resumes without a person acting. Values missed in between are a gap, not filled.
8. **Given** the point map changes (a reading added, equipment added or removed),
   **Then** a new revision is deployed, existing devices keep their history, and new
   equipment appears as new waiting sources.

---

### User Story 5 - Run it: status, limits and the assistant (Priority: P2)

Once collecting, the manager sees for each connection whether it is connected, how
many points it reads, how many are bad, and what last went wrong. The onboarding
assistant can walk the same steps.

**Why this priority**: a building connection lives for years; someone must be able to
tell at a glance whether it is healthy. The first connection works without this.

**Independent Test**: with the simulator connected, the data source shows connected,
points read, points bad and the last change. Switch on "certificate changed": the
connection stops with **Server certificate changed** and a review button; accepting
the new certificate resumes it. Ask the assistant to "add the electricity meters from
this server": it proposes a point map the person reviews and saves.

**Acceptance Scenarios**:

1. **Given** a connection, **Then** its status shows: connected or not and since when,
   the security in use, points read, points currently bad, values received in the last
   hour, and the last ten problems with their times.
2. **Given** the server's certificate changes, **Then** collecting stops, nothing is
   sent to the changed server, and a person must review and accept the new certificate
   to resume. The change is audited.
3. **Given** a certificate (the server's, or the platform's for this connection) will
   expire within 30 days, **Then** the connection shows it and people with
   `Device.manage` are told once.
4. **Given** the server refuses some points at deploy time (removed, renamed, no read
   permission, over its limits), **Then** the rest collect, and the refused ones are
   listed by equipment and reading with the server's reason.
5. **Given** the organization's point limit (FR-037) would be exceeded, **Then** the
   review says by how much and the map cannot be deployed.
6. **Given** the assistant is enabled, **Then** it can list and search the server's
   tree, read current values, and propose connections' settings (without secrets),
   device types and point maps as proposals. It cannot accept a certificate, see
   secrets, deploy or activate.
7. **Given** credentials are changed or the connection is paused or deleted, **Then**
   the change is audited without secret values, and a connection in use by a data
   source cannot be deleted.

---

### User Story 6 - Collect from inside the building (Priority: P3)

Where the server cannot be reached from outside, an operator at the site runs the
on-site agent on a computer in the building's network. It connects to the server
locally and sends data out to the platform, so the building opens no inbound access.
The manager uses the same connection, tree, point map and devices as in US2 to US5.

**Why this priority**: most BMS servers sit on a private network, so this is what
makes real buildings connectable without a VPN. It comes after the cloud path because
it reuses everything above and adds enrolment and updates.

**Independent Test**: run the agent beside the simulator on a network the platform
cannot reach into, enrol it with a one-time code, and complete US2 to US4 with **Runs
at: site agent** chosen. Cut the agent's internet for 10 minutes and restore it: the
readings from those 10 minutes arrive with their original times.

**Acceptance Scenarios**:

1. **Given** a new connection, **Then** the person chooses where it runs: on the
   platform, or on an on-site agent they pick or enrol.
2. **Given** an enrolment code created in the portal (valid once, for 24 hours),
   **When** the agent is started with it, **Then** the agent appears in the
   organization as connected, with its version and the time it was last heard.
3. **Given** an enrolled agent, **Then** every connection it makes is outbound, it
   holds credentials only for its own organization, and the server's sign-in secrets
   reach it encrypted and are never shown.
4. **Given** the agent loses its uplink, **Then** it keeps reading the server and
   keeps up to 24 hours of readings (oldest dropped first, with a count shown), and
   sends them oldest first with their original times when the uplink returns.
5. **Given** an agent is revoked, **Then** it can no longer send or receive anything
   and its connections show **Agent revoked**.
6. **Given** a newer agent version exists, **Then** the agent's page says so with the
   update command. The agent never updates itself.

---

### User Story 7 - Propose the building's hierarchy (Priority: P3, needs spec 009)

Once the entity hierarchy exists, the manager asks the platform to propose entities
and placements from the server's structure. They review the proposal as a tree, fix
what is wrong, and apply it. The hierarchy stays the organization's own: nothing in it
refers to OPC UA.

**Why this priority**: it is the owner's goal (building data landing in the
organization's physical structure), but it depends on a feature that is not built, and
US1 to US5 are useful without it.

**Independent Test**: with spec 009 built and the buildings preset applied, run the
proposal on the simulator's structured building: it proposes one site, one building,
four floors and sixteen zones, with each zone controller placed at its zone and each
floor meter at its floor. Rename one floor, drop one zone, apply. The entities and
placements exist; none carries a node address. Run the proposal again: it offers only
the dropped zone.

**Acceptance Scenarios**:

1. **Given** the entity hierarchy is not available in this installation, **Then** this
   story's actions are not shown, and everything in US1 to US6 works.
2. **Given** a server with folders, **Then** the proposal maps folders to entities,
   suggesting each one's type from the organization's types (Site, Building, Floor,
   Zone) by its depth and name, and places each activated device at the entity for the
   folder its equipment sits in.
3. **Given** a flat server, **Then** the person supplies how tag names split into
   levels (for example `B1_F03_VAV_2` is building, floor, equipment), and the same
   proposal is built from that.
4. **Given** a proposal, **Then** the person can rename, retype, merge, move and drop
   proposed entities, and point a proposed entity at one that already exists, before
   applying. Applying needs the hierarchy's own permission and obeys its type rules;
   whatever a rule refuses is listed with the rule.
5. **Given** an applied proposal, **Then** entities and placements are ordinary ones:
   editable, movable and unaffected if the connection is later deleted.
6. **Given** a later proposal, **Then** it offers only what is new or was never
   applied. It never moves, renames or removes an existing entity or placement.
7. **Given** a device that reports through another protocol, **Then** it can be placed
   in the same entities; the hierarchy does not record which protocol a device uses.

---

### Edge Cases

- **The server renumbers its nodes after a restart.** Some servers do. Each mapped
  point is found again by its path of names when its address no longer resolves; one
  that cannot be found is reported as refused (US5 scenario 4), not silently dropped.
- **Two equipment nodes with the same name** (two "AHU-1" in different buildings):
  sources are told apart by their full path, and the suggested device names include
  enough of the path to differ.
- **The server's clock is wrong.** A value timed more than 5 minutes ahead of, or more
  than 24 hours behind, the platform's time is stored at the time it was received and
  labelled so. The connection's status shows the clock difference.
- **A meter total goes down** (replaced meter, the simulator's scenario): handled by
  the existing counter reset rule; the connector does nothing special.
- **A named state** (Off, Heating, Cooling): stored as its number with its names kept
  as the reading's value labels; a state number the server gives no name for is shown
  as the number.
- **A server that offers only outdated security** (broken algorithms): listed as
  unavailable with the reason; the person can choose the unencrypted option with its
  warning, or an on-site agent.
- **A server that limits how much one client may read**: the connector stays inside
  the limits the server announces, and reads the remainder by polling slower instead
  of failing; points it still cannot read are reported as refused.
- **The equipment node is deleted on the server**: its device stops hearing and goes
  offline by the normal rule; the data source lists the source as **Not found on the
  server**.
- **Two data sources map the same point**: allowed (a shared outdoor temperature); the
  point is read once from the server.
- **The same server added twice**: the second connection is refused when the address,
  security and sign-in match an existing one in the organization, naming it.
- **A device moved to another organization of the billing account** keeps reporting
  through the data source, as ADR-039 defines for adapters.
- **A scan of a very large branch**: stops at 20,000 nodes and says so; the person
  narrows the branch.
- **The assistant is disabled**: every step works from the forms.

## Requirements *(mandatory)*

### Functional Requirements

**Simulator**

- **FR-001**: The repository MUST contain a simulated BMS server that exposes the
  building of US1 scenario 1 over OPC UA, with every point carrying a data type,
  display name, description, engineering unit where applicable, source time and status.
- **FR-002**: The simulator MUST produce a repeatable simulated day from a seed, at an
  adjustable speed, with the behaviours and the named scenarios of US1 scenarios 3
  and 4. Scenarios MUST be switchable while it runs.
- **FR-003**: The simulator MUST offer the structured and the flat naming styles, an
  unencrypted and an encrypted endpoint, the three sign-in methods (each
  switchable), and a large-building option of at least 5,000 points.
- **FR-004**: The simulator MUST start with the local stack on request, and MUST be
  documented with the other simulators, including the statement that a passing
  simulator run is not verification against a real building.

**Connection and security**

- **FR-010**: An organization MUST be able to save connections to servers. A connection
  holds one session with its server and MUST be shared by every data source that reads
  from that server.
- **FR-011**: The platform MUST list a server's security choices and sign-in methods
  before connecting, preselect the strongest, and refuse choices whose algorithms are
  no longer considered safe.
- **FR-012**: The first connection MUST stop at the server's certificate until a person
  accepts its fingerprint. A later change of that certificate MUST stop collecting
  until a person accepts the new one. Both acceptances are audited.
- **FR-013**: Each connection MUST have its own platform certificate, which the person
  can download to trust on the server. Its private key never leaves the platform (or
  the agent that runs the connection).
- **FR-014**: Sign-in MUST support anonymous, name and password, and a certificate
  with its key. Secrets MUST be stored encrypted, never returned by any API, and
  redacted from logs, diagnostics, audit entries and everything the assistant sees.
- **FR-015**: The unencrypted option MUST require an explicit confirmation of its
  warning and MUST be labelled **Not encrypted** wherever the connection appears.
- **FR-016**: A connection that runs on the platform MUST reach only public addresses,
  checked as the polling source checks them, unless the operator has allowed a named
  private range for that organization (a site VPN, or the local stack's simulator).
  A refused address MUST be reported as **Address not allowed**.
- **FR-017**: Connection failures MUST be reported with the reasons and fixes of US2
  scenario 6, and the connector MUST retry lost connections with growing pauses up to
  5 minutes, without a person acting.

**Browse and point map**

- **FR-020**: A person MUST be able to browse a connected server's tree one level at a
  time with paging, see each point's current value, unit, status and data type, and
  search by name. Browsing MUST work before anything is deployed and MUST read only.
- **FR-021**: A point map MUST record, for one device type: each reading's point
  (relative to its equipment), key, name, data type, unit, scale and offset, and
  reporting settings; and the list of equipment it applies to, each with its address
  and its path of names.
- **FR-022**: The platform MUST suggest similar equipment by the server's declared
  type, by matching point names, or by a name pattern, and MUST show which readings
  each suggested equipment lacks.
- **FR-023**: Reading keys, names and units MUST be suggested from the server's
  information and be editable. A point map MAY target an existing published device
  profile or create a new device type.
- **FR-024**: A point map MUST be saved as an immutable revision of its data source.
  A revision MUST pass review (US3 scenario 7) with no problems before it can be
  deployed, and only that exact revision is deployed.
- **FR-025**: Points whose values the platform cannot store MUST be shown with the
  reason and MUST NOT be mappable.
- **FR-026**: The point map MUST have a versioned contract with fixtures, so that later
  typed connectors (Modbus, BACnet, DLMS) reuse the same shape and editor.

**Collecting**

- **FR-030**: A deployed revision MUST read its points by subscription, staying inside
  the limits the server announces, and MUST fall back to slower periodic reads for
  what a subscription cannot hold.
- **FR-031**: Reporting defaults MUST be: sampled every 10 seconds; a number counts as
  changed when it moves by 0.5% of its range when the server gives one, otherwise on
  any change; on/off and named states report every change. The fastest sampling a
  person may set is 1 second.
- **FR-032**: Every device MUST report at least once per reporting rhythm (5 minutes
  by default, 1 minute to 1 hour) even when nothing changed, so a steady device stays
  online and its automatic *Offline after* is derived from that rhythm. Such a report
  carries the time the server confirmed the values, labelled as the server's time.
- **FR-033**: Bad quality MUST be stored as unknown with the reason and MUST NOT count
  as hearing from the device. Uncertain quality MUST keep its value and be labelled.
  No reading may be shown as healthy when the server said otherwise.
- **FR-034**: A reading's time MUST be the server's source time when present and
  within the clock bounds of the edge cases, otherwise the server's own time,
  otherwise the time received; the last two MUST be labelled as not measured at the
  source.
- **FR-035**: After a restart or a redeploy the connector MUST resume collecting from
  the deployed revision without a person acting, and MUST find mapped points again by
  their path of names when their addresses changed.
- **FR-036**: Points the server refuses MUST NOT stop the rest. They MUST be listed
  with equipment, reading and reason, and re-tried at each reconnection.
- **FR-037**: An organization MUST be limited to 10,000 collected points and 10
  connections by default, both set by the operator. Billing limits on devices and data
  points apply as they do to every device.

**Fit with the platform**

- **FR-040**: The connector's output MUST go through the managed publisher, Discovery,
  review and activation unchanged. Storage, presence, rules, dashboards, offline
  alerts, moves between organizations and the runtime's contracts MUST need no change
  except carrying uncertain quality if the plan finds it is not carried today.
- **FR-041**: Each equipment MUST appear as a source identified by its full path, and
  several sources MUST be activatable in one action.
- **FR-042**: OPC UA MUST be offered as a connector in the onboarding journey (spec
  021 US8): its start-screen answer and what the person will need (address, sign-in,
  someone who can trust a certificate on the server), its settings and secrets, its
  capture for See data (the live tree), the point map for Choose readings, its failure
  reasons, and its assistant tools. Until that journey is built it MUST work from the
  data source workbench.
- **FR-043**: The connection's status MUST show what US5 scenario 1 lists, and
  certificate expiry MUST be announced 30 days ahead.
- **FR-044**: Assistant tools for this connector MUST run with the person's
  permissions, produce proposals only, and never accept a certificate, read a secret,
  deploy or activate.
- **FR-045**: Connections, point maps, browse results, agents and their secrets MUST
  be scoped to their organization. Tests MUST prove another organization can neither
  read nor change them nor reach a server through another's connection.
- **FR-046**: Creating, changing, pausing and deleting a connection, accepting a
  certificate, changing credentials and deploying a point map MUST each record one
  audit event without secret values.
- **FR-047**: The public API description and the API client MUST describe the new
  operations in the same pull requests that add them.

**On-site agent**

- **FR-050**: The same connector MUST be runnable as an on-site agent that makes only
  outbound connections and sends its readings as Sparkplug B.
- **FR-051**: An agent MUST be enrolled with a single-use code valid 24 hours, belong
  to one organization, be revocable, and show its version and when it was last heard.
- **FR-052**: An agent MUST keep up to 24 hours of readings while its uplink is down
  and send them oldest first with their original times, marked as history so they
  neither mark devices online nor fire automations late.
- **FR-053**: Browsing, the point map, deployment, status and failure reasons MUST
  behave the same whether a connection runs on the platform or on an agent.

**Hierarchy proposal (enabled only when spec 009 is built)**

- **FR-060**: The platform MUST be able to propose entities and device placements from
  a server's folder structure, or from a tag-name split the person supplies, for a
  person to edit and apply. Nothing is created until they apply.
- **FR-061**: Applying MUST go through the hierarchy's own operations, permission and
  type rules. The connector MUST NOT create, move, rename or remove entities or
  placements by any other route, and a later proposal MUST offer additions only.
- **FR-062**: Entities and placements MUST hold nothing specific to OPC UA. Where the
  proposal came from is kept with the data source, not in the hierarchy.
- **FR-063**: When the hierarchy is not available, the proposal's actions MUST be
  absent and no other requirement may depend on it.

### Key Entities

- **Connection**: organization, name, server address, where it runs (platform or an
  agent), security choice, sign-in method and encrypted secrets, the accepted server
  certificate, the platform's certificate for it, status, limits announced by the
  server.
- **Point map revision**: an immutable data source revision: device type, readings
  (point relative to equipment, key, name, type, unit, scale, offset, reporting), and
  equipment (address, path of names, display name).
- **Equipment source**: one equipment as Discovery sees it: identified by its full
  path, with its latest preview and, once activated, its device.
- **Refused point**: equipment, reading, the server's reason, first and last seen.
- **Agent**: organization, name, enrolment state, version, last heard, revoked time.
- **Hierarchy proposal**: a data source, the proposed entities and placements, each
  one's state (proposed, edited, dropped, applied) and who applied it.
- **Simulated building**: the fixed model of US1, its naming style, scenarios, seed
  and clock speed.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In the local stack, a person who has never used OPC UA takes the
  simulated building from "enter the address" to 16 zone controllers storing readings
  in under 15 minutes, without writing code and without leaving the journey.
- **SC-002**: A change on the simulator is visible on the device's page within 15
  seconds at default settings.
- **SC-003**: With the large building (5,000 points) collecting for 24 simulated
  hours, no reading is lost while the server stays connected, and every device stays
  online through steady periods.
- **SC-004**: For each simulator scenario (controller offline, failed sensor, chiller
  trip, server restart, certificate changed, wrong clock, meter replaced), the
  platform shows the state a building operator would expect, and never shows a bad
  value as good. Each scenario has an automated check.
- **SC-005**: Every connection failure in US2 scenario 6 can be produced on the
  simulator and shows its own reason and fix.
- **SC-006**: The same point map connects the structured and the flat naming styles
  to the same 16 devices and readings.
- **SC-007**: The connector reaches stored readings against at least one OPC UA server
  that the project did not write, before the feature is called complete.
- **SC-008**: With the on-site agent, a 10-minute uplink loss loses no reading, and
  the building's network needs no inbound opening.
- **SC-009**: With the hierarchy built, the proposal for the simulated building is
  applied with at most 5 manual corrections, and a second run proposes nothing new.
- **SC-010**: Existing adapters' tests, the runtime's tests and the device
  verification scripts pass unchanged.

## Assumptions

- **Supervisory level.** The target is a BMS server or site gateway that already
  offers OPC UA. Field controllers that speak only BACnet or Modbus are reached
  through that server, a third-party gateway, or later connectors.
- **Read only.** Writing setpoints and calling methods are a later spec with their own
  approvals. Nothing in this feature can change a building.
- **No alarm events, history or PubSub.** Alarm points are read as on/off values and
  alerts come from the platform's rules. OPC UA alarms and conditions, reading the
  server's own history to fill gaps, and OPC UA PubSub are out of scope; a gap during
  a disconnection on the platform path stays a gap.
- **Order of delivery**: simulator, then connection and browse, then the point map and
  collecting, then status and the assistant, then the on-site agent. The hierarchy
  proposal waits for spec 009, which is planned and delivered on its own.
- **The on-site agent runs as a container** on a computer the site provides. Windows
  services, appliance images and self-update are later work. Planning may give the
  agent an ADR of its own, since it is the "own edge runtime" ADR-023 leaves open.
- **Spec 021's journey is not built yet.** This feature works from the data source
  workbench and plugs into the journey when it exists (FR-042).
- **One building per connection is typical**, but nothing prevents a server that
  covers several buildings; the limits are per organization.
- **The simulator is a development tool**, not a product feature, and is never
  deployed to customers.
- **A site VPN is the operator's work.** The platform only allows the named private
  range for the organization (FR-016); setting up the tunnel is outside the product.
- **UNS publication** stays the later spec that spec 009 names.
