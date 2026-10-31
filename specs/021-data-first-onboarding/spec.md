# Feature Specification: Data-First Device Onboarding

**Feature Branch**: `spec/021-data-first-onboarding`

**Created**: 2026-10-28

**Status**: Draft

**Input**: Owner request: rethink the onboarding flow for devices and data sources that
do not speak Sparkplug B. Anyone who comes to the platform should be able to connect a
new device or data source and start ingesting its data, guided step by step, with the
AI assistant as a guide. The concern is monitoring (ingestion); controlling devices is
out of scope. New protocols must stay easy to onboard through device adapters.

## Context

The owner and the assistant walked through onboarding on `main` (bf13f27) in the local
stack on 2026-10-28. What a newcomer meets today:

1. **Add device** (Fleet → Devices) is a four-step wizard: Device, Connection details,
   Check connection, Activate. It is built around Sparkplug B. The first question is
   "How does this device send data?", **It speaks Sparkplug B** is the first,
   preselected choice, and the side help explains Sparkplug births. Choosing
   **Manufacturer data (MQTT, webhook or vendor API)** ends the wizard: a paragraph and
   a **Continue to device adapters** link, while the stepper still shows the four
   Sparkplug steps.
2. **Device adapters** (Build) → **New adapter** opens a workbench whose first tab
   asks for an adapter name and a **published device profile**. Profiles are authored
   and published elsewhere (Build → Device profiles). The person must define the
   readings (keys, data types, units) before seeing one message from the device.
3. The workbench has six tabs (Device type, Connection, Decode & test, Review & deploy,
   Devices, Activity). Once saved, it also shows a six-step setup checklist (device
   type, connect, capture samples, decoder, test and deploy, activate devices) whose
   steps do not line up with the tabs. Counting the wizard, there are three step
   vocabularies for one job.
4. Decoding means writing a JavaScript `decode` function and JSON fixtures with
   expected metrics, even for flat JSON where the work is picking fields. A new adapter
   starts with a water-meter decoder and the topic filter `meters/+/telemetry` filled
   in as values, not hints.
5. Raw input is kept before deployment only for webhooks, and polling has Fetch now.
   MQTT sources show input only as decoded previews or failed-decode excerpts from a
   deployed revision, so the first payload from an MQTT device is seen only after a
   decoder has been written and deployed.
6. First setup shows operational controls: the revision hash, a tested rollback
   revision, pause, draft and applied revision numbers, and **Publisher not
   connected**. When every step is done, the checklist still heads the page.
7. The onboarding assistant (spec 020) is reached through a link ("Not sure how your
   device connects?") or the checklist's **Ask the assistant**, which opens the
   general assistant home where onboarding is one card among several. Its proposals
   are chat cards with their own review view, beside the forms rather than in them.
8. The job crosses five navigation entries: Devices, Device profiles, Device adapters,
   Discovery and Connections. Statuses disagree in places: the adapter list shows
   deployment **Running** next to source **Stopped: credentials rejected**, and the
   sidebar's Discovery count (29) differs from the "waiting" count on Add device (18).

Each part works. The friction is order and fragmentation: the platform asks for its
internal model (profile, adapter, revision, candidate) before it shows people their
data.

**Revisiting spec 020.** Spec 020 chose a setup checklist on the adapter workbench and
"no separate wizard". The checklist tells people where they stand, but it starts from
the profile and leaves the order to them. This spec keeps the checklist's state model
as the source of truth for progress and puts one guided journey on top of it, in
data-first order.

**Walkthrough, 2026-10-31.** The owner had new simulated devices of each kind
onboarded on the local stack, once with the forms and once with the assistant
([ux-walkthrough.md](ux-walkthrough.md)).

- **Forms**: only the Sparkplug B form finished cleanly.
- **Assistant**: it never took a device from a description to stored readings.
  - It could not draft a device type from chat.
  - It proposed reusing the wrong adapter.
  - Every approval moved to another page and opened a new, empty conversation.
  - Its decoder test could not use a pasted sample.
  - It asked again for what it had been told.
  - Secrets, deployment and activation sent the person to tabs.

The owner's direction: the assistant keeps the person in the flow until the device
stores readings, and every approval happens in the conversation.

**Boundaries that do not change**

- Revisions are immutable, and only an exact revision that passed its test is deployed
  (principle II). A decoder made with the field mapping is an ordinary decoder
  revision: same sandbox, tests, revisions and deployment.
- Nothing a source reports is stored as telemetry until a person activates its device.
- AI proposes, people approve. The assistant never publishes, deploys, activates or
  sees credentials, and everything works with the assistant disabled (principle V). A
  button in an action card is the person's action, not the assistant's. Pressing it
  in the conversation is the same approval as pressing it in a form.
- No role or permission changes. Each action in the journey needs the permission it
  needs today.
- Captured input, mappings and copied setups stay in their organization (principle
  III, ADR-010). There is no cross-organization catalogue (ADR-023: none ahead of
  demand).
- Existing adapters, decoders and API routes keep working. API changes are additive.
- ADR-023's split stays: opaque payloads use a decoder and typed protocols use a point
  map. The journey gives both the same step (Choose readings).

**Terms**

- *Journey*: the guided path from "what are you connecting?" to stored readings: a
  start screen, then four steps: **Connect**, **See data**, **Choose readings** and
  **Start collecting**.
- *Setup*: one person's journey for one source, saved as it goes.
- *Data source*: what people see a device adapter called in the journey and the
  navigation. "Device adapter" stays the name in the API and the developer docs.
- *Connector*: a kind of source the platform can take data from. Today: devices publish
  to the tenant broker, vendor MQTT broker, HTTP webhook and HTTP polling (adapter
  connectors), and Sparkplug B direct and gateway (native connectors). A connector
  defines its settings, how it captures input, how its readings are chosen and the
  reasons it reports when data does not arrive.
- *Captured input*: a raw message a source received, kept whether or not a decoder is
  deployed.
- *Field mapping*: a no-code description of where the device identity, each reading's
  value, unit and scale, and optionally the source time sit in captured input. It
  produces the decoder.
- *Device type*: the device profile readings are stored under. It is generated from
  the field mapping or an existing profile is reused.
- *Setup mode* and *Manage mode*: the two ways a source's page opens, before and after
  it first collects data.
- *Action card*: a proposal in the onboarding conversation that carries the control
  applying it, such as **Use these settings**, **Create secret**, **Use this
  mapping** or **Start collecting**, and then shows the result. It is the same
  proposal the step's form shows as suggested values.

## Clarifications

### Session 2026-10-28

- Q: Do native Sparkplug B direct and gateway devices move into the same four-step
  journey now, or keep today's wizard behind the new start screen? → A: The same four
  steps now. Today's wizard steps map one to one (connection details → Connect, check
  connection → See data, metric mapping → Choose readings, activate → Start
  collecting); their behaviour does not change.
