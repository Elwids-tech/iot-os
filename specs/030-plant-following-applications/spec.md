# Feature Specification: Applications That Follow a Plant

**Feature Branch**: `spec/030-plant-following-applications`

**Created**: 2026-11-07

**Status**: Draft

**Input**: "Applications that follow a plant (phase 1 of the Twin Studio integration,
ADR-032). An external application such as a digital twin can show a whole plant as it
is now and keep it moving: a server-sent telemetry stream for the application's granted
devices; bulk latest for up to 100 devices in one request; device parameters on the
device read; sites for applications; grants by site, with devices in a granted site
granted while they are there; stream limits; SDK 0.6. Boundaries that must not change:
existing integration routes and their semantics, the application token model, the
per-minute request limit, Go never serving external applications, no NATS access for
tenants, tenant isolation tests for every new read, contracts first."

## Context

External applications read the platform through the integration API
([integrations](../../docs/features/integrations.md)): an application belongs to one
organization, holds explicit abilities and a grant of 1 to 100 named devices, and may
make 60 requests a minute. It reads one device's latest values per request, history per
device and parameter, and devices as uuid, code, name, lifecycle, presence and last
seen. It learns about alerts, geofence transitions and automation events from a durable
event feed and signed webhooks. It cannot learn a device's parameters, where a device
sits, or that a new reading arrived: there is no live feed of readings for
applications, and the one feed the platform has is internal and mixes organizations.

The platform's first digital-twin integration, the Twin Studio connector described in
[ADR-032](../../docs/adr/ADR-032-applications-follow-a-plant.md), needs exactly what is
missing. When an operator opens a 3D scene of a plant, every
bound value must already be on screen with its age; afterwards each new reading must
reach the scene within a second or two; to bind a tag, a person needs the device's
parameters and the site the device belongs to; and a plant has hundreds of devices, so
naming each one in a grant does not scale and misses the devices added next month.

This feature delivers, for applications:

1. **A snapshot in one request**: the latest values of up to 100 devices at once.
2. **A live stream**: every committed reading of the application's devices as it is
   stored, resumable after a disconnection.
3. **What can be bound**: a device's parameters on the device read, and the
   organization's sites.
4. **Grants that follow the plant**: a grant by site, so devices in that site are
   covered while they are there, including ones added later.
5. **An SDK that covers all of it**, version 0.6.

The decisions behind it are in [ADR-032](../../docs/adr/ADR-032-applications-follow-a-plant.md).
Later phases bring commands and acknowledgements for applications acting as a person
([ADR-033](../../docs/adr/ADR-033-partner-applications-act-for-a-person.md)), organization
variables ([ADR-034](../../docs/adr/ADR-034-organization-variables.md)) and grants by entity
branch with paths (spec 009). None of those is in this feature.

**Terms**

- *Application*: a registered external program with its own machine credential,
  abilities and grant, belonging to one organization.
- *Grant*: what the application may see. Today a list of named devices; with this
  feature, alternatively a *scope* of sites.
- *Granted device*: a device in the grant's list, or a device whose site is in the
  grant's scope at the moment of the request.
- *Snapshot*: the latest retained value of each parameter of a device, with its quality
  and times, as the existing single-device latest read returns it.
- *Stream*: a long-lived connection on which the platform sends each committed reading
  of the granted devices as it is stored.
- *Resume point*: the position in the stream a client last saw, which it presents
  when reconnecting.

## Decisions

Recorded from ADR-032 so the plan does not reopen them:

- The stream is served by the control plane, which relays an internal, organization-
  and device-filtered feed from the data plane. Applications never reach the data plane
  or its message bus.
- A grant is either a device list or a site scope, not both at once. A device with no
  site is never in a site scope.
- Reads of parameters ride the existing `devices:read`; sites need a new ability,
  `entities:read`, which will also cover the entity hierarchy when spec 009 lands; the
  stream needs a new ability, `telemetry:stream`, granted only together with
  `telemetry:read`.
- The per-minute request limit is unchanged; a stream counts once when it opens.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See the plant as it is now (Priority: P1)

