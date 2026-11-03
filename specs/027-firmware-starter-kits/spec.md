# Feature Specification: Firmware Starter Kits

**Feature Branch**: `spec/027-firmware-starter-kits`

**Created**: 2026-11-03

**Status**: Draft; open questions answered by the owner on 2026-11-03

**Input**: "What if a user creates a profile and then wants to actually download the SDK
for another microcontroller like the ESP32 or something else. Users should be able to
easily download the SDK along the onboarding workflow as well as the AI. So they just
download and use it." And: "we should also create a prompt in the readme file so that
the user can use an AI like Claude Code and start programming it. But it should ask
questions about what kind of protocol, IOs etc. … all the relevant questions that are
needed to program the device for the firmware developer."

## Context

[Spec 026](../026-embedded-gateway-sdk/spec.md) added an embedded SDK
([`firmware/sdk`](../../firmware/sdk/README.md), MIT): a portable library that handles
the Sparkplug B session for a direct device or a gateway and leaves network, clock,
storage, logging and locking to small ports. Its desktop port and simulator are merged.
It also planned **connection kits**: one archive per gateway or direct device holding
the device's credentials, metric tables generated from published profiles, the SDK, and
an example for one board, the NXP i.MX RT1050 evaluation kit
([kit layout](../026-embedded-gateway-sdk/contracts/kit-layout.md),
[ADR-029](../../docs/adr/ADR-029-embedded-sdk-and-gateway-kits.md), Proposed). The kit
generator is not built yet.

That plan serves one board and one moment: an operator who has already registered the
hardware. Firmware work starts earlier and on other hardware. A developer who has just
published a device profile wants to start writing firmware for whatever microcontroller
they use, often an ESP32, before any device exists, and increasingly with an AI coding
agent. Today they would have to:

- register a device or gateway first, only to get a kit;
- receive the device's password inside an archive they then open in AI tools, which
  send what they read to the tool's provider;
- port the SDK to their microcontroller by hand from templates;
- work out alone what the field side needs (which register, which pin, which scale).

The platform knows the second half of the firmware (what to publish: every metric's
name, type, unit and whether it accepts commands) but not the first (where each value
comes from on the hardware). Other IoT platforms let people pick a platform and download
a ready package; this feature does that for the SDK and adds a structured way for an AI
coding agent to collect the missing half from the developer.

This feature delivers:

1. **Firmware starters**: a credential-free download, generated from published profiles
   for a chosen target microcontroller, that builds as shipped and is safe to commit and
   to open in AI tools.
2. **An AI brief** inside every starter that has a coding agent interview the developer
   for the hardware facts the platform cannot know, record them, and only then write the
   field-side code.
3. **Connection settings** as a separate, permission-gated download for one device or
   gateway, which completes a starter.
4. **One generator behind every place firmware work starts**: the profile page, the
   Add device wizard, the gateway page and the assistant. The developer docs explain
   the SDK and send readers there.

