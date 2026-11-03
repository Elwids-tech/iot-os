# Feature Specification: Embedded Gateway SDK

**Feature Branch**: `spec/026-embedded-gateway-sdk`

**Created**: 2026-11-02

**Status**: Draft; decisions confirmed by the owner on 2026-11-02

**Input**: "Can we get an NXP library customized with the connection kit so that he can
easily download it and with a few customizations he could easily burn the firmware to
his device/s and start communicating." Follow-up from the hardware partner: "we should
use an encapsulated library for connectivity while keeping the hardware-specific
interfaces open for custom implementation."

## Context

A device reaches IoT OS by publishing Sparkplug B over MQTT with TLS
([devices](../../docs/features/devices.md), [ADR-005](../../docs/adr/ADR-005-sparkplug-b-boundary.md)).
For a **direct** device the portal hands out a connection kit (`device-config.json`,
`ca.crt`, `quickstart.md`) built from the device's published profile. The quickstart
tells the engineer to "use a Sparkplug B library", but the platform offers none, so a
firmware engineer on a microcontroller must find or write one. The only firmware in the
repository is the ESP32 alarm board ([`firmware/waveshare-audio`](../../firmware/waveshare-audio)),
whose bounded encoder handles booleans, integers and strings and is tied to ESP-IDF.

**Gateways** (Sparkplug edge nodes with devices behind them) are registered in
**Fleet → Gateways**. Their credentials come only from a server command
(`devices:export-gateway`); the portal deliberately never shows them. When a gateway
connects, its own birth and each device's birth create **discovered sources** in
**Connect → Discovery**, and each source is onboarded one at a time. The guided
onboarding accepts a gateway's own metrics (a source without a device ID) only for
direct devices.

An evaluating hardware partner builds industrial gateways on an NXP i.MX RT1050 with
the vendor's MCUXpresso SDK and FreeRTOS. The internet uplink varies by project:
Ethernet, or a cellular modem on a UART that may run TLS and MQTT itself. Each gateway
polls field devices over RS-485 (two ports of up to 247 devices each, potentially more).
They asked for a self-contained connectivity library whose hardware-specific parts they
implement themselves, and for visibility into the gateway's own telemetry.

This feature delivers three things:

1. **The SDK**: a portable library that a firmware engineer compiles into a gateway or
   direct device. It speaks Sparkplug B for them and leaves the network, clock and
   storage open behind small, documented interfaces, with reference implementations for
   the partner's chip family and for a desktop computer.
2. **The gateway kit**: a download, generated per gateway from published device
   profiles, that holds the SDK, the gateway's settings and one metric table per device
   type, ready to build.
3. **Bulk onboarding**: onboarding hundreds of discovered devices of one type behind one
   gateway in one action.

**Terms**: the *integrator* is the firmware engineer using the SDK. A *downstream
device* is a field device behind a gateway, identified by an ID the integrator chooses
(for example `p1-017` for port 1, address 17). A *device type* is the metric table
generated from one published profile revision, shared by every downstream device of
that type. A *port* is the integrator-facing implementation of one SDK interface
(network, clock, storage, logging, locking) for a given hardware. *Health metrics* are
the gateway's own metrics, as opposed to its devices'.

## Decisions

The draft left three questions open, each with a recommended answer. The owner chose
the recommended answer to all three on 2026-11-02.

- **Q1. How does an operator get a gateway kit, which contains the gateway's
  credentials?** **Download it from the gateway's page in the portal**, under the same
  rules as direct-device kits (`Device.manage-connections`, private, not cacheable,
  recorded in the activity log). This reverses "the portal never shows gateway
  credentials", so the feature adds a new ADR. The server export keeps working. Not
  chosen: server export only, or one download followed by a credential rotation for
  every later one.
- **Q2. Under which licence is the SDK distributed?** **MIT, for the SDK's own folder
  only**, matching the vendor SDK components it builds on, so it can be compiled into
  closed-source firmware. The licence of the rest of the repository stays a separate
  decision. Not chosen: Apache-2.0 (needs NOTICE handling in firmware) or BSD-3-Clause.