An application holding `telemetry:read` for sixty granted devices asks for all of their
latest values in one request and paints every value with its quality and age. A device
that has never reported shows nothing, not zero.

**Why this priority**: a digital twin's first frame is the whole plant; without one
request per plant the snapshot alone exceeds a minute's budget.

**Independent Test**: grant an application sixty devices in the local stack, have the
simulators report, call the batch latest with the sixty UUIDs, and compare each
device's part of the answer with the existing single-device latest read; include one
device that never reported and one UUID from another organization.

**Acceptance Scenarios**:

1. **Given** an application with `telemetry:read` and sixty granted devices, **When**
   it asks for the latest values of all sixty in one request, **Then** it receives one
   answer with each device's retained values, quality and times, identical to what the
   single-device read returns for that device.
2. **Given** a granted device that has never reported, **When** it is in the request,
   **Then** its entry has no readings, and the answer says so without inventing a
   value.
3. **Given** a request naming a device that is not granted, or belongs to another
   organization, **When** it is sent, **Then** the whole request is refused as not
   found, and nothing about that device is revealed.
4. **Given** a request naming more than one hundred devices, or the same device twice,
   **When** it is sent, **Then** it is refused as invalid input, naming the limit.

---

### User Story 2 - Keep the plant moving (Priority: P1)

The application opens one long-lived connection and receives each reading of its
granted devices as the platform stores it. If the connection drops, it reconnects with
the last position it saw and misses nothing the platform still holds; if the platform
no longer holds that position, it is told to take a fresh snapshot.

**Why this priority**: polling cannot keep a plant moving inside the request budget; a
twin that is seconds behind is a twin nobody trusts.

**Independent Test**: open the stream for an application with `telemetry:stream`, have
simulators report for its devices and for a device it is not granted, measure the delay
from storage to receipt, cut the connection, reconnect with the last position, and
check the sequence is unbroken; then reconnect with a position older than retention and
expect the reset.

**Acceptance Scenarios**:

1. **Given** an application with `telemetry:read` and `telemetry:stream`, **When** it
   opens the stream, **Then** it receives an opening message naming the position it
   starts from, and then each committed reading of its granted devices, each carrying
   the device, the parameter, the value, its quality, when it was observed and when it
   was received, in storage order.
2. **Given** readings of devices the application is not granted are stored at the same
   time, **When** the stream is open, **Then** none of them appears on it.
3. **Given** the connection drops, **When** the client reconnects presenting the last
   position it received, **Then** it receives every reading stored since that position
   that the platform still retains, in order, with no duplicates and no gaps.
4. **Given** the client presents a position the platform no longer retains, **When** it
   reconnects, **Then** it receives a reset message with the current position, so it
   knows to take a new snapshot before continuing.
5. **Given** the stream has carried nothing for a minute, **When** that minute passes,
   **Then** the platform sends a keepalive the client can ignore, so intermediaries do
   not close an idle connection.
6. **Given** the application's grant is changed, its token rotated or the application
   revoked while a stream is open, **When** the change takes effect, **Then** the stream
   ends with a message saying why, and a new stream reflects the new grant.
7. **Given** an application already holds two open streams, or its organization holds
   ten, **When** it opens another, **Then** the request is refused with a message naming
   the limit, and the open streams are unaffected.

---

### User Story 3 - Grant a whole site (Priority: P1)

A manager grants an application a site instead of naming devices. Every device at that
site is covered, including devices registered next month, and a device moved out of
the site stops being visible without anyone editing the application.

**Why this priority**: a plant is hundreds of devices; a hand-kept list of a hundred is
both too small and always stale.

**Independent Test**: create a site with three devices, grant it to an application,
read devices and latest values; register a fourth device at the site and read it
without touching the application; move one device to another site and check it is now
refused; change the application's scope and check the revision changed and the old
token and event cursors stopped working.

**Acceptance Scenarios**:

1. **Given** a manager editing an application, **When** they choose to grant by site
   and pick one or more sites, **Then** the application is saved with that scope and
   no device list, and the list and the scope cannot both be set.