- Q: May a person opt a source into activating new serials automatically when they
  first report? → A: No. A person activates every serial, as today; new serials wait
  and are activated in one step.
- Q: What do people see an adapter called? → A: "Data source" in the journey and the
  navigation; "device adapter" stays in the API and the developer docs.

### Session 2026-10-31

These follow the owner's request after the walkthrough.

- Q: Where does a person approve what the assistant proposes? → A: In the
  conversation. Each step ends in an action card whose button applies the change.
  The step's form shows the same change, and the assistant then continues to the
  next step. Nobody has to find the button in a tab and come back.
- Q: What happens to the conversation when an approval opens another page? → A:
  Nothing. There is one conversation per setup. It survives approvals, navigation
  and reloads, and opening the assistant anywhere in the setup or its source opens
  it.
- Q: How important is the assistant path? → A: First-class. User Story 5 becomes P1:
  a person with only a description reaches stored readings in the conversation. The
  journey still works fully without the assistant (principle V).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See the data before defining anything (Priority: P1)

A person has a sensor that publishes its own JSON over MQTT. They start **Add device**,
say the device can send to a server address they choose, take the connection kit,
configure the device, and within seconds of its first publish see the raw messages
(topic, payload, time received) without choosing a device profile or writing a
decoder. When nothing arrives, the page says what the platform does see (rejected
credentials, no connection, messages on other topics) and what to check.

**Why this priority**: "the platform sees my device" is the first moment of value.
Today it comes after a published profile, a decoder and a deployment.

**Independent Test**: in the local stack, start on Add device with the vendor
environmental sensor simulator, choose the tenant broker connector, take the kit,
start the simulator with it, and see raw messages within 10 seconds with no profile
chosen and no revision deployed. Repeat with the webhook simulator (deliveries) and
the vendor API simulator (Fetch now).

**Acceptance Scenarios**:

1. **Given** no published profile fits the device, **When** the person chooses a
   connector and saves its settings, **Then** the source is saved as a draft with no
   profile and no decoder.
2. **Given** a saved tenant-broker or vendor-broker source with no deployed revision,
   **When** the device publishes, **Then** each message appears in See data within 10
   seconds with its time received, topic, size, retained flag and payload.
3. **Given** a webhook source, **Then** deliveries appear in the same view; **given** a
   polling source, **Then** Fetch now shows its records there too.
4. **Given** the device publishes on topics outside the source's filters, **Then** See
   data says so, where the connector can observe it, and offers to add a filter.
5. **Given** rejected credentials or no connection, **Then** See data shows the
   connector's reason in plain words with the check that fixes it, as it happens.
6. **Given** nothing has arrived yet, **When** the person pastes a sample message from
   the vendor's documentation, **Then** they can continue to Choose readings; the
   sample is labelled as pasted.

---

### User Story 2 - Choose readings without code (Priority: P1)

The person sees a captured message as a tree of fields. The platform has already
suggested which field identifies the device (a serial, ID, IMEI or MAC address) and
which fields are readings, with the data types and units it could infer. The person
ticks the readings to keep, renames them, sets units and scale (millilitres a minute
to litres a minute), and picks the field that carries the measurement time if there
is one. Every captured sample is decoded with the mapping as it changes, so mistakes
show at once. The person then names the device type: reuse a profile that matches, or
let the platform create one from the chosen readings.

**Why this priority**: most vendor payloads are flat JSON. Picking fields is the job;
writing code is not.

**Independent Test**: with the environmental sensor simulator's captured messages,
choose the identity field and three readings, set a scale on one, and see every sample
decode correctly without typing code. The generated device type lists exactly those
readings with their units.