**Terms**: a *firmware developer* (the *integrator* in spec 026) writes the firmware. A
*target* is a microcontroller family and its vendor framework, for example ESP32 with
ESP-IDF. A *starter* is the credential-free download. *Connection settings* are the
credential files for one device or gateway. A *kit* is a starter plus its connection
settings (spec 026's "connection kit"). The *AI brief* is the instructions file a coding
agent reads; the *device brief* is the file the agent writes from the developer's
answers. The *field side* is the firmware that reads and writes the physical device
(registers, pins, buses); the *platform side* is the SDK's Sparkplug session. A *built
target* ships a port and an example that CI builds; an *AI-assisted target* ships the
port templates and porting instructions, and the developer's coding agent writes the
port.

## Decisions

The draft left three questions open. The owner answered them on 2026-11-03.

- **Q1. Can starters be downloaded without signing in?** **No.** The SDK exists to
  connect devices to the platform, so starters are generated only for signed-in members
  of an organization from that organization's profiles. The developer docs describe the
  SDK, the targets and the AI workflow, and send readers to sign in. Not chosen: a
  generic starter on the docs site, or shareable links to a tenant's starter.
- **Q2. Where does the device brief live?** **In the developer's project only**, in a
  versioned format so a later spec can add uploading. The brief is the device's own
  information: its parameters (where each metric comes from, its address, type, scaling
  and unit), its commands, and instructions for whoever writes or maintains the firmware
  (wiring, calibration steps, quirks). Not chosen: attaching briefs to profile revisions,
  or turning them into field mappings that generate code.
- **Q3. Which targets are in the first wave?** **ESP32, NXP i.MX RT and Linux as built
  targets**: the evaluating hardware partner from spec 026 needs the NXP target now.
  **Other microcontroller families are AI-assisted targets**: the picker names them, and
  their starter carries the port templates and porting instructions in the one
  instructions file that common coding agents (Claude Code, Codex and others) read, so
  the developer's agent writes the port. Not chosen: adding more built targets, such as
  STM32, in the first wave.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Download a starter for my microcontroller (Priority: P1)

A firmware developer opens a published device profile, chooses **Firmware**, picks their
target (ESP32, NXP i.MX RT or Linux, or another family such as STM32 as an AI-assisted
target) and downloads a starter. It
holds the SDK, the profile's metric table, the target's port and an example project
with build files, a quickstart, the AI brief, and a manifest naming the SDK version and
profile revision. The example builds without changes and, run without settings, says
clearly that it has no connection settings yet.

**Why this priority**: it is the request itself, and every other story builds on it.
It also lets firmware work start before any device or gateway is registered.

**Independent Test**: publish a profile, download a starter for each built target that
is available (Linux from the first implementation PR; ESP32 and NXP i.MX RT once their
pull requests land), build each example in its target's standard toolchain without
edits, and confirm the archives contain no credentials.

**Acceptance Scenarios**:

1. **Given** a person who can view a published profile, **When** they choose a target
   and download, **Then** they receive a starter whose metric table matches that
   profile revision (names, types, units, which metrics accept commands) and whose
   manifest records the SDK version, profile revision, target and generation time.
2. **Given** a starter for any built target, **When** its example is built unmodified
   with that target's documented toolchain, **Then** the build succeeds.
3. **Given** a starter, **When** its example runs without connection settings, **Then**
   it stops with a message saying where to put the settings, and does not attempt to
   connect.
4. **Given** a profile with only a draft, **Then** no starter is offered and the section
   says to publish first.
5. **Given** an AI-assisted target, **Then** the starter contains the port templates and
   the porting instructions for that family instead of a buildable example, its manifest
   names the family, and the picker says so before download.
6. **Given** a person who is not signed in, **Then** no starter can be downloaded.

---

### User Story 2 - Let an AI coding agent interview me and write the field side (Priority: P1)

The developer opens the starter in an AI coding agent (Claude Code, Codex, Cursor,
Copilot or similar) and pastes the one-line prompt from the README, or the agent picks
up the brief by itself. Before writing code the agent interviews them, asking only what
the starter does not already say:

- **Hardware**: board and microcontroller, framework version, memory limits.
- **Uplink**: Ethernet, Wi-Fi, or a cellular modem, and whether that modem runs TLS
  and MQTT itself.
- **Time and storage**: the time source, and where credentials will be stored.
- **For each metric, where the value comes from**:
  - Modbus RTU or TCP: port, baud rate, parity, device address or range, function code,
    register, data type, byte and word order, scale and offset;
  - an analog or digital pin and its calibration;
  - an I²C or SPI sensor, by part number;
  - CAN, or a pulse counter.
- **For each metric that accepts commands**: what the command does physically and how
  the new state is read back.
- **Behaviour**: polling interval, report on change or on a deadband, when a field
  device counts as offline, power and sleep, watchdog.

The agent writes the answers to a device brief in the project: the device's parameters,
its commands, and instructions such as wiring, calibration steps and quirks. It asks the
developer to confirm the brief. Only then does it write the field-side code against the
SDK's public interface. It never changes the SDK, and it never opens or prints the
connection settings.

**Why this priority**: the platform already knows what to publish; the slow and
error-prone part is the hardware side, which differs per device. Collecting it as
reviewable data first is what makes AI-written firmware trustworthy and reusable for
every device of the same type.

**Independent Test**: on a bench with an ESP32 board and a Modbus RTU temperature and
humidity sensor, open an ESP32 starter in a coding agent with the README prompt, answer
the interview, and confirm the agent writes the device brief before any code, the code
builds, and readings arrive for the profile's metrics after the connection settings are
added.

**Acceptance Scenarios**:

1. **Given** a starter opened in a coding agent, **When** the developer gives the README
   prompt, **Then** the agent's first output is interview questions, not code, and none
   of them asks for something the starter states (metric names, types, units, which
   metrics accept commands, gateway or direct device).
2. **Given** a gateway starter with several device types, **Then** the interview covers
   each device type once, plus how downstream devices are addressed and named, and the
   brief applies to every device of a type.
3. **Given** the developer answers "I don't know" for a register or pin, **Then** the
   brief records it as unknown, and the code leaves a clearly marked gap that keeps that
   metric unpublished (sent as null in births) instead of an invented value.
4. **Given** the interview is complete, **Then** the device brief lists every metric
   with its source, and the agent writes code only after the developer confirms the
   brief.
5. **Given** the agent works in the project, **Then** its instructions forbid opening,
   printing or committing the connection settings, and the starter's version-control
   ignore rules exclude them.
6. **Given** a brief from an earlier session, **When** the developer adds a device type
   or changes a register, **Then** the agent updates the brief first and then the code.
7. **Given** an AI-assisted target, **Then** the interview also covers what the port
   needs (the family's network and TLS stack, persistent storage, clock and locking), the
   agent writes the port from the templates before the field side, and it builds and
   runs the firmware against the platform before reporting success.
8. **Given** Claude Code, Codex or another agent that reads the common instructions file,
   **Then** each runs the same interview from the same file without a separate copy per
   agent.

---

### User Story 3 - Add the connection settings for one device or gateway (Priority: P1)

When the hardware is ready, a person allowed to manage connections downloads the
**connection settings** for one registered direct device or gateway: broker address,
identity, credentials and CA certificate, in the layout every starter expects. They drop
the settings into the project, rebuild and flash. People who want everything in one
archive download the **full kit** (starter plus settings) instead. On the gateway page
this replaces today's "Get credentials" instructions.

**Why this priority**: without settings no device connects. Keeping the credentials out
of the starter makes the starter shareable and safe to open in AI tools.

**Independent Test**: download settings for a registered device, add them to a starter
project built in US1, and confirm the device connects and its births match its profile
with no mapping changes; confirm a person without the permission is not offered the
settings and is refused if they request them directly.

**Acceptance Scenarios**:

1. **Given** a person with `Device.manage-connections` and a provisioned device or
   gateway, **When** they download its settings, **Then** they receive only the settings
   files and CA certificate, and the download is recorded in the activity log without
   secrets.
2. **Given** a person without that permission, **Then** neither settings nor the full
   kit are offered, and direct requests are refused.
3. **Given** settings added to any built-target starter, **Then** the example connects
   with no other edits.
4. **Given** the full kit, **Then** it equals a starter for the chosen target plus the
   settings, and is private, not cacheable and recorded like today's kits.
5. **Given** a direct device, **Then** its existing kit files (`device-config.json`,
   `ca.crt`, `quickstart.md`) remain available with their current content.

---

### User Story 4 - Get firmware where my work starts (Priority: P2)

The same starter is offered wherever someone may begin firmware work:

- **Device profile page**: a Firmware section once a revision is published.
- **Onboarding**: the connection step of today's **Add device** wizard for a direct
  Sparkplug device offers "I'm writing the firmware". This gives the starter for the
  chosen profile and target and, for the device being set up, its connection settings
  in the same step. When [spec 021](../021-data-first-onboarding/spec.md)'s journey
  ships, its Connect step reuses this.
- **Gateway page**: a Firmware action that picks the gateway's health profile and one
  profile per downstream device type, then offers the starter, the settings or the full
  kit.

**Why this priority**: it removes the detour through registering hardware just to get
code, but each entry point only reuses US1 and US3.

**Independent Test**: from each entry point, download a starter for the same profile
and target and confirm the archives are identical apart from generation time.

**Acceptance Scenarios**:

1. **Given** the Add device wizard's connection step for a direct Sparkplug device,
   **When** the person chooses "I'm writing the firmware" and a target, **Then** the step
   offers the starter and, if they may manage connections, the device's full kit. The
   wizard then continues to its next step as today.
2. **Given** a gateway, **When** a person chooses Firmware, **Then** the gateway's
   health profile is preselected, they choose one published profile per downstream
   device type, and the choices are remembered for the next download from that gateway,
   for every person who opens it. With nothing saved yet, the profiles of devices
   already under the gateway are suggested.
3. **Given** the same profile revisions and target, **Then** every entry point produces
   the same starter contents.

---

### User Story 5 - Ask the assistant for firmware (Priority: P2)

In the assistant, a person says, for example, "I want to write ESP32 firmware for the
water meter profile". The assistant confirms the profile and target and shows an action
card that downloads the starter when the person presses it. When settings are needed, it
links to the device or gateway page, where they download under the person's own
permissions (or, once spec 021's assistant cards exist, offers its kit card). Credentials
never appear in the conversation. The assistant can explain the
starter and the interview, but it does not write firmware on the platform.

**Why this priority**: the assistant is where people describe what they want, but it
stays optional (constitution V). Everything here also works without it.

**Independent Test**: with the assistant enabled, ask for a starter, press the card, and
confirm the download matches US1; inspect the stored conversation and tool results for
the absence of credentials.

**Acceptance Scenarios**:

1. **Given** the assistant is enabled, **When** a person asks for firmware for a
   profile, **Then** the assistant asks only for what it cannot infer (which profile if
   ambiguous, and the target) and offers a starter card.
2. **Given** the person may not view the profile, **Then** the assistant does not offer
   it.
3. **Given** a request for credentials, **Then** the assistant links to the device or
   gateway page (or spec 021's permission-checked kit card once it exists), and no tool
   result, message or log contains credentials.
4. **Given** the assistant is disabled, **Then** US1 to US4 work unchanged.

---

### User Story 6 - Keep a firmware project current (Priority: P3)

A developer whose project was generated from profile revision 3 and SDK 0.1 downloads a
starter for revision 4 or a newer SDK. The generated metric tables and the SDK sit in
their own folders, so they replace those folders, keep their application code and device
brief, and see from the manifests what changed.

**Why this priority**: projects outlive their first download; without this, every
profile change risks overwriting AI-written code.

**Independent Test**: generate a project, add application code and a device brief,
download a starter for a newer profile revision, replace the generated and SDK folders
as the quickstart describes, and confirm the application code and brief are untouched
and the project still builds.

**Acceptance Scenarios**:

1. **Given** a starter, **Then** generated files, the SDK and the developer's own files
   are in separate folders, and the quickstart says which ones a newer starter may
   replace.
2. **Given** two starters for different profile revisions, **Then** the newer manifest
   lists the metrics added, retired or changed in type or unit since the older revision.
3. **Given** a device running firmware from an older profile revision, **Then** it keeps
   working until its birth no longer matches its applied configuration, which then needs
   review as today.

---

### Edge Cases

- **Draft or retired profile**: no starter; the section says to publish, or which revision
  is current.
- **Metrics the device does not send**: derived and calculated parameters are left out
  of the metric table, as in today's kit.
- **A birth too large for the default buffer**: the download warns, as spec 026's kit
  does, and the quickstart says which limit to raise.
- **Too many device types for a gateway**: more types than the SDK's default limit is
  refused before download, with the limit and how to raise it.
- **Profile codes that clash as C identifiers**: resolved as spec 026 defines, the same
  way in every target.
- **A modem that runs MQTT itself**: the built-target examples use Ethernet or Wi-Fi; the AI
  brief and port templates cover the modem path, and the interview asks about it.
- **Interview answers the agent cannot verify** (a register map from memory): the brief
  marks them unconfirmed until a reading proves them; the quickstart says to compare the
  first readings with the device's own display or tool.
- **Settings without a starter**: the settings files are useful only with a starter or
  full kit; the download says so.
- **Archived device or unready connection**: no settings, with the reason, as today.
- **Repeated settings downloads**: the same credentials each time; there is no rotation
  (as ADR-029).
- **Someone commits the settings anyway**: the starter's ignore rules make this an
  explicit act; the quickstart says what to do if credentials leak (archive the device or
  gateway and register a new one until rotation exists).
- **An AI agent that ignores the brief**: the starter contains no credentials, so the
  worst case is a poor interview, not a leak.
- **Assistant disabled for the organization**: every non-assistant entry point works.
- **A family the picker does not name**: the generic AI-assisted target ("Other
  microcontroller") offers the same templates and instructions without family notes; the
  assistant offers it for requests like "Arduino" and says what it contains.

## Requirements *(mandatory)*

### Functional Requirements

**Starter contents**

- **FR-001**: The platform MUST generate a starter from published profile revisions: one
  for a direct device, or for a gateway its health profile plus one per downstream device
  type.
- **FR-002**: A starter MUST contain the SDK release, a generated metric table per
  profile (names, Sparkplug datatypes, units, whether each metric accepts commands), the
  target's port and example project with build files, a quickstart README, the AI brief
  and a manifest.
- **FR-003**: The manifest MUST record the SDK version, each profile code and revision,
  the target, the generation time, and any warnings, and MUST contain no secrets.
- **FR-004**: A starter MUST NOT contain credentials or any connection detail of a
  device or gateway (broker address, namespace, identity, CA certificate). All of these
  come with the connection settings, so a starter depends only on its profiles, target
  and SDK version.
- **FR-005**: A starter MUST keep generated files, the SDK and the developer's own files
  in separate folders, and include version-control ignore rules that exclude the
  connection settings.
- **FR-006**: A starter's example MUST refuse to connect when connection settings are
  missing and say where to add them.
- **FR-007**: Every entry point MUST use the same generator, and for the same profile
  revisions, target and SDK version MUST produce the same starter apart from its
  generation time.

**Targets**

- **FR-010**: The first wave MUST offer three built targets:
  - ESP32, on the vendor's framework with its TLS, real-time OS, flash storage and time
    sync, over Wi-Fi;
  - NXP i.MX RT, on the vendor's SDK with FreeRTOS over Ethernet, from spec 026's board
    port (Q3);
  - Linux and desktop, from spec 026's desktop port.
- **FR-011**: Each built target MUST ship an example that builds unmodified with the
  target's documented toolchain version, and MUST be built in CI whenever the SDK, a
  port or the generator changes.
- **FR-012**: Targets MUST add ports and examples only; the SDK's public interface and
  wire behaviour stay as spec 026 defines them.
- **FR-013**: For the same inputs, every built target's example MUST send the same
  messages as the desktop port, and MUST keep its session sequence (`bdSeq`) across
  reboots.
- **FR-014**: The picker MUST also offer AI-assisted targets: named families (at least
  STM32, Raspberry Pi Pico and Nordic nRF) and a generic "Other microcontroller". Their
  starters MUST contain the port templates and porting instructions, MAY add short notes
  for the named family, and MUST NOT claim a tested example. Adding a family's notes
  MUST NOT require a release of the SDK.

**AI brief and device brief**

- **FR-020**: Every starter MUST include its agent instructions in one instructions file
  that common coding agents (Claude Code, Codex and others) read automatically, with at
  most a one-line pointer for agents that look for their own file name, and a README
  section with a one-line prompt for agents that read neither. There MUST be one copy of
  the instructions, not one per agent.
- **FR-021**: The instructions MUST make the agent interview the developer before writing
  code, ask only for information the starter does not contain, and cover hardware,
  uplink, time source, credential storage, each metric's source, each command's physical
  effect and read-back, polling and reporting behaviour, offline detection, power and
  watchdog (US2).
- **FR-022**: The instructions MUST make the agent write the answers to a device brief
  in a documented format, ask the developer to confirm it, and write or change code only
  from a confirmed brief.
- **FR-023**: The device brief format MUST be versioned and documented, and MUST record
  unknown answers as unknown. Code generated for an unknown source MUST leave the metric
  unpublished rather than invent a value.
- **FR-024**: The instructions MUST forbid the agent to open, print, copy or commit the
  connection settings, and to modify the SDK or generated folders.
- **FR-025**: The instructions MUST direct the agent to the SDK's public interface and
  threading rules (spec 026), and to build and run the example before it reports
  success.
- **FR-026**: The device brief MUST stay in the developer's project; the platform MUST
  NOT collect it (Q2). It MUST hold the device's information: its parameters (for each
  metric, the source, address, data type, scaling and unit), its commands (physical
  effect and read-back), and free-text instructions for whoever writes or maintains the
  firmware (wiring, calibration steps, quirks), which the agent follows.

**Connection settings and full kits**

- **FR-030**: People with `Device.manage-connections` MUST be able to download the
  connection settings for a provisioned direct device or gateway, in the layout every
  starter expects.
- **FR-031**: The same people MUST be able to download a full kit (a starter for a chosen
  target plus the settings) in one archive.
- **FR-032**: Settings and full kits MUST be private, not cacheable, throttled and
  recorded in the activity log without secrets, as kits are today (ADR-029).
- **FR-033**: The direct-device kit's existing files MUST keep their current content.
- **FR-034**: The gateway page MUST replace the "Get credentials" instructions with
  these downloads; the server export command MUST keep working.

**Entry points**

- **FR-040**: The device profile page MUST offer a Firmware section for published
  revisions to anyone who may view the profile.
- **FR-041**: The Add device wizard's connection step for a direct Sparkplug device MUST
  offer "I'm writing the firmware", giving the starter and, where permitted, the
  device's full kit, without changing the wizard's other steps. Spec 021's Connect step
  reuses it when that journey ships.
- **FR-042**: The gateway page MUST offer Firmware with the gateway's health profile
  preselected and one profile per downstream device type, and MUST remember the last
  selection for that gateway.
- **FR-043**: When the assistant is enabled, it MUST be able to offer a starter as an
  action card the person presses, scoped to profiles that person may view.
- **FR-044**: Starters MUST be downloadable only by signed-in members of the profile's
  organization who may view the profile (Q1); another organization MUST NOT be able to
  obtain them. The developer docs MUST describe the SDK, the targets, the AI
  workflow and the device brief format, and point readers to the Firmware section.
- **FR-045**: Merged into FR-007.

**Security and privacy**

- **FR-050**: Credentials (FR-004 covers the starter itself) MUST NOT appear in starters, manifests, AI briefs, assistant
  messages or tool results, public pages, logs or activity entries.
- **FR-051**: Merged into FR-044.
- **FR-052**: The assistant MUST NOT offer settings or full kits itself. It links to the
  device or gateway page, or, once spec 021's assistant cards exist, offers its
  permission-checked kit card, whose download goes directly to the person.

**Decisions and documentation**

- **FR-060**: A new ADR MUST record that starters are credential-free and separate from
  connection settings, and that the assistant may offer starters but never handle
  credentials; it amends ADR-029's kit decision.
- **FR-061**: Spec 026's kit layout MUST be amended so its gateway and direct-device
  kits are a starter plus settings from this generator, and spec 026's kit work MUST be
  built once, on this generator.
- **FR-062**: The SDK's feature documentation MUST describe targets, starters, settings,
  the AI brief and the device brief format.

### Key Entities

- **Target**: a microcontroller family and vendor framework offered in the picker. A
  built target has a port, an example project, build instructions and the toolchain
  version CI builds it with. An AI-assisted target has the port templates, porting
  instructions and optional family notes, and no example.
- **Firmware starter**: a credential-free archive for one target and a set of published
  profile revisions, made of the SDK release, generated metric tables, the target's
  example, the AI brief, a quickstart and a manifest.
- **Starter manifest**: the starter's record of SDK version, profile codes and revisions,
  target, generation time and warnings; also used to compare two starters.
- **Connection settings**: the credential files for one provisioned direct device or
  gateway (broker address, identity, credentials, CA certificate), private to people who
  may manage connections.
- **Full kit**: a starter plus connection settings in one archive; spec 026's connection
  kit.
- **AI brief**: the single instructions file common coding agents read, plus the README
  prompt, shipped in every starter: the interview, the rules on credentials and
  generated folders, and for AI-assisted targets the porting instructions.
- **Device brief**: the device's information as the developer confirmed it, kept in
  their project and never collected by the platform: hardware and uplink; for each device
  type its parameters (each metric's source, address, data type, scaling and unit), its
  commands (physical effect and read-back) and its reporting behaviour; and free-text
  instructions such as wiring, calibration steps and quirks. Unknown answers are marked
  as unknown.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On the bench, a firmware developer with an ESP32 board and a Modbus RTU
  sensor, using only the Firmware section, the starter's documents and an AI coding agent
  (no other help), gets the profile's readings stored on the platform within 60 minutes
  of opening the Firmware section, without editing the SDK or generated folders.
- **SC-002**: Every built target's unmodified example builds in CI on every change to
  the SDK, a port or the generator.
- **SC-003**: On the NXP i.MX RT evaluation board, an NXP starter plus connection
  settings connects over Ethernet and its births match the profile, with no edits outside
  the developer's own folder.
- **SC-004**: Devices built from starters produce births that match their profile with
  no mapping changes in every bench and simulator run.
- **SC-005**: Automated checks find no credentials in any generated starter, manifest,
  AI brief, assistant conversation or tool result, or activity entry.
- **SC-006**: From any entry point, a starter can be downloaded in at most three actions
  (open Firmware, choose target, download).
- **SC-007**: In bench runs with at least two different coding agents, the agent asks no
  question whose answer is in the starter, writes the device brief before any code, and
  never opens the connection settings.
- **SC-008**: Replacing a project's generated and SDK folders with a newer starter leaves
  every developer-owned file unchanged and the project still builds.

## Assumptions

- Spec 026's SDK, its desktop port and its fixtures are the base. Its board port for the
  NXP i.MX RT (PR 4, the i.MX RT1050 evaluation kit) is the NXP target's port and
  example, so the NXP target ships when that port lands; its built-in gateway health
  profile (PR 2) is the gateway's preselected profile. The plan orders the two specs'
  pull requests so the NXP starter is not delayed by the other targets.
- AI-assisted targets reuse spec 026's port templates; their quality depends on the
  developer's agent and hardware, and the platform tests only the built targets.
- Spec 026's kit generator (its PR 2) is not built yet. It will be built once, as this
  spec's generator, and spec 026 keeps its gateway-specific parts (health profile,
  gateway kit permissions, bulk onboarding).
- The ESP32 target uses the vendor's own framework (not Arduino) at a pinned long-term
  support version, and Wi-Fi in its example. Ethernet boards use the same port.
- The platform does not run or host AI for firmware. Any coding agent that reads the
  instructions file, or the pasted README prompt, can run the interview; the platform
  makes no promise about a particular agent's quality.
- Starters contain tenant profile data, so they are private to the organization like
  profiles, although they hold no secrets.
- Starter downloads are throttled like kits; generation for a profile of up to 64
  metrics per type takes a few seconds.
- The bench uses an ESP32 board the team already has, an RS-485 transceiver and a Modbus
  RTU temperature and humidity sensor, and spec 026's NXP evaluation-kit bench for the
  NXP target. Simulator success does not stand in for either (constitution IX).

### Out of scope

- Storing field-protocol mappings (for example Modbus register maps) in device profiles
  and generating field-side code from them without AI.
- Over-the-air firmware updates, and credential rotation.
- Built targets beyond ESP32, NXP i.MX RT and Linux (other families are AI-assisted),
  Arduino and PlatformIO projects, and specific cellular modem drivers.
- Starters for people who are not signed in, including a public starter on the docs
  site (Q1).
- Uploading device briefs to the platform (Q2).
- Generating finished firmware on the platform, or running AI on the platform to write
  firmware.