2. **Given** an application granted a site, **When** a device at that site is read,
   listed, streamed, or appears in the event feed or a webhook, **Then** it is treated
   as granted, and a device at another site, or with no site, is not.
3. **Given** a device is registered at a granted site after the grant was saved,
   **When** the application reads it, **Then** it is granted without any change to the
   application.
4. **Given** a device moves out of a granted site, **When** the application reads it
   afterwards, **Then** it is refused as not found, and it no longer appears on the
   stream or in the feed.
5. **Given** a manager changes the scope, **When** the change is saved, **Then** the
   grant revision changes with the same consequences as changing the device list today:
   the token is invalidated, event cursors are rejected until rebuilt, and the webhook
   is disabled.
6. **Given** a site is deleted, **When** it was in an application's scope, **Then** the
   scope loses it, the revision changes, and the manager sees why.

---

### User Story 4 - Know what can be bound (Priority: P2)

A person building a twin needs to know, for each device, which parameters it has, with
their keys, names, units and types, whether a parameter accepts a command and reports
its state, and which site the device belongs to.

**Why this priority**: without parameters a reading is a number with no name; without
sites there is nothing to map a device onto.

**Independent Test**: read a device that runs a published profile with four parameters
and compare the parameters with the profile page; list sites with and without the new
ability.

**Acceptance Scenarios**:

1. **Given** an application with `devices:read`, **When** it reads a granted device,
   **Then** the answer carries the device's profile name and revision and, for each
   parameter, its identifier, key, name, unit, type, number of decimals, whether it
   accepts a command and whether it reports state, plus the device's site identifier
   and name when it has one.
2. **Given** an application with `entities:read`, **When** it lists sites, **Then** it
   receives every site of the organization with its name, time zone, address and
   coordinates, and the number of granted devices at each.
3. **Given** an application without `entities:read`, **When** it lists sites, **Then**
   it is refused for a missing ability, as every other ability check answers.
4. **Given** a device whose configuration has no profile revision yet, **When** it is
   read, **Then** its parameters are an empty list, not an error.

---

### User Story 5 - Use all of it from the SDK (Priority: P2)

A developer updates to SDK 0.6 and reads a plant with a few calls: a device with its
parameters, the sites, the batch latest, and the stream as a loop that resumes on its
own after a disconnection.

**Why this priority**: the SDK is how the first integration is written; a feature the
SDK does not cover is one the integration has to hand-roll.

**Independent Test**: run the SDK's examples against the local stack with an application
token and the abilities above; cut the network under the stream example and watch it
resume with no gap.

**Acceptance Scenarios**:

1. **Given** SDK 0.6, **When** a developer calls the batch latest, the sites list, or
   the device read, **Then** the responses are validated the way existing responses are
   and unknown timestamps stay `null`.
2. **Given** SDK 0.6's stream loop, **When** the connection drops, **Then** it reconnects
   with the last position without the developer doing anything, and surfaces a reset
   as a distinct event the developer must handle.
3. **Given** an application on SDK 0.5, **When** the platform ships this feature,
   **Then** nothing that worked before behaves differently.

---

### User Story 6 - Operate it (Priority: P3)

A platform administrator sees how many streams are open and for whom, and an
application developer sees in the documentation what the limits are and what each
refusal means.

**Why this priority**: streams hold resources for as long as they are open; the first
support question will be "why was my stream refused".

**Independent Test**: open streams for two applications and read the platform status;
exceed the limit and compare the refusal with the documentation.

**Acceptance Scenarios**:

1. **Given** open streams, **When** an administrator reads the platform's status,
   **Then** the count of open streams per organization is reported.
2. **Given** the documentation of the integration API, **When** a developer reads it,
   **Then** the stream, batch latest, parameters, sites, site scopes, every new ability,
   every limit and every refusal are described, and the public API description agrees
   with the running platform.

---

### Edge Cases

- A device is deactivated while a stream is open: its readings stop; the stream stays
  open; a later activation resumes them with no action by the application.
- The data plane is unavailable when a stream is opened: the request is refused as
  service unavailable, never answered with an empty stream. If it becomes unavailable
  while a stream is open, the stream ends with a message saying so.