- **Q3. How are discovered devices chosen for bulk onboarding?** **The operator selects
  them in Discovery** (filtered by gateway, and by matching metrics) and picks one
  published profile; names come from a pattern. An automatic rule per gateway ("onboard
  every new device whose birth matches profile X") is out of scope, because it would
  activate hardware nobody looked at.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Connect a gateway with the reference port (Priority: P1)

A firmware engineer has an i.MX RT1050 evaluation board on Ethernet. An operator has
registered a gateway and given them its kit. They open the example project from the
kit, build it unchanged, flash the board, and within a minute the gateway appears as
online in the portal, its health metrics (uptime, connection type, signal where known,
firmware version, connected device count) arrive in Discovery, and the telemetry viewer
shows its traffic.

**Why this priority**: it is the request: download, build, flash, communicate. Every
other story builds on a connected gateway.

**Independent Test**: build the kit's example for the reference board (or the desktop
port) against a running stack; the gateway's birth appears in Discovery with its health
metrics and the runtime records no Sparkplug diagnostics for it.

**Acceptance Scenarios**:

1. **Given** a kit for a provisioned gateway, **When** the example is built and run
   without code changes, **Then** the gateway connects over verified TLS, announces
   itself with its health metrics, and reports them at the configured interval.
2. **Given** the gateway is connected, **When** the platform's host application asks it
   to rebirth, or the host comes back online after being away, **Then** the gateway
   announces itself and all its devices again with a new sequence.
3. **Given** the gateway loses its connection, **Then** the platform marks it and its
   devices offline through the death message the gateway registered when it connected,
   without the gateway needing to send anything.
4. **Given** the credentials are wrong or revoked, **Then** the SDK reports an
   authentication failure distinct from a network failure and retries with growing
   delays instead of reconnecting continuously.

---

### User Story 2 - Report downstream devices (Priority: P1)

The integrator's code polls field devices over RS-485. For each one it finds, it calls
"add device" with an ID and a device type, then "publish" with the values it read, and
"device offline" when a device stops answering. The integrator never builds a Sparkplug
message. In the portal, each device appears in Discovery under the gateway with the
metrics of its type; a device that stops answering shows offline; a command sent from
the portal to a device reaches the integrator's command handler with the device ID,
metric and value.

**Why this priority**: the partner's gateways exist to forward hundreds of field
devices; a gateway that reports only itself is not useful to them.

**Independent Test**: with the desktop port, add 500 devices of two types, publish
values, take some offline and send a command to one; Discovery lists 500 sources, the
offline ones show offline, the command arrives in the handler and its acknowledgement
completes the command in the portal.

**Acceptance Scenarios**:

1. **Given** a connected gateway, **When** the integrator adds a device of a known type,
   **Then** the SDK announces it with that type's metrics and the device ID, and later
   values for it are sent as that device's data.
2. **Given** a device was announced, **When** the integrator publishes some of its
   metrics, **Then** only those metrics are sent, each stamped with the time the
   integrator gives or the SDK clock's current time.
3. **Given** the integrator marks a device offline, **Then** the SDK announces its death
   and the platform shows it offline; publishing for it again announces it anew first.
4. **Given** a command for a device and a metric that accepts commands, **Then** the
   integrator's handler receives it; a command for an unknown device, an unknown metric
   or a value of the wrong type is rejected and reported, never applied as a default.
5. **Given** the integrator adds more devices than the gateway was built for, **Then**
   "add device" fails with a clear reason and no existing device is affected.

---

### User Story 3 - Plug in a different network (Priority: P1)

A project uses a cellular modem on a UART. The integrator implements the SDK's network
interface for that modem, either as a TLS byte stream (the SDK runs MQTT over it) or,
for a modem that runs MQTT itself through AT commands, as the SDK's MQTT interface. They
change no SDK source. The gateway behaves exactly as on Ethernet.

