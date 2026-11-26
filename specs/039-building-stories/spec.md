# Feature Specification: Building Networks and Stories

**Feature Branch**: `spec/038-building-plan`

**Created**: 2026-11-25

**Status**: Draft

**Input**: Owner request: "Build the structure of the building using a storytelling
approach, so we have what we want created in the digital twin as well. The twin could
have water network monitoring: a leak between one network node and the next is found
by a calculation over the meters at each end. It would be great to simulate scenarios:
fire, flooding, devices going offline." And, earlier the same day: "Does this include
water lines and power lines throughout the building?"

## Context

[Spec 038](../038-opc-ua-connector/spec.md) plans a simulated building, Example Tower,
so the OPC UA connector has something to connect to. Its
[building plan](../038-opc-ua-connector/building.md) lists the equipment on every
level. Two things are missing from it, and they are bigger than the connector needs:

1. **What joins the equipment.** The plan has a tank and a tap, a transformer and a
   desk, and nothing between them. Without pipes, ducts and cables there is nothing to
   draw as infrastructure and no way to find a fault that lies between two points.
2. **What happens to the building.** Spec 038 has fault switches (a chiller trips, a
   controller goes offline). A switch is one event. A flood or a fire is a sequence,
   with causes and consequences, and it should play the same way every time.

This spec adds both to the same simulator. It is kept apart from spec 038 so the
connector's plan stays the size it was (decided 2026-11-25).

### Decisions already taken

- **One simulator.** The networks and stories extend the simulator and the building
  model file of spec 038. They are not a separate program.
- **No side channel.** The platform and a twin see a story only through the building's
  ordinary readings.
- **What a BMS would see, and no more.** A fire is alarms, temperatures and the
  building's own safety logic; a flood is a pit level. The simulator does not model
  how fire, smoke or water spread.
- **Detection belongs to the platform.** The simulator keeps each network in balance
  and places the meters. Working out that a section is leaking is a rule in the
  platform, shown by a twin.
- **Stories are the shared specification.** Each one says what the simulator, the
  platform and a twin must do. What one of them cannot do yet is recorded as a gap,
  for its own later spec.

### Terms

- **Network**: one service's path through the building (cold water, power), as nodes
  joined by segments.
- **Section**: the part of a riser between two riser meters.
- **Story**: a named, timed sequence of events played on the building.
- **Event**: one thing that happens in a story (a leak opens, a pump fails).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The building has its networks (Priority: P1)

A developer starts the simulator and finds, beside the equipment, the pipes, ducts and
cables that join it, with meters and valves on them, as planned in
[networks.md](networks.md).

**Why this priority**: every infrastructure story needs it, and a 3D model of the
building cannot show infrastructure without it.

**Independent Test**: export the building model and find eight networks, each a
connected path from its source to every piece of equipment it serves. Run a simulated
day and check that every network stays in balance.

**Acceptance Scenarios**:

1. **Given** the building model, **Then** it holds eight networks (cold water, hot
   water, fire water, chilled water, condenser water, heating water, air and power),
   each as nodes and segments with a service, a size and a route in metres, and four
   shafts with their positions.
2. **Given** any equipment that uses a service, **Then** following its network from the
   source reaches it, and the model's tests fail if a piece of equipment is left
   unconnected.
3. **Given** the whole tower, **Then** the networks add 303 points on 84 pieces of
   equipment (branch valves and meters, riser meters, sprinkler floor valves,
   distribution boards), 40 of them commands, as listed in networks.md.
4. **Given** a simulated day with no story playing, **Then** for every water riser
   section, the flow in equals the flow out of its top and its branches within the
   meters' error; and every feeder's power equals the sum of its boards within 1%.
5. **Given** a branch's isolation valve is closed by a command, **Then** its flow falls
   to zero, the pressure beyond it falls, and the flow at every riser meter below it
   falls by the same amount.
6. **Given** a distribution board's breaker opens, **Then** its sub-meter reads no
   power and the equipment it feeds stops, with its points turning bad.

---

### User Story 2 - Play a story (Priority: P1)

A developer, or someone giving a demonstration, picks a story and plays it. The
building goes through it at the chosen speed, the same way every time.

**Why this priority**: it turns the building from a source of readings into something
that can be tested and shown.

**Independent Test**: play "A leak in the cold water riser" twice with the same seed
and get the same readings at the same simulated times. Stop it, and the building
returns to normal.

**Acceptance Scenarios**:

1. **Given** the simulator, **Then** it lists the eight stories of
   [stories.md](stories.md) with their titles, settings and lengths.