- A reading is stored with a backfilled, historical timestamp: it is sent with its
  historical flag so a client does not treat it as current.
- Readings of a device arrive on the stream before the application has taken its
  snapshot: the application applies the stream from its opening position after a
  snapshot taken after that position; the documentation describes this order.
- A site scope names a site of another organization: refused as not found, and nothing
  about it is revealed.
- The batch latest names devices from both a list grant and a device that is granted
  only because of a site scope: impossible, since a grant is one or the other; the
  resolved set is what counts.
- A client reconnects with a malformed position: refused as invalid input, not treated
  as "from the start".
- A proxy between the application and the platform buffers responses: the keepalive
  and the documentation's guidance on disabling buffering keep the stream usable; the
  platform cannot fix a buffering proxy.
- An organization has more than one hundred devices in a granted site: the batch latest
  is called more than once; the stream carries all of them on one connection.

## Requirements *(mandatory)*

### Functional Requirements

**Batch latest**

- **FR-001**: An application with `telemetry:read` MUST be able to request the latest
  values of up to 100 granted devices in one request and receive one answer with each
  device's retained values, quality and times, equal to the existing single-device
  latest read for that device.
- **FR-002**: A batch request naming any device that is not granted, or not in the
  organization, MUST be refused as not found as a whole, revealing nothing about that
  device.
- **FR-003**: A batch request naming more than 100 devices or repeating a device MUST
  be refused as invalid input, naming the limit.
- **FR-004**: A device without retained values MUST appear with an empty list of
  readings, never with zeros or placeholder values.

**Stream**

- **FR-005**: An application with `telemetry:read` and a new ability,
  `telemetry:stream`, MUST be able to open a stream that delivers every committed
  reading of its granted devices in storage order, each carrying the device, the
  parameter identifier and key, the value, its type and unit, its quality, when it was
  observed, when it was received, and whether it is historical.
- **FR-006**: The stream MUST open with a message carrying the position it starts from
  and MUST mark every message with its position, so a client can resume.
- **FR-007**: A client presenting a position it saw MUST receive every retained reading
  stored after it, in order, without duplicates or gaps; a position the platform no
  longer retains MUST be answered with a reset message carrying the current position.
- **FR-008**: The stream MUST carry nothing about devices outside the application's
  resolved grant, including readings stored for other organizations at the same time.
- **FR-009**: The stream MUST send a keepalive after 60 s without data.
- **FR-010**: A grant change, token rotation, revocation or loss of the data plane MUST
  end an open stream with a message naming the reason.
- **FR-011**: An application MUST NOT hold more than two open streams and an
  organization MUST NOT hold more than ten; opening another MUST be refused naming the
  limit, leaving the open streams unaffected.
- **FR-012**: Opening a stream MUST count as one request against the per-minute limit;
  data on an open stream MUST NOT count.
- **FR-013**: The stream MUST be served by the control plane; applications MUST NOT
  gain any new way to reach the data plane or its message bus.

**Parameters and sites**

- **FR-014**: The device read under `devices:read` MUST carry the device's profile name
  and revision and its parameters: identifier, key, name, unit, type, decimals, whether
  it accepts commands, whether it reports state; and the device's site identifier and
  name when it has one. A device without a profile revision MUST carry an empty
  parameter list.
- **FR-015**: An application with a new ability, `entities:read`, MUST be able to list
  the organization's sites with name, time zone, address, coordinates and the count of
  granted devices at each; without the ability the request MUST be refused for a
  missing ability.
- **FR-016**: Existing device, alert, event, telemetry, location and geofence reads MUST
  keep their shapes and semantics; new fields are additive.

**Grants by site**

- **FR-017**: A manager MUST be able to save an application's grant as a scope of one or
  more sites of the organization instead of a device list; a grant MUST be one or the
  other, never both.
- **FR-018**: A device MUST count as granted when it is in the list, or when its site is
  in the scope at the time of the request; a device with no site MUST never be in a
  site scope.
- **FR-019**: Every read, the batch latest, the stream, the event feed and webhook
  deliveries MUST filter by the same resolved grant, and every request MUST resolve it
  afresh.