**Why this priority**: the partner's uplink differs per project; an SDK tied to one
network stack does not meet their request.

**Independent Test**: run the SDK's test suite against each interface level with a
test double for the network; then run the desktop port, which uses the byte-stream
level, against a real stack.

**Acceptance Scenarios**:

1. **Given** an integrator implementation of the byte-stream interface, **Then** the
   SDK connects, publishes, subscribes and reconnects through it without the integrator
   handling MQTT.
2. **Given** an integrator implementation of the MQTT interface, **Then** the SDK
   delivers the will message, publications and subscriptions through it and handles the
   same session behaviour as at the byte-stream level.
3. **Given** a transport that accepts messages only up to a maximum size, **When** a
   message would exceed it, **Then** the SDK reports which device type or device is too
   large instead of sending a truncated message.
4. **Given** the integrator also supplies the clock, storage, logging and locking
   interfaces, or uses the defaults for FreeRTOS, **Then** no other change is needed to
   build for a new board.

---

### User Story 4 - Download a gateway kit generated from profiles (Priority: P2)

An operator opens a gateway in **Fleet → Gateways**, chooses **Download kit**, picks the
published profile for the gateway's own health metrics and one published profile per
downstream device type, and downloads a single archive: the SDK, a settings header with
the gateway's broker address, identity, credentials and CA certificate, one metric table
per device type, the example project and a quickstart.

**Why this priority**: it removes copying settings by hand and keeps the firmware's
metric names and types identical to the profiles they will be mapped to.

**Independent Test**: download a kit for a registered gateway with two device types and
build its example on the desktop port; the gateway connects and every birth matches its
profile with no mapping changes.

**Acceptance Scenarios**:

1. **Given** a person with `Device.manage-connections` and a provisioned gateway,
   **When** they download its kit, **Then** the archive contains the files above, each
   device type named after its profile and revision, and the download is recorded in the
   activity log.
2. **Given** a person without that permission, **Then** the download is not offered and
   is refused if requested directly.
3. **Given** a profile is republished after a kit was built, **Then** devices running
   the old table keep working until a birth no longer matches the applied configuration,
   which then needs review as today.
4. **Given** a direct device, **Then** its existing kit still contains
   `device-config.json`, `ca.crt` and `quickstart.md`, and also the settings header and
   metric table, so the same SDK serves direct devices.

---

### User Story 5 - Onboard hundreds of discovered devices at once (Priority: P2)

A gateway has announced 247 meters on one RS-485 port. In **Connect → Discovery** the
operator filters by that gateway, selects the 247 sources whose metrics match, picks the
published meter profile, accepts the name pattern "Meter {device ID}", and onboards them
in one action. The portal reports progress and, at the end, how many devices were
created and activated and why any were not.

**Why this priority**: onboarding devices one at a time is not workable at this scale;
without this, the SDK delivers data nobody can activate.

**Independent Test**: with the desktop port announcing 247 devices, bulk-onboard them;
247 devices end up active with stored readings, and onboarding a source that does not
match the profile reports it without stopping the rest.

**Acceptance Scenarios**:

1. **Given** selected discovered sources and a published profile, **When** the operator
   starts bulk onboarding, **Then** each source becomes a device with that profile, the
   profile's suggested mappings, a generated unique name and code, and an activation
   request.
2. **Given** some sources lack a metric the profile needs or announce a different type,
   **Then** those are skipped with the reason, and the others continue.
3. **Given** bulk onboarding is interrupted or repeated, **Then** no source gets two
   devices and finished devices are not redone.
4. **Given** a person without permission to manage and activate devices, **Then** bulk
   onboarding is not offered and is refused if requested directly.

---

### User Story 6 - See the gateway's own health (Priority: P2)