2. **Given** a story is started, **Then** the building is first put in the story's
   setting (season, day, time), and its events then happen at their simulated times.
3. **Given** the same story, seed and size, **Then** two runs produce the same readings.
4. **Given** a story is playing, **Then** it can be paused, run faster, and stopped; and
   the person playing it can see which event is next. Stopping clears every event and
   the building recovers by its own physics.
5. **Given** a story names an operator's action ("the booster pumps are switched off"),
   **Then** the story can play that action itself, or wait for it to be done from
   outside, as chosen when it starts.
6. **Given** each story, **Then** it carries its own checks on the building's readings
   (for the leak: the section's imbalance is 0.1 litres a second within five minutes of
   the first event), and those checks pass.
7. **Given** a story needs a size or the networks, **Then** starting it without them is
   refused with that reason.
8. **Given** a new story is wanted, **Then** it is added as one file, with no change to
   the simulator, using the events that exist.

---

### User Story 3 - The events the stories need (Priority: P1)

The simulator can make each thing in the stories happen, and each has the consequences
a building would show.

**Why this priority**: a story is only as true as its events.

**Independent Test**: for each event, start it on a quiet building and see its direct
effect and its consequences in the readings.

**Acceptance Scenarios**:

1. **Given** a leak event on a water segment with a rate, **Then** that much water
   leaves the network there: the meters either side disagree by the rate, pressure
   falls beyond it for a large leak, the tank falls faster, and a leak detector on the
   level below turns on after a delay.
2. **Given** a storm event, **Then** the weather station reports it, the rainwater tank
   fills, and the sump pit takes water at a rate that follows the rain.
3. **Given** a fire event in a zone, **Then** the zone's temperature rises, the level's
   fire alarm turns on, and the building's safety logic acts by itself: that level's
   air handling unit stops, the stair fans start, the lifts return to Ground in fire
   mode, a sprinkler flow switch turns on and the fire pump starts.
4. **Given** a mains failure, **Then** the generator starts, the transfer switch moves,
   essential boards keep power and non-essential boards lose it until the mains return.
5. **Given** an equipment failure event (fails to start, trips, loses capacity), **Then**
   the equipment reports it and whatever depended on it shows the loss.
6. **Given** a network failure event for a level, **Then** every point of that level's
   controllers turns bad with a "no communication" status at the same moment, while the
   level itself keeps running.
7. **Given** a sensor drift event, **Then** the sensor's value moves away from the truth
   at the given rate while its status stays good, and its controller acts on the wrong
   value.
8. **Given** an override event, **Then** a command point is set as a person at a panel
   would set it, and stays until released.

---

### User Story 4 - The stories say what the platform and a twin must do (Priority: P2)

A person planning the platform or a digital twin reads the stories and knows what each
must detect and show, and which of those it cannot do today.

**Why this priority**: it is why the stories are written as stories. It can follow the
simulator work.

**Independent Test**: for each story, there is a checked list of what the platform
detects today, with evidence from a run, and a list of gaps with the spec that would
close each.

**Acceptance Scenarios**:

1. **Given** each story, **Then** every line under "The platform should" is marked as
   works today (with the rule or screen that does it), partly, or not yet.
2. **Given** a line marked "not yet", **Then** it names what is missing in a sentence
   and is listed in the roadmap or an existing spec.
3. **Given** the cold water riser leak, **Then** the write-up shows the calculation over
   the section's meters, the threshold, and what was detected and when in a run.
4. **Given** each story, **Then** the lines under "A twin should show" are listed with
   the keys a twin needs from the building model (segments, zones, levels), with no
   requirement placed on any one twin product.

---

### Edge Cases

- Two stories are started together: the second is refused while one is playing.
- A story is started while a spec 038 fault switch is on: the switch stays on, and the
  story's start says so.
- A leak is larger than the pumps can supply: pressure falls to zero above it and the
  flows stop rising; the simulator does not produce impossible figures.
- A valve is closed below a leak: the leak stops and the balance returns.
- The clock runs very fast (a day in a minute): events still happen in order and the
  checks still pass.
- A story file names an event, a target or a point that does not exist: it is refused
  when loaded, naming the line.
- The `standard` size has only two office levels: a story that needs Level 6 is refused
  there, and the leak story has a `standard` version on the levels that exist.
- A reading is bad during a story (a level offline): balances that depend on it are not
  computed from its last value by the simulator's own checks.

## Requirements *(mandatory)*

### Functional Requirements

**Networks**