- **FR-020**: Changing the scope MUST bump the grant revision with the same
  consequences as changing the device list: the token is invalidated, event cursors are
  rejected until rebuilt, and the webhook is disabled.
- **FR-021**: Deleting a site in a scope MUST remove it from the scope, bump the
  revision, and record why in the application's history.
- **FR-022**: A scope naming a site of another organization MUST be refused as not
  found.

**SDK, contracts and documentation**

- **FR-023**: The SDK, at version 0.6, MUST offer the batch latest, the sites list,
  parameters on the device read, and the stream as an iterator that resumes on its own
  and surfaces a reset as a distinct event; everything that worked in 0.5 MUST work
  unchanged.
- **FR-024**: The stream message, the batch latest answer and the device read with
  parameters MUST each have a versioned contract with golden fixtures, and the public
  API description MUST describe every new operation, ability, limit and refusal and
  pass the drift check.
- **FR-025**: A test MUST prove, for each new read and for the stream, that another
  organization's data cannot be read through a list grant or a site scope.
- **FR-026**: The platform's status MUST report open streams per organization.

### Key Entities

- **Application grant**: what one application may see. Either a list of 1 to 100
  devices or a scope of one or more sites, with a revision that changes whenever the
  grant changes. The resolved set is computed from it on every request.
- **Snapshot (batch latest)**: for up to 100 requested devices, each device's retained
  latest values with quality and times, or an empty list.
- **Stream message**: one committed reading of a granted device with its position in
  the organization's stream; the opening message and the reset message carry a position
  only.
- **Device read with parameters**: the device's existing fields plus its profile
  summary, its parameters and its site.
- **Site view**: a site's name, time zone, address, coordinates and the number of
  granted devices at it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An application paints the latest state of 100 granted devices from one
  request, answered in under 2 seconds on the local stack.
- **SC-002**: With 100 granted devices reporting every 10 seconds, 95 % of readings
  reach an open stream within 2 seconds of being stored.
- **SC-003**: Across 20 forced disconnections during a 30-minute simulator run, a
  client resuming from its last position receives every stored reading exactly once.
- **SC-004**: A device registered at a granted site is readable by the application
  within one request of its registration, with no change to the application.
- **SC-005**: Every tenant-isolation test for the new reads and the stream passes, and
  no response reveals the existence of an ungranted device.
- **SC-006**: The SDK examples run unchanged against the local stack, and a 0.5
  consumer runs unchanged against the updated platform.
- **SC-007**: The Twin Studio phase 1 exit test passes: a twin bound to a real
  organization shows live values at load and 31 days of history on a click, with no
  platform credential in the browser.

## Assumptions

- The stream's retention is the data plane's committed telemetry retention, seven
  days today; a longer replay is out of scope and a client that falls further behind
  takes a new snapshot.
- Positions are opaque to clients; only the platform interprets them.
- The stream carries readings as stored, including quality other than good; filtering
  is the application's concern. Diagnostics readings are excluded as they are from the
  existing raw records read.
- Readings arrive on the stream in storage order, which can differ from observation
  order for devices that backfill; the historical flag is the client's signal.
- Site scopes resolve through each device's current site; a device moved between sites
  changes grant at the next request, not retroactively.
- Grant scopes by entity branch and paths on parameters arrive with spec 009; the
  ability `entities:read` is named for that future.
- Two streams per application and ten per organization are starting limits chosen for
  one streaming consumer per plant with a reconnect in flight; they are configuration,
  not contract, and can rise when the relay leaves the request-serving process.
- The existing `apps/vertical-demo` stays request-based and is not changed by this
  feature beyond its SDK version.

### Out of scope

- Device commands and alert acknowledgements for applications acting as a person
  (ADR-033, a later spec).
- Organization variables and the automation node that reads them (ADR-034).
- Entity hierarchy, paths and entity-branch grants (spec 009).
- A dedicated streaming process outside the request-serving workers (roadmap).
- Streaming alerts or events on the same connection; the event feed and webhooks remain
  the way to receive them.
- Pushing readings into the platform through the stream; it is one-directional.