The operator onboards the gateway's health metrics as a device using a gateway health
profile, then sees uptime, signal, firmware version and connected device count on a
dashboard, and receives the `gateway_offline` alert
([alerts](../../docs/features/alerts.md#kinds)) when the gateway drops off.

**Why this priority**: the partner asked for visibility into the gateway itself; the
platform already stores and alerts on any onboarded device, so the gap is onboarding a
gateway's own metrics.

**Independent Test**: connect a gateway, onboard its own source with the health
profile, then stop the gateway; the device shows its last values with their age and
goes offline.

**Acceptance Scenarios**:

1. **Given** a registered gateway that has announced its health metrics, **Then** its
   own source can be onboarded as a device without creating a new gateway.
2. **Given** that device is active, **Then** its health metrics behave like any other
   device's: history, dashboards, alerts and the offline alert.
3. **Given** the SDK's default health metrics, **Then** a built-in gateway health profile
   matches them without editing.

---

### User Story 7 - Run a simulated gateway without hardware (Priority: P3)

A developer without the partner's hardware runs the SDK's desktop port as a gateway
simulator from a kit, choosing how many simulated devices of each type it reports and
how their values change. It connects to a local stack or a test environment like real
firmware.

**Why this priority**: development, demos and load checks need many devices before any
hardware exists; it is also how the SDK is tested end to end.

**Independent Test**: start the simulator with 500 devices from a kit against the local
stack; all 500 appear in Discovery, then reconnecting it re-announces them all.

**Acceptance Scenarios**:

1. **Given** a kit, **When** the simulator starts with a device count per type, **Then**
   it behaves as a gateway with that many devices, using the same SDK code as firmware.
2. **Given** the simulator is stopped and restarted, **Then** it resumes with a new
   session and re-announces its devices, keeping state across restarts.

### Edge Cases

- **Reconnect bursts.** After an outage a gateway re-announces itself and every device.
  The SDK paces the announcements so the uplink and the platform are not flooded, and
  holds a device's data until that device has been announced.
- **Outages.** Values read while disconnected are dropped in this feature and the
  platform shows the devices offline; buffering and replaying them is later work
  (FR-030).
- **Clock not set.** At boot a gateway may not know the time. The SDK never stamps
  values with a time it knows is unset: until the clock is valid it holds announcements.
  After five minutes without a valid clock it reports why, and repeats the report every
  minute until the clock is set.
- **Device IDs.** IDs must be unique per gateway and use only the characters the
  platform accepts (letters, digits, `_ . : -`, up to 128). The SDK rejects a duplicate
  or invalid ID when it is added.
- **Device type changes in the field.** A gateway built against an older profile
  revision keeps reporting the older metric table. The platform's existing review rule
  applies when a birth no longer matches the applied configuration.
- **Two gateways with one identity.** Running two gateways with the same kit makes them
  take over each other's sessions. The quickstart says each kit is for one gateway; the
  SDK reports repeated session takeovers.
- **Large device types.** A device type with many metrics can exceed a modem's message
  limit; the SDK reports it (User Story 3) and the kit warns when a type's announcement
  would exceed the SDK's default message buffer (4 KiB).
- **Commands while offline.** A command for a device the gateway has marked offline is
  rejected and reported; the platform's existing command outcome rules apply.
- **Many devices, many types.** Compile-time limits on devices, types and metrics per
  type decide memory use. Exceeding them fails at the call that would exceed them, never
  by dropping data silently.
- **Kit for an unprovisioned gateway.** Refused with a message, as for direct kits.
- **Bulk onboarding scale.** Bulk onboarding of more sources than allowed in one action
  asks the operator to split it; each device it creates is an ordinary device and counts
  as one wherever devices are counted.

## Requirements *(mandatory)*

### Functional Requirements

**SDK core**

- **FR-001**: The SDK MUST encode and decode the Sparkplug B messages the platform
  accepts: node and device births, data, deaths, and node and device commands, with
  boolean, signed and unsigned 8 to 64-bit integers, float, double, string and
  date-time values, and null values for metrics with no current reading. 64-bit integer
  values are limited to ±2^53, the range the platform keeps exactly.
- **FR-002**: The SDK MUST keep a Sparkplug edge node session for the integrator: birth
  and death sequence numbers, the message sequence with its wrap, a death message
  registered as the connection's will, rebirth on the platform's request, and new
  announcements when the platform's host application comes back online.
- **FR-003**: The SDK MUST let the integrator add a downstream device with an ID and a
  device type, publish some or all of its metrics, mark it offline, and receive commands
  for it, without composing Sparkplug messages.
- **FR-004**: Device types MUST be shared: many devices of one type use one metric table,
  so memory grows with the number of devices only by a small fixed amount per device.
- **FR-005**: The SDK MUST use no dynamic memory and MUST have compile-time limits for
  devices, device types, metrics per type and message size; exceeding a limit MUST fail
  at the call that would exceed it with a reason.
- **FR-006**: The SDK MUST stamp every value with the time the integrator supplies or the
  clock's current time, and MUST NOT publish values while the clock is known to be unset.
- **FR-007**: The SDK MUST pace announcements of the node and its devices after a
  connect or rebirth, and MUST NOT send a device's data before that device's birth in the
  current session.
- **FR-008**: The SDK MUST publish the gateway's health metrics: uptime, connection type,
  signal strength when the network reports it, firmware version, configured and online
  device counts, and reconnect count; the integrator MAY add their own.
- **FR-009**: The SDK MUST reject commands for unknown devices or metrics, metrics that
  do not accept commands, and values of the wrong type, and report each rejection.
- **FR-010**: The SDK MUST report connection state, authentication failures and session
  takeovers to the integrator through a callback and the logging interface, and retry
  connections with growing delays.

**Porting interfaces**

- **FR-011**: The SDK core MUST NOT depend on an operating system, network stack, TLS
  library or vendor SDK; everything hardware or platform specific MUST go through
  documented interfaces.
- **FR-012**: The network MUST be pluggable at two levels: a TLS byte stream that the SDK
  runs MQTT over, or a complete MQTT interface for modems that run MQTT themselves.
- **FR-013**: The SDK MUST define interfaces for the clock (UTC milliseconds and whether
  it is valid), optional persistent storage (keeping the birth sequence across reboots),
  logging and locking, with defaults where a sensible one exists.
- **FR-014**: Each interface MUST be documented with its contract, error handling and a
  template the integrator can fill in, including a template for a UART cellular modem.

**Reference ports and tests**

- **FR-015**: The SDK MUST include a reference port for the i.MX RT1050 evaluation board
  on Ethernet using the vendor SDK's network and TLS components, FreeRTOS, and the MQTT
  client bundled with the SDK, with an example project that builds unchanged from a kit.
- **FR-016**: The SDK MUST include a desktop port (macOS and Linux) that runs the same
  core, used by the automated tests and as the gateway simulator of User Story 7.
- **FR-017**: The SDK's automated tests MUST check its messages against the Sparkplug
  definitions and fixtures the platform runtime uses, and a test MUST run the desktop
  port against a running stack with zero runtime diagnostics for a session covering
  births, data, deaths, rebirth and sequence wrap.

**Kits**

- **FR-018**: People with `Device.manage-connections` MUST be able to download a kit for
  a provisioned gateway from its page, choosing a published profile revision for the
  gateway's health metrics and one per downstream device type (Q1).
- **FR-019**: A gateway kit MUST contain the SDK, a settings header (broker address,
  Sparkplug group, edge node and host identities, credentials, CA certificate), one
  metric table per device type generated from its profile revision (names, types, units,
  aliases), the example project and a quickstart.
- **FR-020**: The direct-device kit MUST keep its current files and MUST also contain the
  settings header and metric table for the device.
- **FR-021**: Kits MUST be private, not cacheable and recorded in the activity log;
  credentials MUST NOT appear anywhere else in public APIs or profile artifacts.
- **FR-022**: The kit MUST record the SDK version and each profile revision it was built
  from, and MUST warn when a device type's announcement would exceed the expected
  maximum message size.

**Gateway health and onboarding**

- **FR-023**: An existing gateway's own source MUST be onboardable as a device under that
  gateway, without creating a new gateway or connection.
- **FR-024**: The platform MUST provide a built-in gateway health profile matching the
  SDK's default health metrics.
- **FR-025**: People who may manage and activate devices MUST be able to bulk-onboard
  selected discovered sources of one gateway with one published profile, generated names
  and codes, and the profile's suggested mappings (Q3).
- **FR-026**: Bulk onboarding MUST validate each source on its own, skip mismatches with
  their reasons, never create two devices for one source, survive interruption and
  repetition, and report progress and outcome per source.
- **FR-027**: Bulk onboarding MUST follow the existing activation rules: each device is
  active only after the runtime acknowledges it, and it appears in the activity log.

**Distribution and compatibility**

- **FR-028**: The SDK MUST be distributed from this repository and inside kits under a
  permissive licence that allows closed-source commercial firmware (Q2), with its own
  version number and changelog.
- **FR-029**: Direct-device onboarding, its kit, the runtime's Sparkplug handling,
  permissions and existing gateways MUST behave as before.
- **FR-030**: Buffering values during an outage and replaying them as historical data
  is out of scope; the storage interface MUST leave room for it without breaking ports.

### Key Entities

- **SDK release**: a versioned copy of the library with its interfaces, reference ports,
  tests and changelog; kits record which release they contain.
- **Gateway kit**: a private archive for one gateway: settings, credentials, CA
  certificate, device types, SDK release, example and quickstart; who downloaded it and
  when is in the activity log.
- **Device type**: the metric table generated from one published profile revision:
  metric names, data types, units and aliases. Shared by every downstream device of that
  type.
- **Downstream device**: a device behind a gateway, identified by the integrator's ID,
  announced with one device type; on the platform it is a discovered source until
  onboarded.
- **Gateway health profile**: a built-in published profile for the SDK's default health
  metrics.
- **Bulk onboarding run**: one operator action over selected sources: gateway, profile
  revision, name pattern, and the outcome for each source.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A firmware engineer with the reference evaluation board goes from
  downloading a kit to the gateway and two devices showing readings in the portal in
  under one hour, editing only the files the quickstart names.
- **SC-002**: Supporting a new uplink requires implementing only the documented network
  interface, with no change to SDK source.
- **SC-003**: A gateway with 500 devices of three types fits the SDK's state in 32 KB of
  RAM or less, excluding the network and TLS stacks.
- **SC-004**: After an outage, a gateway with 500 devices has re-announced all of them
  within five minutes of reconnecting, with no sequence or birth diagnostics on the
  platform.
- **SC-005**: An operator onboards 247 discovered devices of one type in under five
  minutes of their own time.
- **SC-006**: Every message the SDK produces in the automated end-to-end session is
  accepted by the platform runtime with zero diagnostics.
- **SC-007**: Direct-device onboarding, existing kits and existing gateways behave as
  before (their existing tests pass unchanged).

## Assumptions

- The partner's field devices, Modbus or RS-485 drivers and modem drivers stay the
  integrator's; the SDK starts at "a device with this ID reported these values".
- The reference port uses the network and TLS components that ship with the vendor SDK
  and FreeRTOS. Its MQTT client is the same open-source client the vendor SDK ships,
  bundled with the SDK at a pinned release so every build runs the tested code; a
  project builds only that copy, never the vendor's as well.
- The reference board is the i.MX RT1050 evaluation kit with Ethernet. Hardware
  verification happens on that board; the desktop port does not stand in for it
  (constitution IX).
- One gateway kit per gateway. Device types are fixed when the kit is built; adding a
  type means a new kit and a new firmware build, while adding devices of a known type
  does not.
- Health metrics from the SDK use stable names, so one built-in profile fits every
  gateway that keeps the defaults.
- A Zephyr port, over-the-air firmware updates, Sparkplug templates and datasets,
  store-and-forward and modem-specific drivers are out of scope for this feature.
- The ESP32 alarm board firmware is not migrated to the SDK in this feature.
- Partner names, hardware product names and locations stay out of the repository; the
  spec refers to them as "the hardware partner".