- **FR-001**: The building model MUST hold the eight networks and four shafts of
  networks.md as nodes and segments with a service, a size and a route, each with a
  stable key.
- **FR-002**: Every piece of equipment that uses a service MUST be connected to its
  network, and the model's tests MUST fail if one is not.
- **FR-003**: The simulator MUST add the meters, valves, switches and distribution
  boards of networks.md, with the points and commands listed there.
- **FR-004**: The simulator MUST keep every network in balance when no event is
  acting: flows in a water section, and power on a feeder, within the stated error.
- **FR-005**: Closing a valve or opening a breaker MUST change everything downstream
  of it and every meter upstream of it consistently.

**Stories**

- **FR-010**: The simulator MUST play a story from a file: a setting, then events at
  simulated times.
- **FR-011**: The same story, seed and size MUST produce the same readings.
- **FR-012**: A playing story MUST be able to be paused, sped up and stopped, and MUST
  report its next event. Only one story plays at a time.
- **FR-013**: A story MUST carry checks on the building's readings, and the simulator's
  tests MUST run every story and its checks.
- **FR-014**: A story MUST be able to play an operator's action itself or wait for it.
- **FR-015**: Story files MUST be checked when loaded, and a mistake MUST be reported
  with its place in the file.
- **FR-016**: The eight stories of stories.md MUST be provided.
- **FR-017**: The platform and any twin MUST receive nothing about a story except the
  building's readings.

**Events**

- **FR-020**: The simulator MUST provide these events: leak, storm, fire, mains
  failure, equipment failure (fails to start, trips, loses capacity), network failure
  for a level, sensor drift, and override.
- **FR-021**: Each event MUST produce its consequences through the building's physics
  and its own control and safety logic, as in user story 3.
- **FR-022**: The simulator MUST NOT model the spread of fire, smoke or flood water.

**What the stories ask for**

- **FR-030**: Each story MUST be run against the platform, and each line under "The
  platform should" MUST be recorded as works, partly or not yet, with evidence.
- **FR-031**: Each gap MUST be recorded where later work will find it.
- **FR-032**: The building model's export MUST give a twin what the stories' "A twin
  should show" lines need: segment, zone and level keys with positions.

### Key Entities

- **Network**: a service, its nodes and its segments.
- **Node**: a source, a piece of equipment, a junction or a riser node on a level.
- **Segment**: two nodes, a size and a route; may carry a meter or a valve.
- **Story**: a title, a setting, a list of timed events, operator actions and checks.
- **Event**: a kind, a target (a segment, a zone, a piece of equipment, a level) and
  its values (a rate, a duration).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With no story playing, every water riser section balances within the
  larger of 2% and 0.05 litres a second, and every feeder within 1%, for a whole
  simulated day.
- **SC-002**: Every one of the eight stories plays to its end and passes its own
  checks, at normal speed and at 60 times normal speed.
- **SC-003**: Two runs of any story with the same seed give the same readings.
- **SC-004**: In the riser leak story, the leak of 0.1 litres a second can be found
  from the meters alone within 15 simulated minutes, and placed in the right section.
- **SC-005**: A person can start a story and see the building react within one minute
  of deciding to, without reading documentation.
- **SC-006**: A new story is added by writing one file.
- **SC-007**: For every story there is a written result against the platform: what it
  detected, how soon, and each gap.
- **SC-008**: The simulator's tests from spec 038 pass unchanged with the networks
  added and no story playing.

## Assumptions

- **Spec 038's simulator exists first.** This spec builds on its pull requests 1a and
  1b: the model file, the physics interface, the control loops and the fault switches.
  It does not wait for the connector.
- **Sizes change.** The networks add points to every size. The totals in the building
  plan and the simulator contract are updated when this is built, and the connector's
  checks that count devices use the building model's export, not fixed numbers.
- **Writing from the platform is a later spec.** Until it exists, the automations that
  end stories 2, 5, 6 and 8 are played by the story file as the operator's action.
- **Rules over several devices.** Finding a leak needs a calculation across meters on
  different devices. Whether the platform's rules can do that today is not assumed; it
  is the first thing user story 4 checks.
- **A twin is outside this repository.** This spec says what a twin needs from the
  building model. It places no requirement on a particular twin product.
- **Typical sizes.** Pipe, duct and cable sizes are for drawing. Pressures and flows
  are plausible, not the result of an engineering calculation.
- **Not a training or safety tool.** The stories are for building and showing software.
  Nothing here is a model of how a real building behaves in a fire or flood.