**Acceptance Scenarios**:

1. **Given** captured JSON, **Then** the field tree shows every field path seen across
   the samples with example values, and the identity field and readings are suggested
   with the assistant disabled.
2. **When** the person changes the mapping, **Then** every captured and pasted sample
   is decoded again within 1 second and each shows its result or why it failed.
3. **Given** a message that carries a list of records, **Then** the person can choose
   the list, and each item becomes one input.
4. **Given** a source that is a single device with no identity field, **Then** the
   person names the device once for the source.
5. **Given** a published profile whose readings overlap the chosen ones, **Then** it is
   offered for reuse with its matched, missing and extra readings and unit
   differences.
6. **Given** no profile is reused, **Then** a device type is created from the chosen
   readings as a draft profile the person can open in the profile editor.
7. **Given** a payload the mapping cannot express, **When** the person chooses **Edit
   as code**, **Then** the decoder generated from the mapping opens; after the code is
   saved the mapping is read-only until the person resets to it.
8. **Given** a chosen time field, **Then** readings are source-timed with that time;
   otherwise they are receipt-timed (spec 020).

---

### User Story 3 - Start collecting in one step (Priority: P1)

A summary lists what will happen: the device type to publish or reuse, the decoder
revision with its sample results, the source settings, and the serials seen so far
with a checkbox each. One **Start collecting** tests the exact revision, publishes the
device type, deploys, and activates the checked serials, in that order. It stops at
the first failure and says what failed and how to fix it. A progress view follows
until the runtime acknowledges, then a success state shows the first stored reading
of each new device and offers what to do next.

**Why this priority**: today test, deploy and activate are separate tabs with
separate buttons. People stop at "deployed" and wonder why nothing is stored.

**Independent Test**: from User Story 2's mapping, press Start collecting and see the
simulator's serials become active devices with stored readings, without visiting
another page.

**Acceptance Scenarios**:

1. **Given** a mapping whose samples decode, **When** the person confirms Start
   collecting, **Then** the exact revision's test runs and must pass before anything
   is published or deployed.
2. **Given** a new device type, **Then** it is published as an immutable profile
   revision during the sequence, and the summary showed it before confirmation.
3. **Given** the runtime acknowledges the deployment, **Then** each checked serial is
   activated as soon as it reports through the deployed revision, and unchecked
   serials stay waiting.
4. **Given** a step fails, **Then** earlier steps stay done, the summary marks the
   failed step with the reason and the fix, and confirming again resumes there.
5. **Given** the person lacks the permission for a later step, such as activation,
   **Then** the steps before it run and the setup shows that it waits for someone who
   can activate, naming the permission.
6. **Given** activated devices, **When** each stores its first reading, **Then** the
   success state shows that reading with its age and offers: open the device, add a
   dashboard, create an alert, add another device of this type.
7. **Given** no reading is stored within 2 minutes of activation, **Then** the state
   shows when input was last received, decoded, published and stored, and the first
   of those that failed, with its reason.

---

### User Story 4 - One start, in the person's words (Priority: P2)

**Add device** opens a start screen that asks where the data can come from, in the
words people use rather than protocol names:

- "The device can send to a server address I choose" (MQTT; then whether it speaks
  Sparkplug B, its own format, or the person does not know).
- "It's in the manufacturer's cloud or app" (then: their cloud can send to a web
  address; they give you an API key; they give you an MQTT server).
- "It's on a local plant network" (Modbus, OPC UA, BACnet: explains the edge gateway
  path with a Sparkplug B uplink, ADR-023).
- "It's already sending data" (sources waiting to be added).
- "I'm not sure" (describe it, paste a message or attach the datasheet).

Each choice says what the person will need before they commit, for example access to
the vendor cloud's webhook settings or an API key. Every path then follows the same
four steps. Progress is saved, and unfinished setups appear on the Devices page with
**Resume**.

**Why this priority**: the protocol-first question is where newcomers stall, but the
P1 stories deliver value through the existing entry points without it.

**Independent Test**: a person who has never used the platform, given only the
environmental sensor's documentation, reaches the right connector from the start
screen without help, leaves after See data, and resumes from the Devices page at the
same step.

**Acceptance Scenarios**:

1. **Given** the start screen, **Then** no choice requires knowing a protocol name.
2. **Given** a choice, **Then** the person sees what they will need and what happens
   next before continuing.
3. **Given** any path, native Sparkplug B included, **Then** the stepper shows
   Connect, See data, Choose readings and Start collecting.
4. **Given** a setup left at any step, **Then** the Devices page lists it with
   **Resume**, which opens the step reached.
5. **Given** an organization without device adapters, **Then** the start screen
   offers only the native paths and does not mention adapters.

---

### User Story 5 - The assistant carries the setup in the conversation (Priority: P1)

A person describes the device in the start box, pastes a message, or attaches the
vendor's documentation. The assistant then takes them through the four steps without
sending them elsewhere.

- **Choosing the path**: it chooses the connector from what it was told and asks only
  for what it cannot find out.
