# Feature Specification: Automation Nodes for Missing Data, Schedules and States

**Feature Branch**: `spec/014-automation-nodes`

**Created**: 2026-10-18

**Status**: Draft; decisions confirmed by the owner on 2026-10-18

**Input**: "Do you think these nodes are sufficient? … I mean any new nodes that you
think we should introduce?" The proposed answer, which the owner asked to specify: no
data, schedule, state match (with not), range and rate of change first; transition
counts, a notify action and fleet scope considered and placed in later waves.

## Context

DAG automation (workflow v2) has 16 node types
([automation](../../docs/features/automation.md#authoring)): device parameter, constant,
geofence, arithmetic, unit conversion, numeric compare, boolean and/or, branch,
hysteresis, time window, correlate inputs, sustained, cooldown, and the alert,
integration event and set device state actions. They cover numeric threshold alerts
well. Five common automations cannot be built today:

1. **A device stops reporting.** A reading becomes unknown once its binding's
   freshness expires; the runtime already wakes up at that moment, but all it can
   produce is unknown, and unknown inputs stop every action downstream ("No usable
   condition value; no action was requested"). That is correct for thresholds, but it
   means silence can never raise an alert, notify an integration or switch to a backup.
   A device that stops sending is invisible to automation.
2. **Only at certain times.** Nothing knows the time of day or the day of the week, so
   "after hours", "weekdays 08:00–18:00" or "only at night" cannot be expressed. Sites
   already have a time zone.
3. **On/off and named states.** Compare is numeric only. A string or enumerated
   reading (a mode such as `off`, `alarm`, `panic`) can reach only Correlate inputs, so
   it can never drive an action. Booleans work only when wired straight into Boolean
   logic, and the only way to negate a condition is the false output of Branch.
4. **Inside or outside a band.** "Below 2 °C or above 8 °C" needs two Compares and an
   OR, and the editor shows three nodes for one idea.
5. **How fast something changes.** Time window gives count, sum, min, max and average,
   but not the difference between the start and end of a period, so a temperature rise,
   a pressure drop or meter consumption per hour cannot be tested.

This feature adds node types for those five, so operators can build them in the editor,
test them in simulation and saved scenarios, and ask the automation assistant for them.
It changes no existing node, workflow, deployment or permission.

**Terms**: *node type* is an entry in the runtime's node catalogue (`*.v1`). *Binding*
is a workflow's reference to one device parameter at one applied configuration, with
its freshness (`fresh_seconds`). *Fresh* means the latest reading is younger than the
binding's freshness; after that the value is *stale*, which the runtime treats as
unknown. *Timer tick* is a runtime evaluation that happens because time passed, not
because telemetry arrived (Sustained and Time window already use them). *Wave 1* is
this specification's delivery; later waves need their own specifications.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Alert when a device stops reporting (Priority: P1)

An operator wants an alert when the water meter in the pump house has sent nothing for
15 minutes, and wants it to clear by itself when readings resume. They connect the
meter's parameter to a **No data** node set to 15 minutes and that to an Alert.

**Why this priority**: losing contact with a device is the most common alert in any IoT
deployment, and today it cannot be automated at all.

**Independent Test**: in the local stack, activate *meter parameter → No data (2 min) →
Alert*, stop the simulator for that device, and see an alert open about two minutes
after its last reading without any new telemetry; restart the simulator and see it
clear. A saved scenario that advances time 3 minutes after one reading expects one
alert request.

**Acceptance Scenarios**:

1. **Given** an active workflow with *No data (15 min)*, **When** the bound parameter
   has had no fresh reading for 15 minutes, **Then** the node becomes true on the next
   timer tick, without waiting for telemetry, and the alert opens.
2. **When** a fresh reading arrives afterwards, **Then** the node becomes false and the
   alert clears.
3. **Given** a workflow activated while the device is already silent, **Then** the
   silence is counted from activation, never from a reading older than the activation.
4. **Given** the runtime paused, restarted or fell behind the telemetry stream,
   **Then** no data is never declared for a period the runtime has not yet processed;
   a reading that arrived during the gap counts once it is processed.
5. **Given** the Execution tab, **Then** the trace says why: for example "No reading
   for 15 min 4 s; last reading 09:41:12" or "Fresh reading 12 s ago".
6. **Given** simulation or a saved scenario, **When** a clock step reaches or passes
   the deadline, **Then** No data changes at that step exactly as it would live at
   that time.

---

### User Story 2 - Act only during certain hours (Priority: P1)

An operator wants the door alarm to sound only outside working hours: 18:00–08:00 on
weekdays and all weekend, in the warehouse's local time. They add a **Schedule** node
and combine it with the door condition through Boolean logic (AND).

**Why this priority**: time-of-day gating is the second most common requirement after
missing data, and nothing in the catalogue knows the time.

**Independent Test**: build *door contact (boolean) → Boolean AND ← Schedule* in a saved
scenario that starts on a Monday; a door opening at 17:00 requests nothing, one at 19:00 sounds
the alarm, and one at 10:00 on Saturday sounds it.

**Acceptance Scenarios**:

1. **Given** a Schedule with one or more time ranges and weekdays, **Then** its output
   is true inside a range and false outside, evaluated in the node's time zone.
2. **Given** a range whose end is before its start (18:00–08:00), **Then** it runs past
   midnight and belongs to the weekday it starts on.
3. **When** the wall clock crosses a range boundary, **Then** the output changes on the
   next timer tick, even if no telemetry arrives.
4. **Given** a daylight-saving change, **Then** ranges follow local wall-clock time: a
   range that starts in a skipped hour starts at the first valid minute after it, and a
   repeated hour is counted once.
5. **Given** a new Schedule node, **Then** its time zone is pre-filled from the first
   bound device's reporting time zone (its site's today, its nearest entity's once spec
   009 lands, else the organization's, else UTC); the operator can choose any IANA time
   zone. The deployed workflow keeps the zone it was activated with; if the device's
   zone later differs, the editor says so.
6. **Given** the canvas, **Then** the node summary reads like "Weekdays 18:00–08:00,
   weekends all day · Europe/Berlin".

---

### User Story 3 - React to on/off and named states (Priority: P2)

An operator wants "when the RGB LED mode is `alarm` or `panic`" and "when the door
contact is open" as conditions, and wants to invert a condition without a Branch node.
They use **State match** for the first two and **Not** for the third.

**Why this priority**: many controllable devices report switches and modes rather than
numbers; without this they need workarounds or cannot be automated.

**Independent Test**: a saved scenario sends `mode = "alarm"`, then `"off"`, then
`"panic"` and expects State match (`alarm`, `panic`) to output true, false, true;
Not of that output gives false, true, false.

**Acceptance Scenarios**:

1. **Given** a boolean, string or enumerated parameter, **When** the operator picks
   *is* or *is one of* and the values, **Then** the output is true when the latest
   fresh value matches.
2. **Given** an enumerated parameter, **Then** the values are chosen from the
   parameter's allowed values in its applied profile, and a value the profile does not
   allow is rejected when the draft is validated.
3. **Given** a string parameter without allowed values, **Then** the operator types the
   values; matching is exact and case-sensitive.
4. **Given** an unknown or stale input, **Then** State match and Not output unknown,
   never false.
5. **Given** a numeric parameter, **Then** State match does not accept it; the editor
   points to Compare or Range.

---

### User Story 4 - Inside or outside a band in one node (Priority: P2)

An operator watching a vaccine fridge wants "temperature outside 2–8 °C" as one node.
They add **Range**, enter 2 and 8, and choose *outside*.

**Why this priority**: small, and it makes the most common two-sided threshold readable.

**Independent Test**: a saved scenario sends 1, 5 and 9 °C and expects outside to be
true, false, true; inside the opposite.

**Acceptance Scenarios**:

1. **Given** low and high bounds, **Then** *inside* is true when low ≤ value ≤ high and
   *outside* is true otherwise.
2. **Given** low ≥ high, **Then** validation rejects the node with a message on its
   bounds.
3. **Given** an unknown input, **Then** the output is unknown.

---

### User Story 5 - Detect fast changes (Priority: P3)

An operator wants an alert when a cold room warms by more than 3 °C within 10 minutes,
and another when a water meter's consumption exceeds 500 litres per hour. They use
**Rate of change** with a 10-minute period (output: change) or a 60-minute period
(output: change per hour), followed by Compare.

**Why this priority**: valuable for leaks, door-left-open and equipment failure, but it
builds on the other nodes and has more edge cases.

**Independent Test**: a saved scenario sends 4.0 °C at 0 s, 5.5 °C at 300 s and 7.5 °C
at 540 s; Rate of change (600 s, change) outputs 3.5 at 540 s and Compare (> 3)
requests one alert.

**Acceptance Scenarios**:

1. **Given** a period, **Then** the output is the latest fresh reading minus the
   earliest reading inside the period, or that difference divided by the time between
   them and expressed per second, minute or hour.
2. **Given** fewer than two readings inside the period, **Then** the output is unknown.
3. **Given** a reading older than the period, **Then** it no longer contributes on the
   next evaluation or timer tick.
4. **Given** a unit on the parameter, **Then** the output keeps the unit for a change,
   and for a rate the summary shows it per chosen time unit (for example `°C` and
   `L/h`).

---

### User Story 6 - The assistant and Help know the new nodes (Priority: P2)

An operator asks the automation assistant "alert me when GPS Demo Tracker stops
reporting for 10 minutes, but only at night". The proposal uses No data, Schedule and
Boolean AND, and the Help guide explains each node.

**Why this priority**: the assistant is how many operators build workflows; nodes it
cannot propose are effectively hidden.

**Independent Test**: with the assistant enabled, the prompt above yields a
compiler-validated proposal using the new node types; the existing assistant tests
still pass.

**Acceptance Scenarios**:

1. **Given** the assistant's schema tool, **Then** it lists the new node types with
   their fields and a one-line meaning.
2. **Given** a request that needs missing-data or time-of-day behaviour, **Then** the
   assistant uses No data or Schedule instead of saying it cannot be represented.
3. **Given** Help for automations, **Then** a guide describes each new node, its
   unknown behaviour and an example.

### Edge Cases

- **No data and freshness.** A binding's freshness says how long one reading counts;
  No data's period says how long silence must last. A period shorter than the
  binding's freshness is rejected, because the reading would still be fresh.
- **No data never starts true by accident.** After activation the node waits a full
  period before declaring silence; until then it is unknown, and unknown never opens or
  clears an alert. A restart or a stream pause cannot make it true early: the last
  reading time is kept, and timer ticks wait until the backlog has been processed.
- **Platform-side outage.** If the platform loses its broker connection, every device
  behind it goes quiet at once. No data then reports unknown for those devices instead
  of opening an alert for each; service monitoring reports the outage itself.
- **Several bindings.** No data watches one input. "Any of these three sensors is
  silent" is three No data nodes and Boolean OR.
- **A device sends other parameters but not this one.** That parameter is still silent;
  No data is per binding, not per device.
- **Schedule with no ranges or no weekdays** is rejected by validation. Overlapping
  ranges are merged. A range of 00:00–00:00 means the whole day.
- **Time zone removed or renamed** in the time zone database: the deployed zone keeps
  working under its canonical name; the editor shows the canonical name.
- **Schedule and devices.** A workflow still binds at least one device, as today, and
  Schedule is combined with a device condition. A clock-only trigger ("every weekday at
  08:00, send an event") is out of scope. Schedule is not a telemetry source, so
  combining it with one device's condition needs no Correlate node.
- **State match on booleans** offers *is true* or *is false*; Boolean inputs wired
  directly into Boolean logic keep working as today.
- **Range bounds use the parameter's unit.** Unit conversion still converts before
  Range when needed.
- **Rate of change across a counter reset** (a meter replaced or wrapped) gives a large
  negative change; wave 1 reports it as is, and the operator can guard with Range.
- **Simulation of Schedule** uses the scenario clock (2030-01-01 UTC, a Tuesday) in the
  node's time zone, so scenarios are deterministic.
- **Old runtime, new graph.** A draft that uses a new node type cannot be activated on a
  runtime that does not list it; the editor shows the node as unsupported, as it does
  for any unknown type today.

## Requirements *(mandatory)*

### Functional Requirements

#### Catalogue and editor

- **FR-001**: The node catalogue MUST list six new node types: **No data**,
  **Schedule**, **State match**, **Not**, **Range** and **Rate of change**. Each has
  a plain label, a group in the palette, its typed ports and its configuration fields.
  Existing node types MUST NOT change their identifiers, ports, fields or behaviour.
- **FR-002**: The editor MUST configure each new node with controls from the design
  system: a duration for No data and Rate of change, time ranges, weekday
  toggles and a searchable time zone selector for Schedule, the parameter's allowed
  values (or typed values) for State match, and low and high bounds for Range.
- **FR-003**: Each new node's canvas summary MUST state its configuration in words (for
  example "No reading for 15 min", "mode is alarm or panic", "outside 2–8 °C",
  "change over 10 min").
- **FR-004**: Draft validation MUST reject, with a message on the field: a No data
  period shorter than the binding's freshness or outside 60 s–7 days; a Schedule
  without ranges or weekdays, or with an invalid time or time zone; State match values
  the parameter's applied profile does not allow, or a State match on a numeric
  parameter; Range with low ≥ high; a Rate of change period outside 60 s–24 h.

#### Behaviour

- **FR-005**: **No data** MUST output true when its input has had no fresh reading for
  its period, false while a reading has been seen within the period, and unknown until
  a full period has passed since activation with no reading. It MUST change on a timer
  tick when its deadline passes, without telemetry, and MUST NOT declare silence for
  telemetry the runtime has not yet processed.
- **FR-005a**: While the platform has lost its connection to the broker that a device
  reports through, No data for that device MUST be unknown, not true, and its silence
  period MUST restart when the connection returns, so a platform-side outage does not
  open an alert for every device.
- **FR-006**: **Schedule** MUST output true inside any of its ranges on the selected
  weekdays in its configured IANA time zone, and false otherwise. It MUST change on
  the timer tick after each boundary. Ranges that end before they start run past
  midnight. Daylight-saving changes follow wall-clock time.
- **FR-007**: **State match** MUST accept boolean and string inputs and output true when
  the latest fresh value equals any configured value, false when it does not, and
  unknown when the input is unknown or stale.
- **FR-008**: **Not** MUST output the negation of a known boolean input and unknown for
  an unknown one.
- **FR-009**: **Range** MUST output, for a known number, whether it is inside or outside
  inclusive bounds, and unknown for an unknown input.
- **FR-010**: **Rate of change** MUST output the difference between the latest fresh
  reading and the earliest reading within its period, or that difference per second,
  minute or hour; unknown with fewer than two readings in the period. It MUST share
  the buffered-sample limits of Time window.
- **FR-011**: Every new node MUST explain its result in the execution trace and in
  simulation (true, false or unknown, with the reason), using the same statuses as
  existing nodes, and the automation assistant's execution explanations MUST be able to
  cite those steps.
- **FR-012**: The deployed definition MUST contain everything a node needs to evaluate,
  including Schedule's time zone, so a later change to a site, an organization or a
  device profile does not change a running deployment (Constitution II).

#### Testing, assistant and documentation

- **FR-013**: Simulation and saved scenarios MUST evaluate the new nodes on the
  scenario clock, including timer ticks for No data, Schedule and Rate of change.
- **FR-014**: The automation assistant's schema and prompt MUST describe the new node
  types, and its proposals using them MUST pass the same compiler validation and
  review as today. The assistant stays a proposer only (Constitution V).
- **FR-015**: The workflow contract (`contracts/rules/v2`) MUST describe the new node
  types, with fixtures, and every consumer's tests MUST cover them (Constitution IV).
- **FR-016**: `docs/features/automation.md` and the automation Help guide MUST describe
  each new node, including its unknown behaviour, in the same pull request as the node.

#### Boundaries

- **FR-017**: No new permission, endpoint or tenant data path is introduced: the new
  nodes are authored, validated, simulated, activated and explained through the
  existing workflow endpoints and permissions, and evaluate only their own
  organization's bound telemetry.
- **FR-018**: Workflows that do not use the new node types MUST compile to the same
  definition and behave exactly as before.

### Out of scope for wave 1

Each needs its own specification:

- **Transition counts and change detection** ("the door opened 5 times in an hour",
  "when the mode changes"). Needs per-transition state and its own window semantics.
- **Notify action** (send to a chosen notification channel and recipients). Alerts
  already reach notifications through the alert episode; a per-workflow channel
  depends on spec 011 (notification channels), which is not merged.
- **Fleet scope** ("any or all devices in a group or under an asset", beyond 32
  bindings). Depends on spec 009 (entity hierarchy) and on dynamic bindings, which
  automation deliberately does not have today.
- **Delays and sequences** ("turn off after 3 seconds", "then"). Actions fire on a
  transition to true; timed command sequences belong with device commands.
- **Device presence source.** Sparkplug birth and death already mark a device online
  or offline within seconds; a node that reads presence would catch a dead gateway
  sooner than No data, but presence is not telemetry and needs its own semantics.
- **Clock-only triggers** (a workflow with no device). Today every workflow binds at
  least one device.
- **More unit conversions** (%, V, A, kW, kWh, L, m³, km/h). A small separate change.

### Key Entities

- **Node type** (catalogue entry): identifier, label, palette group, input and output
  ports with types, configuration fields with types, bounds and choices.
- **No data state** (per node, per execution): time of the last fresh reading, the
  deadline at which silence is declared, and whether the runtime has processed the
  full period.
- **Schedule configuration**: time ranges (start and end, minute precision), weekdays,
  IANA time zone.
- **Rate of change buffer** (per node, per execution): the readings inside the period,
  bounded like Time window's samples.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In the local stack, a workflow *parameter → No data (2 min) → Alert* opens
  an alert in the Alerts inbox within 10 seconds of the two minutes of silence ending,
  with no telemetry from that device in between, and clears it within 10 seconds of the
  next reading.
- **SC-002**: During a 30-minute runtime pause followed by recovery, no workflow
  declares no data for the paused period unless its device was also silent before and
  after it.
- **SC-003**: Saved scenarios show a Schedule's output changing at each boundary across
  midnight, a weekend and both daylight-saving transitions of a zone that observes them,
  and live, the output changes within 10 seconds of a boundary.
- **SC-004**: Each of user stories 1–5 can be built in the editor, passes a saved
  scenario, and can be proposed by the automation assistant from a plain-language
  request.
- **SC-005**: Existing workflow, simulation, scenario and assistant tests pass
  unchanged, and the reference workflow fixture compiles to the same definition.

## Assumptions

- No data is per binding: one node watches one parameter of one device. Devices that
  report all parameters together make that the same as device silence.
- Schedule's time zone is stored on the node and pre-filled from the first bound
  device's site, then the organization, then UTC. Storing it keeps deployments
  immutable when a site changes (Constitution II). A per-workflow zone was considered
  and rejected: workflows can bind devices from several sites.
- Schedule has minute precision and up to eight ranges. Public holidays are out of
  scope.
- State match compares exact values. Enumerated parameters offer their allowed
  values; free-text string parameters accept typed values.
- Not is its own one-input node rather than a third Boolean logic operator, because
  Boolean logic always takes two inputs.
- Range is its own node rather than new Compare operators, so Compare keeps its
  single-value configuration and its existing workflows untouched.
- Timer-driven nodes use the runtime's existing timer ticks and the same cutoff that
  stops Time window from closing early while the consumer is behind.
- The runtime and Laravel deploy together on the single-node release, so a new node
  type is available to the editor and the runtime at the same time.
- Alerts from these workflows open in the Alerts inbox and emit integration events as
  today. Choosing email recipients for a DAG workflow in Settings → Notifications
  depends on spec 011 (it lists DAG workflows there) or the v1 retirement on the
  roadmap; this feature does not change notifications.