- **Each step ends in an action card in the conversation**, and the person presses
  the button there:
  - **Use these settings**, with secret fields typed into the card itself;
  - **Create secret**, shown once in the card;
  - **Download connection kit**;
  - **Use this mapping**, showing each sample's decoded values;
  - **Create device type**;
  - **Start collecting**, with the summary and a checkbox per serial.
- **After each press**: the card shows the result, the step's form shows the same
  values, and the assistant continues to the next step on its own.
- **While waiting**: it explains failures as they happen, for example "deliveries
  are rejected: the vendor signs with the header X-Signature".
- **At the end**: the conversation shows the first stored reading and offers what to
  do next.
- **Navigation**: the conversation is the same one wherever the person goes.

**Why this priority**: in the walkthrough the assistant was the path people expect
and the one that failed. It shortens the slowest parts (finding the path, reading
vendor documentation, decoding) only if it never drops the person mid-way. The
journey must still work without it.

**Independent Test**: with the assistant enabled, the person brings each simulator
to stored readings from a description, pressing only buttons in the conversation:

- the environmental sensor through the tenant broker;
- the webhook cloud;
- the tracker API;
- a direct Sparkplug B meter.

They leave the conversation only to configure the simulator, which stands in for
the device or vendor cloud. The conversation never resets, and the assistant never
asks for something it was already told.

**Acceptance Scenarios**:

1. **Given** the assistant is disabled, **Then** the start box still accepts a pasted
   message for the field suggestions, attachments are not offered, and every step
   works.
2. **When** the person opens the assistant from the journey, **Then** it opens the
   onboarding conversation for this setup beside the step, not the assistant's home.
3. **Given** a step the assistant can propose for, **Then** the conversation shows an
   action card with what it changes and the control that applies it, and the step's
   form shows the same values marked as suggested. **When** the person presses the
   control, **Then** the change is saved as if they had saved the form, the card
   shows the result, and the assistant continues.
4. **Given** an applied card that opens or changes a page, **Then** the same
   conversation stays open with its history.
5. **Given** a card that needs a secret, **Then** the secret is typed into a field in
   the card, or created and shown once in the card. It goes straight to the platform
   and never into the conversation or to the model.
6. **Given** a mapping or decoder proposal, **Then** the card shows each sample's
   decoded values with units before the person applies it, with the code behind
   **Show code**.
7. **Given** the person already gave a fact in the conversation, an attachment or
   captured input, **Then** the assistant does not ask for it again. Optional
   questions never block **Continue**.
8. **Given** failures on See data, **Then** the assistant explains them from the
   connector's reason and the redacted evidence and suggests the fix.
9. **Given** the setup reaches Start collecting, **Then** the conversation shows the
   summary card. The person presses **Start collecting** there, the progress shows in
   the card, and the assistant never presses it or runs any part of it.
10. **Given** a native Sparkplug B device, **Then** the conversation creates the
    device after the person confirms, offers the connection kit, watches for the
    birth, matches metrics and offers **Activate**, with the same cards.

---

### User Story 6 - Setup, then manage (Priority: P2)

Once a source collects data, opening it shows Manage: one plain status sentence
("Receiving from 12 devices · last message 8 seconds ago", or the worst current
problem), then devices, readings, activity, settings, revisions, pause and delete.
Changing the readings or the settings opens a draft that reuses See data and Choose
readings over recent input and ends with **Apply changes**, which follows the same
summary and order as Start collecting, without activation.

**Why this priority**: first-time setup and day-to-day operation need different
pages; mixing them is part of today's overload.

**Independent Test**: open a collecting source and see one status sentence with no
checklist; break its credentials and see the sentence name the problem at the right
hop; change a reading's scale and apply it while the old revision keeps running until
the new one is acknowledged.

**Acceptance Scenarios**:

1. **Given** a source with no deployed revision or no activated device, **Then** it
   opens in Setup at the step its state implies; otherwise it opens in Manage.
2. **Given** Manage, **Then** one status names the worst current problem and where it
   is; deployment and source state never contradict each other.
3. **Given** Setup, **Then** no revision hash, rollback, pause, publisher state or
   revision numbers are shown.
4. **Given** a draft change in Manage, **Then** the applied revision keeps running
   until the person confirms Apply changes and the runtime acknowledges it.

---

### User Story 7 - Add another device of a known type (Priority: P3)

For a device type the organization already collects, **Add another of this type** is
offered on the start screen, the device type, the source and the success state. For a
device that publishes to the tenant broker, it creates a new hardware credential and
kit, waits for the new serial in See data, and activates it. For cloud sources no new
connection is needed: new serials are already waiting. **Start from an existing
setup** copies a source as the starting point for a similar device type.

**Why this priority**: the second device should take minutes, but it only matters
once the first one works.

**Independent Test**: with one environmental sensor collecting, add a second
simulator instance as another device of the type in under 2 minutes without seeing
Choose readings.

**Acceptance Scenarios**:

1. **Given** a tenant-broker source, **When** the person adds another device, **Then**
   the journey is Connect (new kit), See data (the new serial), Start collecting
   (activate), with no mapping step.
2. **Given** a cloud source, **Then** the person is told no new connection is needed
   and sees the waiting serials.
3. **Given** a copy, **Then** it never includes credentials or secrets, it is a draft
   that must pass its test, and it stays in the organization.

---

### User Story 8 - New connectors use the same journey (Priority: P3)

When the platform adds a protocol, such as an OPC UA client or DLMS meters through a
head-end system (ADR-023), it is added as a connector: its start-screen answer and
what the person will need, its settings and secrets, how it captures input for See
data, whether readings are chosen with a field mapping or a point map, its failure
reasons with their fixes, and the assistant tools it allows. The start screen, the
steps, the summary, the success state, Manage and the assistant's step guidance need
no change.

**Why this priority**: it is what keeps onboarding simple as protocols arrive, but it
pays off with the next protocol, not this release.

**Independent Test**: the four adapter connectors are described as connectors, and a
test-only connector in the local stack, described only through its definition,
completes the journey to stored readings with no change to the start screen, steps,
summary or Manage beyond the connector's own settings form.

**Acceptance Scenarios**:

1. **Given** connector definitions, **Then** the start screen lists the connectors
   available to the organization and explains why an unavailable one is unavailable
   (for example webhooks need the operator's public address).
2. **Given** a connector, **Then** See data uses its capture method and shows its
   failure reasons with their fixes.
3. **Given** a typed-protocol connector, **Then** Choose readings uses its point map
   in place of the field mapping (the point-map editor is specified with the first
   typed connector).

---

### Edge Cases

- **Mixed message types on one source** (telemetry and heartbeats on one topic): the
  mapping can be limited to messages whose topic or field matches a value; the others
  are ignored and counted on See data.
- **Binary or text payloads**: shown as hex and text; they go to Edit as code with a
  starter decoder that the assistant can complete when enabled. No-code byte mapping
  is out of scope.
- **Base64 inside JSON** (for example a LoRaWAN network server's uplink): the mapping
  treats it as a field; decoding the bytes needs code.
- **Values in another unit or scale**: the person sets scale and offset; the preview
  shows converted values beside the raw ones.
- **Readings with no field in some samples**: shown as missing for that sample, not as
  zero (principle VI); a reading missing from every sample cannot be chosen.
- **Field names that change type between samples** (a number sent as a string in some
  messages): the preview flags the samples where the type differs.
- **A reused profile with readings the mapping does not fill**: they are listed as not
  reported by this source; the person may continue.
- **Code edited, then the person wants the mapping back**: Reset to mapping discards
  code changes after confirmation.
- **Adapters built before this feature**: they open in Manage with their code; the
  field mapping is not offered for them unless the person resets the readings.
- **The device turns out to speak Sparkplug B** on a source expecting manufacturer
  data: where the connector can tell, See data says so and offers the native path.
- **Nothing ever arrives**: See data keeps the connector's reasons visible; the person
  can continue with a pasted sample, but the success state waits for real input.
- **A serial already belongs to a device activated through another source**: it is
  shown as in use and cannot be activated here, as today.
- **Two people editing one draft**: the existing draft revision check applies; the
  second save is refused with a reload.
- **The person leaves during Start collecting**: the sequence continues on the server;
  Resume shows where it stands.
- **Captured input holds personal data** (GPS positions): it is kept for the same
  bounded time as webhook samples and visible only to people who can view the source.
- **The form changes while a card is pending**: the card is marked out of date with
  what changed. The assistant refreshes it from the saved state; nothing applies
  over newer edits.
- **A message is sent while the assistant is working**: it waits in order and is sent
  when the run ends, and the box says so. It is never dropped.
- **The person lacks a permission a card needs** (for example creating secrets or
  activation): the card says who can press it. The setup waits for that person, as
  for Start collecting (FR-052).
- **The assistant is switched off mid-setup**: the setup continues in the forms. Its
  applied changes are ordinary draft revisions.

## Requirements *(mandatory)*

### Functional Requirements

**Start and navigation**

- **FR-001**: Add device MUST open a start screen that asks where the data can come
  from in plain words, offering: the device sends to a server address the person
  chooses; the manufacturer's cloud or app (then: it sends to a web address, it gives
  an API key, it gives an MQTT server); a local plant network; it is already sending;
  and not sure. No choice may require knowing a protocol name.
- **FR-002**: Each choice MUST show what the person will need and what happens next
  before they continue.
- **FR-003**: Every path MUST use the same four steps: Connect, See data, Choose
  readings, Start collecting. Native Sparkplug B direct and gateway devices keep their
  behaviour under these names: the connection kit in Connect, the birth check in See
  data, metric matching to the profile in Choose readings, and activation in Start
  collecting.
- **FR-004**: A setup MUST be saved on the server as it goes. Leaving and returning
  resumes at the step reached. The Devices page and Home's attention list MUST show
  unfinished setups with **Resume**, and **Discard** for drafts nothing uses.
- **FR-005**: The journey MUST be reachable from Add device, from the Device adapters
  page's create action and from the waiting sources. Completing it MUST NOT require
  visiting Device profiles, Discovery or Connections.
- **FR-006**: When device adapters are not enabled for the organization, the start
  screen MUST offer only the native paths and not mention adapters.

**Connect**

- **FR-010**: Connect MUST show only the chosen connector's settings. Examples are
  placeholders, never saved values.
- **FR-011**: A source MUST be savable with no device profile and no decoder.
- **FR-012**: Credentials and secrets MUST be entered in forms only and keep spec
  020's storage, redaction and permission rules.
- **FR-013**: For a tenant-broker source, Connect MUST create the hardware credential
  and offer its connection kit in the same step.

**See data**

- **FR-020**: Every adapter connector MUST capture raw input before any revision is
  deployed: tenant-broker and vendor-broker messages on the source's filters, webhook
  deliveries, and polling records through Fetch now. Captured input MUST be kept like
  webhook samples today (the last 20 per source, for 7 days); bodies of unauthenticated
  input are never kept.
- **FR-021**: See data MUST show captured input within 10 seconds of receipt with its
  time received, topic or path, size, retained flag where it applies, and the payload,
  formatted as JSON when it parses and as hex and text otherwise.
- **FR-022**: See data MUST show, as they happen, the connector's reasons why input is
  not arriving or not accepted (for example rejected credentials, no connection,
  messages outside the filters where the connector can observe them, rate limiting,
  vendor API errors), each with a plain explanation and the check that fixes it.
- **FR-023**: The person MUST be able to paste a sample message (with its topic or
  path) and continue before real input arrives. Pasted samples are labelled and do not
  count as received input.
- **FR-024**: Where a connector can tell that input is native Sparkplug B, See data
  MUST say so and offer the native path.

**Choose readings**

- **FR-030**: For JSON input, Choose readings MUST show every field path seen across
  the captured and pasted samples with example values, and let the person choose: the
  device identity field (or a fixed identity for a single-device source); the readings
  to keep, each with key, label, data type, unit, scale and offset; an optional
  source-time field with its format (ISO 8601, epoch seconds or epoch milliseconds);
  and an optional list of records within a message.
- **FR-031**: The platform MUST suggest the identity field and the readings from the
  samples without the assistant, from field names and from which values vary.
  Suggestions are marked and take effect only when the person confirms them.
- **FR-032**: Every change to the mapping MUST decode every captured and pasted sample
  again within 1 second and show each sample's identity and readings, or why it
  failed.
- **FR-033**: The person MUST be able to limit the mapping to messages whose topic or
  a field matches a value; other messages are ignored and counted on See data.
- **FR-034**: The field mapping MUST produce an ordinary decoder revision (same
  sandbox, test, revision and deployment rules as hand-written code) and be stored
  with the revision so it can be reopened.
- **FR-035**: **Edit as code** MUST open the decoder generated from the mapping. Once
  edited code is saved, the mapping is read-only and labelled as edited in code;
  **Reset to mapping** restores the generated decoder after the person confirms that
  code changes will be lost.
- **FR-036**: The samples the person checked in Choose readings (at most 10, the
  revision test's limit) MUST become the revision's test fixtures, with the decoded
  results they saw as the expected values. The person can mark a sample as expected
  to fail.
- **FR-037**: Input that is not JSON MUST go to Edit as code, shown as hex and text,
  with a starter decoder.

**Device type**

- **FR-040**: Choose readings MUST offer to reuse a published profile whose readings
  overlap the chosen ones, showing matched, missing and extra readings and unit
  differences. Reusing maps the chosen readings onto that profile's keys.
- **FR-041**: Otherwise the platform MUST create the device type as a draft profile
  from the chosen readings (key, label, data type, unit), named by the person, which
  opens in the profile editor for anything more (groups, calculations, alarms) and is
  published by Start collecting.
- **FR-042**: When a field's unit differs from a reused profile's unit, the person
  MUST be able to set scale and offset, and the preview shows the converted values.

**Start collecting**

- **FR-050**: Start collecting MUST show a summary before confirmation: the device type
  to publish or reuse with its readings, the decoder revision with each sample's test
  result, the source settings without secrets, and the serials seen so far, each with
  a checkbox to activate.
- **FR-051**: On confirmation the platform MUST, in order: run the revision test on
  the exact revision; publish the device type if it is new or changed; deploy the
  revision; and activate each checked serial as soon as it reports through the
  deployed revision (a serial seen only before deployment must send once more).
  Completed steps stay done; a failure stops the sequence with its reason
  and fix; confirming again resumes at the failed step. The sequence continues if the
  person leaves the page.
- **FR-052**: Each step MUST require the permission it requires today. A person
  without one can complete the steps before it; the setup then shows that it waits for
  someone with that permission, names it, and stays in the unfinished setups.
- **FR-053**: After activation, the success state MUST show each activated device's
  first stored reading with its age, and offer: open the device, add a dashboard,
  create an alert, add another device of this type.
- **FR-054**: If no reading is stored within 2 minutes of activation, the state MUST
  show when input was last received, decoded, published and stored, and the first of
  those that failed with its reason. Unknown is shown as unknown (principle VI).
- **FR-055**: Serials that first report after Start collecting MUST be listed on the
  source and among the waiting sources, each activatable in one step. There is no
  automatic activation: a person activates every serial.

**Setup and Manage**

- **FR-060**: A source MUST open in Setup until a revision is deployed and a device
  activated, and in Manage after that.
- **FR-061**: Setup MUST NOT show revision hashes, rollback, pause, publisher state or
  draft and applied revision numbers.
- **FR-062**: Manage MUST lead with one status sentence: the source's worst current
  problem and where it is, or the number of receiving devices and the time of the last
  message. Deployment state and source state MUST NOT contradict each other anywhere
  they are shown, including the adapter list.
- **FR-063**: Manage MUST offer the devices (with waiting serials to activate), the
  readings and device type, activity (spec 020), settings and credentials, revisions
  with rollback and pause, and delete (spec 020's rules).
- **FR-064**: Changing readings or settings in Manage MUST open a draft that reuses See
  data (recent captured input) and Choose readings, and ends with **Apply changes**: the
  summary and ordered sequence of Start collecting without activation. The applied
  revision keeps running until the runtime acknowledges the new one.
- **FR-065**: A count of waiting sources MUST be the same wherever it appears
  (navigation badge, Add device, Discovery), or say what it counts.

**Assistant**

- **FR-070**: The start screen MUST offer one input to describe the device, paste a
  message or attach documentation; attachments only with the assistant enabled. With
  the assistant disabled, a pasted message feeds the field suggestions (FR-031).
- **FR-071**: Each setup MUST have one onboarding conversation. Opening the assistant
  from the journey, the setup's source, its device type or any step MUST open that
  conversation beside the page, never the assistant's home or a new conversation. It
  MUST survive applied cards, navigation and reloads with its history.
- **FR-072**: The assistant's proposal for a step MUST appear in the conversation as an
  action card. The card shows what it changes and carries the control that applies
  it. The same proposal MUST appear in the step's form as suggested values.
  - Applying it from either place is the person's save of that step: one draft
    revision (spec 020's proposal rules).
  - The card then shows the result.
  - Cards cover the connector choice, non-secret settings, secret entry and creation
    (FR-075), the connection kit, the field mapping, decoder code, fixtures, reusing
    or drafting the device type, Start collecting, and activating serials.
- **FR-073**: On See data the assistant MUST explain current failures from the
  connector's reasons and the redacted evidence and suggest the fix.
- **FR-074**: The assistant MUST NOT press a card's control or run Start collecting or
  any step of it (the test that gates deployment, publishing, deployment,
  activation). It shows the card and the person presses it, in the conversation or
  the form (principle V, spec 020 FR-108).
- **FR-075**: Spec 020's credential rule (FR-107) and Fetch now limits (FR-039,
  FR-106) MUST carry over unchanged.
  - A secret entered in a card goes from the card's field straight to the platform,
    as from the form.
  - A secret created in a card is shown once in the card.
  - Neither enters the conversation history, the model's context or a proposal.

**Connectors**

- **FR-080**: Each connector MUST be described by one definition: its start-screen
  answer and what the person needs; its availability (organization feature,
  permissions, operator settings); its settings and secrets; its capture method; its
  readings mode (field mapping or point map); its failure reasons with explanation and
  fix; and the assistant tools it allows.
- **FR-081**: The four adapter connectors and the two native Sparkplug B connectors
  (direct and gateway) MUST be described this way, and the start
  screen, the See data reasons and the assistant's step guidance MUST come from the
  definitions.
- **FR-082**: Adding a connector MUST need only its definition, settings form, capture
  method and readings mode, with no change to the start screen, steps, summary,
  success state or Manage.

**Reuse**

- **FR-090**: **Add another of this type** MUST be offered on the start screen for
  device types the organization collects, on the device type, in Manage and in the
  success state.
- **FR-091**: For a tenant-broker source it MUST create a new hardware credential and
  kit for the existing source and wait for a new serial in See data; for a cloud
  source it MUST say that no new connection is needed and show the waiting serials.
- **FR-092**: **Start from an existing setup** MUST copy a source's settings without
  secrets, its mapping or code, its fixtures and its device type into a new draft
  source in the same organization.

**Language**

- **FR-100**: The journey MUST use plain words: "device type" for profile, "readings"
  for parameters and metrics, "device ID field" for the decoder's source device ID.
  An adapter is called a "data source" in the journey and the navigation (the
  **Device adapters** entry becomes **Data sources**); the API and developer docs keep
  "device adapter". Revisions, the publisher, candidates and artifacts appear only in
  Manage.
- **FR-101**: The journey's side help MUST be specific to the step and the connector.

**Measurement**

- **FR-110**: The platform MUST record for each setup when each step was first reached
  and completed, which connector was used, whether the assistant was used, how many
  cards were applied in the conversation and how many steps were saved in forms,
  whether code was edited, and the time from start to first stored reading, without
  payloads or secrets, so platform administrators can measure the success criteria.

**Contracts and docs**

- **FR-120**: API changes MUST be additive and update the OpenAPI description and
  `packages/api-client`. New cross-process messages, such as captured-input reports
  from the adapter runtime, MUST get versioned contracts with golden fixtures
  (principle IV).
- **FR-121**: `docs/features/adapters.md`, `devices.md` and `assistant.md`, the
  onboarding journey diagram and the developer docs MUST change with the behaviour.
- **FR-122**: The local stack's simulators MUST cover every adapter connector end to
  end through the journey, including a flat-JSON device for each, and a direct
  Sparkplug B device that is its own edge node.

**Assistant in the conversation**

- **FR-130**: After the person applies a card, the assistant MUST continue to the next
  step without being asked. The conversation MUST show the step reached and what is
  left (for example "Step 3 of 4 · Choose readings · next: Start collecting").
- **FR-131**: Mapping and decoder cards MUST show each captured or pasted sample's
  decoded values with units, and any failure, before the person applies them. Code
  appears only behind **Show code**.
- **FR-132**: Before asking, the assistant MUST use what it already has: the
  conversation, attachments, captured input and Fetch now results. It MUST NOT ask
  again for a fact it was given. Optional questions MUST NOT block **Continue**.
- **FR-133**: The assistant MUST propose reusing an existing source only when the
  device type and the source settings match (the same endpoint, account or topics).
  The card says what reuse changes. A new endpoint, account or device type gets a new
  source.
- **FR-134**: The assistant MUST be able to draft the device type from the person's
  description and the samples, citing them as stated by the person. It MUST be able
  to test a mapping or decoder against pasted and captured samples without saved
  fixtures.
- **FR-135**: For the native Sparkplug B connectors, the conversation MUST:
  1. propose the device with its name and device type;
  2. offer the connection kit after the person confirms;
  3. show the birth check;
  4. propose metric matches;
  5. offer **Activate**.

  Each step uses the same cards, with today's behaviour and permissions (FR-003).
- **FR-136**: The activation card MUST list every serial seen, with checkboxes, and
  activate the checked ones in one press (spec 020's one-step activation, in a
  batch). The conversation then shows each device's first stored reading and the next
  actions of FR-053.
- **FR-137**: A message sent while the assistant is working MUST wait in order and be
  sent when the run ends. Escape MUST close only the innermost open control. Each
  reply MUST appear once.

### Key Entities

- **Setup**: one person's journey for one source in one organization: connector,
  step reached, state of each step, the draft source and device type it created or
  reused, the serials chosen, who started it and when, and timings (FR-110).
- **Connector definition**: the description of one connector (FR-080). Platform
  configuration, not tenant data.
- **Captured input**: one raw message a source received, with time, topic or path,
  size, flags and payload; bounded in number and age; never from unauthenticated
  input.
- **Field mapping**: part of a decoder revision: identity, readings with key, label,
  type, unit, scale and offset, optional time field and format, optional record list,
  optional message filter; or a marker that the code was edited by hand.
- **Device type**: an ordinary device profile, generated from a mapping or reused.
- **Activation selection**: the serials a person checked in Start collecting.
- **Onboarding conversation**: the one assistant conversation bound to a setup, and to
  its source once saved.
- **Action card**: an immutable proposal in that conversation with its kind, the step,
  the values it applies, the evidence it cites and its state (open, applied, out of
  date, dismissed). It is shown in the conversation and as suggested values in the
  step's form.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Starting on Add device, a person connects the environmental sensor
  simulator through the tenant broker and sees its first stored reading within 10
  minutes, without writing code and without leaving the journey.
- **SC-002**: The same holds for the webhook simulator and the vendor API simulator
  within 15 minutes each.
- **SC-003**: Every flat-JSON simulator shipped with the platform can be mapped with
  no code.
- **SC-004**: For every adapter connector, captured input is visible within 10 seconds
  of receipt, before any revision is deployed.
- **SC-005**: In a moderated test, at least 4 of 5 people who have never used the
  platform, given only a device's documentation, reach stored readings without help;
  the same test is run on today's flow first as the baseline.
- **SC-006**: From start to first stored reading, a person visits one journey instead
  of today's three or more areas.
- **SC-007**: Adding a second device of an existing type takes under 2 minutes.
- **SC-008**: A test-only connector added through a definition completes the journey
  with no change to the start screen, steps, summary or Manage.
- **SC-009**: With the assistant disabled, SC-001 to SC-004 still hold.
- **SC-010**: Across the onboarding evaluation set, no assistant reply, context or
  tool result contains a saved credential or webhook secret.
- **SC-011**: With the assistant enabled, a person starting from a description brings
  each of these to its first stored reading by pressing buttons only in the
  conversation:
  - the environmental sensor through the tenant broker;
  - the webhook cloud;
  - the tracker API;
  - a direct Sparkplug B meter.

  The only thing done outside the conversation is configuring the simulator. The
  conversation never resets. Each takes no longer than SC-001's and SC-002's limits.
- **SC-012**: Across the onboarding evaluation set, the assistant asks no question
  whose answer is already in the conversation, an attachment or captured input. It
  proposes no reuse of a source whose device type or source settings differ.

## Assumptions

- Scale is the pilot's: a single-node Compose deployment, tens of organizations and
  hundreds of devices per source.
- People onboarding have device-management permission; activation and connection
  permissions may sit with someone else (FR-052).
- The field mapping covers JSON. Binary payloads use code, with the assistant's help
  when enabled.
- The point-map editor for typed protocols (ADR-023) is specified with the first
  typed connector; this spec reserves its place in Choose readings.
- Not in this feature: device control and downlink, a cross-organization catalogue of
  device templates, no-code byte mapping, OAuth for polling, and changes to roles and
  permissions.
- Spec 020's checklist state model remains the source of truth for progress; the
  journey and Manage read it.
- Existing adapters keep their code and behaviour, and open in Manage.
- Product names in examples are public examples only; no customer, prospect or pilot
  names appear in the spec, fixtures or docs.
