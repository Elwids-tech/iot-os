# The simulated building: Example Tower

This is the building the simulator runs, floor by floor: its zones, its equipment, and
every sensor, actuator and command. Three things are built from it and must agree:

- the **simulator** ([contracts/simulator.md](contracts/simulator.md)), which exposes
  it over OPC UA and runs its physics;
- a **3D model** of it (drawn by hand, for example in Blender, and exported as glTF),
  which a digital twin shows live readings on;
- the **entity hierarchy** an organization would build for it (spec 009), which the
  proposal of user story 7 is checked against.

So the building is written once, as a model file (see [The model file](#the-model-file)),
and nothing else keeps its own copy.

Example Tower is invented. Its layout follows a typical multi-tenant office tower and
its names follow the [Brick](https://brickschema.org/) vocabulary where Brick has a
term. It is not a copy of a real building.

## Contents

- [Shape and levels](#shape-and-levels)
- [Systems](#systems)
- [Floor by floor](#floor-by-floor)
- [Point library](#point-library)
- [Totals and sizes](#totals-and-sizes)
- [Controls](#controls)
- [How the building behaves](#how-the-building-behaves)
- [Names and keys](#names-and-keys)
- [The model file](#the-model-file)
- [Drawing it in 3D](#drawing-it-in-3d)
- [Not modelled](#not-modelled)

## Shape and levels

A rectangular tower, 48 m east to west and 30 m south to north, on a 6 m column grid
(8 bays by 5). Positions are in metres from the south-west corner at ground level:
**x** runs east, **y** runs north, **z** runs up.

A service core of 18 m by 12 m stands in the middle (x 15 to 33, y 9 to 21). It holds
four passenger lifts, one goods lift, two stairs, the toilets, the risers and, on
office floors, the floor's plant room.

| Level | Key | Floor at z (m) | Height (m) | Use |
| --- | --- | --- | --- | --- |
| Roof | `RF` | 48.0 | 1.2 parapet | Cooling towers, solar panels, weather station, fans |
| Level 10 | `L10` | 43.0 | 5.0 | Plant floor: chillers, boilers, pumps, outdoor air units |
| Levels 2 to 9 | `L02` to `L09` | 11.0 + 4.0 × (n − 2) | 4.0 | Offices, eight floors alike; Level 2 also holds the server room |
| Level 1 | `L01` | 6.0 | 5.0 | Conference centre, café and kitchen |
| Ground | `G` | 0.0 | 6.0 | Lobby, two shops, security room, loading dock |
| Basement 1 | `B1` | −3.6 | 3.6 | Switchroom, generator, water and fire rooms, car park with chargers |
| Basement 2 | `B2` | −7.2 | 3.6 | Car park, sumps, rainwater tank |

Fourteen levels: eleven storeys above ground, two basements and the roof.

## Systems

| System | What it is | Where |
| --- | --- | --- |
| Chilled water | 3 chillers (two duty, one standby), 3 primary pumps, 2 variable secondary pumps, 3 condenser pumps, 3 cooling towers, one plant controller | L10, towers on RF |
| Heating water | 2 boilers, 2 pumps, one plant controller | L10 |
| Outdoor air | 2 outdoor air units feed every floor's air handling unit through the risers | L10 |
| Floor air | One air handling unit a floor, serving that floor's zone boxes | Core plant room, G to L09 |
| Zones | One variable air volume box a zone; perimeter boxes have reheat | Every occupied floor |
| Server room cooling | 2 room cooling units (one is enough), an uninterruptible supply | L02 |
| Car park ventilation | Fans run from carbon monoxide readings | B1, B2 |
| Lighting | One lighting zone for each thermal zone, plus common areas and the façade | Every floor |
| Blinds | Motorised blinds on the four perimeter zones of each office floor | L02 to L09 |
| Electricity | Main incoming meter, 2 transformers, generator and transfer switch, feeder meters, floor sub-meters, tenant meters | B1 and every floor |
| Solar | 2 inverters | RF |
| Vehicle charging | 4 chargers | B1 |
| Water | Storage tank, 2 booster pumps, main and tenant meters, hot water heater, sump pumps, rainwater tank | B1, B2, G |
| Fire | Panel summary, a fire alarm per level, fire pumps, sprinkler tank. Read only | B1 |
| Lifts | 4 passenger, 1 goods. Read only | Core, all levels |
| Weather | One station | RF |

## Floor by floor

Each table lists the equipment on the level. The **type** column names an entry in the
[point library](#point-library), which lists that type's sensors, actuators and
commands. Rectangles are `x1–x2, y1–y2` in metres.

### Levels 2 to 9: offices

Eight floors alike. Seven zones a floor:

| Zone | Key | Rectangle | Kind | Box type |
| --- | --- | --- | --- | --- |
| North | `Z1` | 0–48, 24–30 | Perimeter, open office | Zone box with reheat |
| East | `Z2` | 42–48, 6–24 | Perimeter, meeting rooms | Zone box with reheat |
| South | `Z3` | 0–48, 0–6 | Perimeter, open office | Zone box with reheat |
| West | `Z4` | 0–6, 6–24 | Perimeter, private offices | Zone box with reheat |
| Interior west | `Z5` | 6–15, 6–24 | Interior, open office | Zone box, cooling only |
| Interior east | `Z6` | 33–42, 6–24 | Interior, open office | Zone box, cooling only |
| Core and lobby | `Z7` | 15–33, 6–24 | Lift lobby, corridor, toilets | Zone box, core |

| Equipment | Count | Type | Where |
| --- | --- | --- | --- |
| Air handling unit | 1 | Air handling unit | Core plant room (x 15–21, y 9–15) |
| Zone box | 7 | As the zone table | Ceiling, centre of each zone |
| Lighting zone | 7 | Lighting zone | One a zone |
| Blind group | 4 | Blind group | Façade of `Z1` to `Z4` |
| Sub-meter | 2 | Electricity sub-meter | Riser cupboard: light and power, mechanical |
| Floor sensors | 1 | Leak detector in the wet core, plant room temperature | Core |

Each zone has a wall sensor (temperature, carbon dioxide where the type has it) at
1.5 m above the floor and a ceiling occupancy sensor; they are points of the zone box.
188 points and 22 devices a floor.

**Level 2 also holds the server room** (x 33–42, y 15–24, taken from `Z6`, which on
this floor is x 33–42, y 6–15):

| Equipment | Count | Type |
| --- | --- | --- |
| Room cooling unit | 2 | Room cooling unit |
| Uninterruptible supply | 1 | Uninterruptible supply |
| Sub-meter | 1 | Electricity sub-meter |
| Room sensors | 1 | Temperature, humidity, leak detector |

51 more points, 5 more devices.

### Level 1: conference centre and café

| Zone | Key | Rectangle | Box type |
| --- | --- | --- | --- |
| Conference room A | `Z1` | 0–24, 24–30 | Zone box with reheat |
| Conference room B | `Z2` | 24–48, 24–30 | Zone box with reheat |
| Conference room C | `Z3` | 42–48, 6–24 | Zone box with reheat |
| Conference room D | `Z4` | 0–6, 6–24 | Zone box with reheat |
| Pre-function hall | `Z5` | 6–42, 6–24, around the core | Zone box, cooling only |
| Café | `Z6` | 0–30, 0–6 | Zone box, cooling only |
| Kitchen | `Z7` | 30–48, 0–6 | Exhaust only |

| Equipment | Count | Type |
| --- | --- | --- |
| Air handling unit | 2 | Air handling unit (one for conference, one for café and hall) |
| Zone box | 6 | As the zone table |
| Kitchen exhaust fan | 1 | Kitchen exhaust fan |
| Lighting zone | 7 | Lighting zone |
| Sub-meter | 2 | Electricity sub-meter: conference, café and kitchen |
| Floor sensors | 1 | Kitchen temperature, gas leak alarm |

197 points, 19 devices.

### Ground: lobby and shops

| Zone | Key | Rectangle | Served by |
| --- | --- | --- | --- |
| Main lobby | `Z1` | 12–36, 0–21, around the core | Zone box, cooling only |
| Security and control room | `Z2` | 36–48, 21–30 | Zone box, cooling only |
| Loading dock and back of house | `Z3` | 0–36, 21–30 | Zone box, cooling only |
| Shop A | `Z4` | 0–12, 0–21 | Fan coil unit |
| Shop B | `Z5` | 36–48, 0–21 | Fan coil unit |

| Equipment | Count | Type |
| --- | --- | --- |
| Air handling unit | 1 | Air handling unit |
| Zone box | 3 | Zone box, cooling only |
| Fan coil unit | 2 | Fan coil unit |
| Lighting zone | 5 | Lighting zone (one a zone) |
| Tenant electricity meter | 2 | Electricity sub-meter |
| Tenant water meter | 2 | Water meter |
| Floor sensors | 1 | Leak detector at the dock |

135 points, 16 devices.

### Basement 1: services and car park

Plant rooms on the west half (x 0–24), car park on the east half (x 24–48).

| Equipment | Count | Type | Room |
| --- | --- | --- | --- |
| Main electricity meter | 1 | Main electricity meter | Switchroom (0–12, 18–30) |
| Transformer | 2 | Transformer | Switchroom |
| Transfer switch | 1 | Transfer switch | Switchroom |
| Feeder meter | 6 | Electricity sub-meter: plant, lifts, car park and chargers, podium, tenants, common services | Switchroom |
| Generator | 1 | Generator | Generator room (12–24, 18–30) |
| Water tank | 1 | Tank | Water room (0–12, 0–12) |
| Booster pump | 2 | Pump | Water room |
| Main water meter | 1 | Water meter | Water room |
| Hot water heater | 1 | Hot water heater | Water room |
| Fire systems | 1 | Fire systems | Fire pump room (12–24, 0–12) |
| Car park ventilation | 1 | Car park ventilation with 4 carbon monoxide sensors | Car park |
| Car park fan | 2 | Car park fan | Car park |
| Lighting zone | 2 | Lighting zone | Car park, plant corridor |
| Vehicle charger | 4 | Vehicle charger | Car park, east wall |
| Room sensors | 1 | Temperature of switchroom, generator room, water room | |

201 points, 27 devices.

### Basement 2: car park

| Equipment | Count | Type |
| --- | --- | --- |
| Car park ventilation | 1 | Car park ventilation with 6 carbon monoxide sensors |
| Car park fan | 4 | Car park fan |
| Lighting zone | 3 | Lighting zone |
| Sump pump | 2 | Sump pump |
| Rainwater tank | 1 | Tank |
| Floor sensors | 1 | Leak detector at the lift pit |

71 points, 12 devices.

### Level 10: plant floor

| Equipment | Count | Type | Area |
| --- | --- | --- | --- |
| Chiller | 3 | Chiller | Chiller hall (0–30, 0–18) |
| Primary chilled water pump | 3 | Pump | Chiller hall |
| Secondary chilled water pump | 2 | Variable pump | Chiller hall |
| Condenser water pump | 3 | Pump | Chiller hall |
| Chilled water plant controller | 1 | Chilled water plant | Chiller hall |
| Boiler | 2 | Boiler | Boiler room (30–48, 0–18) |
| Heating water pump | 2 | Pump | Boiler room |
| Heating plant controller | 1 | Heating plant | Boiler room |
| Outdoor air unit | 2 | Outdoor air unit | North side (0–48, 21–30) |
| Sub-meter | 1 | Electricity sub-meter | |
| Lighting zone | 1 | Lighting zone | |
| Room sensors | 1 | Plant room temperature, refrigerant leak alarm | |

200 points, 22 devices.

### Roof

| Equipment | Count | Type |
| --- | --- | --- |
| Cooling tower | 3 | Cooling tower |
| Solar inverter | 2 | Solar inverter |
| Weather station | 1 | Weather station |
| Toilet exhaust fan | 2 | Exhaust fan |
| Stair pressurisation fan | 2 | Stair pressurisation fan |
| Façade lighting | 1 | Lighting zone |
| Room sensors | 1 | Lift machine room temperature |

67 points, 12 devices.

### Whole building

| Equipment | Count | Type |
| --- | --- | --- |
| Passenger lift | 4 | Lift |
| Goods lift | 1 | Lift |

40 points, 5 devices. The model file lists the lifts at the ground landing, as
`G-LIFT-1` to `G-LIFT-5`.

## Point library

Each type's points, by kind:

- **Sensor**: a measured value.
- **Actuator**: where a damper, valve or drive actually is.
- **Status** and **alarm**: on/off values and named states.
- **Total**: a counter that only rises.
- **Command**: a point that can be written. See [Controls](#controls).

| Type | Points | Sensors and actuators | Status, alarms and totals | Commands |
| --- | --- | --- | --- | --- |
| Air handling unit | 26 | Supply, return and mixed air temperature; return air carbon dioxide; duct static pressure; filter pressure drop; supply airflow. Supply and return fan speed; cooling and heating valve position; outdoor air damper position | Supply and return fan status; operating state. Supply fan fault, return fan fault, filter alarm, frost alarm. Run hours, fan energy | Mode (auto, off, on); supply air temperature setpoint; duct static pressure setpoint; minimum outdoor air; schedule override |
| Zone box with reheat | 14 | Zone temperature, carbon dioxide, occupancy, airflow, discharge air temperature. Damper position, reheat valve position | Effective setpoint; operating state. Communication alarm, zone temperature alarm | Temperature setpoint; occupancy override; minimum airflow |
| Zone box, cooling only | 12 | Zone temperature, carbon dioxide, occupancy, airflow. Damper position | As above | As above |
| Zone box, core | 10 | Zone temperature, occupancy, airflow. Damper position | As above | Temperature setpoint; occupancy override |
| Fan coil unit | 10 | Room temperature. Fan speed, valve position | Effective setpoint; fan status; operating state. Fault, condensate alarm | Temperature setpoint; mode |
| Room cooling unit | 14 | Return and supply air temperature, return humidity. Fan speed, cooling output | Status; operating state. Fault, high temperature alarm, leak alarm. Run hours | Enable; temperature setpoint; humidity setpoint |
| Outdoor air unit | 16 | Intake and supply air temperature, supply humidity, airflow, filter pressure drop. Fan speed, cooling and heating valve position | Fan status; operating state. Fault, filter alarm. Run hours | Mode; supply air temperature setpoint; airflow setpoint |
| Lighting zone | 6 | Light level reached, daylight level, power | On or off | Level; mode (auto, on, off) |
| Blind group | 3 | Position | | Position; mode (auto, manual) |
| Chiller | 16 | Chilled water supply and return temperature, condenser water entering and leaving temperature, load, power | Status; operating state; alarm code; effective setpoint. Fault. Run hours, starts | Enable; chilled water setpoint; demand limit |
| Chilled water plant | 12 | Plant load, flow, common supply and return temperature, building pressure difference | Chillers running; operating state. Cooling energy | Plant enable; chilled water setpoint; lead chiller; staging mode (auto, manual) |
| Pump | 6 | Pressure difference, power | Status. Fault. Run hours | Mode (auto, off, on) |
| Variable pump | 8 | As pump, with speed | As pump | Mode; pressure setpoint |
| Cooling tower | 8 | Basin temperature, leaving water temperature, power. Fan speed | Fan status. Vibration alarm, low basin level alarm | Mode |
| Boiler | 11 | Supply and return temperature, firing rate, flue gas temperature | Status; operating state; effective setpoint. Fault. Run hours | Enable; supply setpoint |
| Heating plant | 6 | Common supply and return temperature | Operating state. Heat energy | Plant enable; heating water setpoint |
| Hot water heater | 8 | Tank and return temperature | Effective setpoint; pump status. Fault, low temperature alarm. Energy | Setpoint |
| Car park ventilation | 3, plus 2 a sensor | Highest carbon monoxide; each sensor's reading | Operating state; each sensor's high alarm | Carbon monoxide setpoint |
| Car park fan | 6 | Power. Speed | Status. Fault. Run hours | Mode |
| Exhaust fan | 4 | | Status. Fault. Run hours | Mode |
| Kitchen exhaust fan | 5 | Speed | Status. Fault. Run hours | Mode |
| Stair pressurisation fan | 3 | Stair pressure | Status. Fault | None |
| Main electricity meter | 12 | Power, reactive power, three voltages, three currents, power factor, frequency | Energy imported, energy exported | None |
| Electricity sub-meter | 8 | Power, voltage, three currents, power factor, peak demand | Energy | None |
| Transformer | 5 | Load, winding temperature, power | Cooling fan status. Over-temperature alarm | None |
| Transfer switch | 3 | | Source (mains, generator); mains available. Fault | None |
| Generator | 14 | Fuel level, battery voltage, output power, voltage, frequency, engine temperature, oil pressure | Status; operating state. Fault, low fuel alarm. Run hours, energy | Test run request |
| Uninterruptible supply | 12 | Load, battery charge, battery run time, input and output voltage, output power, battery temperature | Operating state (online, on battery, bypass). On-battery alarm, low battery alarm, fault. Energy | None |
| Solar inverter | 8 | Output power, panel voltage, panel current, temperature | Operating state. Fault. Energy | Output limit |
| Vehicle charger | 6 | Power | Operating state. Energy, sessions | Enable; current limit |
| Water meter | 3 | Flow | Leak alarm. Volume | None |
| Tank | 3 | Level | Low and high level alarms | None |
| Sump pump | 5 | Pit level | Status. Fault, high level alarm. Run hours | None |
| Fire systems | 26 | Sprinkler tank level | System normal; fire alarm for each of the 14 levels; any fire alarm; panel fault; sprinkler flow; three fire pumps' status and fault; tank low alarm | None |
| Lift | 8 | Current level, load | Direction; door; mode (normal, independent, fire, out of service). Fault. Trips, run hours | None |
| Weather station | 6 | Outdoor temperature, humidity, wind speed, wind direction, sunlight, rain | | None |

Loose sensors on a level (leak detectors, room temperatures) are grouped into one
"floor sensors" or "room sensors" device for that level.

Every point has a display name, a description, a source time and a status. Analog
points have an engineering unit and a range; named states have their labels; a command
has the limits it accepts.

## Totals and sizes

| Level | Points | Of which commands | Devices |
| --- | --- | --- | --- |
| Levels 2 to 9 (8 × 188) | 1,504 | 376 | 176 |
| Level 2 server room | 51 | 6 | 5 |
| Level 1 | 197 | 43 | 19 |
| Ground | 135 | 28 | 16 |
| Basement 1 | 201 | 19 | 27 |
| Basement 2 | 71 | 11 | 12 |
| Level 10 | 200 | 39 | 22 |
| Roof | 67 | 9 | 12 |
| Lifts | 40 | 0 | 5 |
| **Whole tower** | **2,466** | **531** | **294** |

The simulator's `--size` option chooses how much of it runs:

| Size | What runs | Points | Devices |
| --- | --- | --- | --- |
| `standard` (default) | Levels 2 and 3, the plant floor, the roof, the main meter | 706 | 84 |
| `tower` | The whole building | 2,466 | 294 |
| `large` | The tower with 30 office floors | 6,602 | 778 |

`standard` keeps the local stack and the tests light, and still has 14 zones, a
complete plant and every point kind. `tower` is the one a 3D model is drawn for.

## Controls

The connector in this spec reads only. The simulator is still built with controls, so
that the later feature for writing has something real to work against and the building
does not have to be rebuilt.

**What can be written.** Only the points in the library's **Commands** column: 531 in
the whole tower. They are of three kinds:

| Kind | Examples | Accepts |
| --- | --- | --- |
| Setpoint | Zone temperature, supply air temperature, chilled water temperature, light level, charger current limit | A number inside the point's limits |
| Mode | Air handling unit mode, pump mode, lighting mode, staging mode | One of the named states |
| Request | Occupancy override, schedule override, generator test run, plant enable | One of the named states, or on/off |

**What cannot.** Sensors, actuator positions, statuses, alarms and totals. Fire
systems, lifts, the transfer switch and the uninterruptible supply have no commands at
all. A supervisory system asks for an outcome; the equipment's own controller moves the
damper or valve.

**Rules a write must pass.** The simulator enforces them the way a real server does:

- Sign-in: anonymous sessions read only. Writing needs the `operator` test sign-in.
- Limits: a value outside the point's limits is refused with an out-of-range status.
  A zone setpoint, for example, accepts 18 to 28 °C.
- Type: the wrong data type is refused.
- Hand mode: when equipment is switched to hand at its panel (a scenario), a write is
  accepted and has no effect, and the point's operating state says so.

**Local control stays in the building.** Each piece of equipment runs its own loop in
the simulator, as its controller would:

| Loop | What it does |
| --- | --- |
| Zone box | Moves its damper, then its reheat valve, to hold the effective setpoint; widens the setpoint when the zone is unoccupied; raises its minimum airflow when carbon dioxide is high |
| Air handling unit | Follows the floor schedule; holds supply air temperature with its valves and duct pressure with its fan; opens outdoor air with carbon dioxide; warms the floor up on recirculated air before occupied hours; raises supply air in cool weather when no zone wants cooling; keeps zones above their unoccupied heating setpoint at night; purges at night when outside is cool |
| Chilled water plant | Starts and stops chillers with load, rotates the lead, runs the towers and pumps they need |
| Heating plant | Starts boilers with load |
| Car park ventilation | Runs fans faster as carbon monoxide rises |
| Lighting zone | In auto: on with occupancy, dimmed against daylight |
| Blind group | In auto: lowers with direct sun on its façade |
| Generator and transfer switch | Start and take the load when the mains fail |

**Automations to try from the platform** once writing exists. Each one acts on
commands and can be seen in the readings, and so in a 3D model:

1. Night setback: widen zone setpoints and switch lighting off outside working hours.
2. After-hours request: one zone's occupancy override for two hours.
3. Demand limit: when the main meter passes a threshold, limit the chillers, raise zone
   setpoints by 1 °C and lower the charger current.
4. Ventilation on demand: raise a floor's minimum outdoor air when carbon dioxide is high.
5. Chilled water reset: raise the chilled water setpoint when every valve is below 70%.
6. Leak response: on a leak alarm, alert and switch the booster pumps off.
7. Solar and blinds: lower the blinds on a façade when sunlight is strong and the zone
   is warm.
8. Generator test: a weekly test run request, checked by the run hours rising.

## How the building behaves

The simulator runs simple physics of its own. The parts are joined, so a change in one
place shows up where an operator would expect:

- **Weather** follows a seeded daily curve for temperature, humidity, sunlight and
  wind, with a season option.
- **People** follow a weekday schedule for each zone kind, with seeded variation.
  Occupancy drives heat, carbon dioxide, lighting and lift trips.
- **A zone's temperature** moves with the outdoor temperature, sunlight on its façade
  (less with the blinds down), people, lights and equipment, the neighbouring zones,
  and the air its box delivers. Sunlight and half the internal gains warm the zone's
  structure first, which gives the heat back slowly. Perimeter zones whose box cannot
  heat have heating under the glazing, which has no points of its own.
- **An air handling unit's coil load** is the sum of what its boxes ask for, plus the
  outdoor air it brings in.
- **Chiller load** is the sum of the coil loads; chiller power follows load and the
  condenser water temperature, which follows the towers and the weather.
- **Electricity** adds up: each sub-meter is the sum of what it feeds, the main meter
  is the sum of the feeders less solar output, and totals only rise.
- **Water** follows occupancy; the boosters supply it from the tank, whose level falls
  with use and rises when the mains refill it through the main water meter.

The same seed gives the same day. The physics sits behind a small interface (step the
clock, read values, apply a command), so a detailed building physics engine can replace
it later without changing the server (see [research R19](research.md)).

## Names and keys

Every level, zone, equipment item and point has a short key. The keys never change, and
they are what the simulator, the 3D model and the expected hierarchy share.

| Thing | Pattern | Example |
| --- | --- | --- |
| Level | `B2`, `B1`, `G`, `L01` to `L10`, `RF` | `L03` |
| Zone | `<level>-Z<n>` | `L03-Z2` |
| Equipment | `<level>-<kind>-<n>` | `L03-VAV-2`, `L10-CH-1`, `RF-CT-3`, `B1-EVC-4` |
| Point | `<equipment>.<point>` | `L03-VAV-2.zone_temperature` |

Equipment kinds: `AHU`, `VAV`, `FCU`, `CRAC`, `OAU`, `LTG`, `BLD`, `CH`, `CHP` (plant
controller), `PCHWP`, `SCHWP`, `CWP`, `CT`, `BLR`, `HWP`, `HP` (heating plant), `DHW`,
`CPV`, `CPF`, `EF`, `KEF`, `SPF`, `MM`, `EM`, `TX`, `ATS`, `GEN`, `UPS`, `PV`, `EVC`,
`WM`, `TNK`, `SMP`, `FIRE`, `LIFT`, `WX`, `SEN`, and `BP` for the booster pumps.

The two naming styles of the simulator are two spellings of the same keys:

- **Structured**: Example Campus → Example Tower → Level 3 → East (`L03-Z2`) → Zone box
  `L03-VAV-2` → Zone temperature. Plant with no zone sits under its level.
- **Flat**: `ET_L03_VAV_2.ZN-T`, in one folder.

## The model file

`tooling/simulators/bms/buildings/example-tower.yaml`, written in pull request 1a. It
holds, and is the only place that holds:

- the levels (key, name, floor height, storey height);
- the zones (key, name, kind, outline as a list of corner points);
- the equipment (key, type, name, level, zone if any, what it feeds or is fed by,
  position `x, y, z` and facing in degrees, footprint `width, depth, height`);
- for a point that is measured somewhere other than its equipment, such as a wall
  sensor, the point's own position;
- the point library (each type's points: key, name, kind, data type, unit, range,
  states, command limits, Brick class where one exists);
- the sizes (which levels each `--size` includes).

A schema for the file sits beside it and the simulator's tests check the file against
it and against the totals in this document. The simulator can print the file as JSON
(`--export-model`) for other tools: a script that places equipment in a 3D scene, or
the check of the hierarchy proposal.

Equipment positions are given in the model file and are not repeated here. The rules
they follow: a zone box hangs at the centre of its zone, 0.6 m below the slab above; a
wall sensor is on the zone's inner wall at 1.5 m; floor-standing plant stands on its
level's floor inside the room named in the tables above, with 1.2 m clear around it.

## Drawing it in 3D

The model is drawn by hand outside this repository. What this plan fixes for it:

- **Units and axes.** Metres. Origin at the south-west corner of the building at ground
  floor level. In Blender, x east, y north, z up (the glTF exporter turns this into
  glTF's y-up).
- **Building shell.** One object for each level's slab, façade and core, named by the
  level key, so a viewer can show one storey at a time. Levels 2 to 9 are the same
  shell at different heights. Dimensions are in [Shape and levels](#shape-and-levels).
- **Zones.** No geometry is needed; a zone is its outline from the model file, drawn by
  the viewer on the level's floor.
- **Equipment kit.** One model for each equipment type that stands somewhere a person
  can see it, drawn once and placed many times from the model file's positions:

  | Model | Footprint w × d × h (m) | Placed |
  | --- | --- | --- |
  | Air handling unit | 4.0 × 2.0 × 2.2 | 11 |
  | Zone box | 1.2 × 0.8 × 0.4 | 65 |
  | Fan coil unit | 1.2 × 0.6 × 0.3 | 2 |
  | Room cooling unit | 1.0 × 0.9 × 2.0 | 2 |
  | Outdoor air unit | 6.0 × 2.4 × 2.6 | 2 |
  | Chiller | 5.0 × 2.0 × 2.4 | 3 |
  | Pump | 1.2 × 0.6 × 0.9 | 15 |
  | Cooling tower | 4.0 × 4.0 × 4.5 | 3 |
  | Boiler | 2.4 × 1.4 × 2.0 | 2 |
  | Hot water heater | 1.2 × 1.2 × 2.2 | 1 |
  | Fan (car park, exhaust, stair) | 1.2 × 1.2 × 1.2 | 11 |
  | Switchboard or meter cabinet | 0.8 × 0.4 × 2.0 | 30 |
  | Transformer | 2.2 × 1.6 × 2.2 | 2 |
  | Generator | 5.0 × 2.0 × 2.4 | 1 |
  | Uninterruptible supply | 1.2 × 0.9 × 2.0 | 1 |
  | Solar panel row and inverter | 12.0 × 2.0 × 1.2 | 2 |
  | Vehicle charger | 0.4 × 0.3 × 1.5 | 4 |
  | Tank | 4.0 × 4.0 × 3.0 | 3 |
  | Sump pump | 0.6 × 0.6 × 0.8 | 2 |
  | Lift car | 2.0 × 1.8 × 2.4 | 5 |
  | Weather mast | 0.3 × 0.3 × 3.0 | 1 |
  | Wall sensor | 0.1 × 0.03 × 0.1 | as needed |

  Lighting zones and blinds are parts of the shell (ceiling panels and façade blinds
  for each zone), named `<zone key>-LTG` and `<zone key>-BLD`.
- **Object names.** Use the keys: a level shell is `L03`, a placed chiller is
  `L10-CH-1`. A twin should still tie readings to its own stable identities and keep
  the key as the lookup, so a redrawn model does not break history.
- **What moves.** If the viewer can show it: lift cars (current level), blinds
  (position), fan and pump running state, damper position, light level. Each is a point
  in the library.
- **A viewer's own rules** for level of detail, connection ports, file size and
  textures belong to that viewer and are not set here.

## Not modelled

The pipes, ducts and cables that join the equipment, and scripted events such as a
leak, a flood or a fire, are planned in
[spec 039](../039-building-stories/spec.md) and add to this building when it is built.

Access control, cameras, public address, individual light fittings, plumbing fixtures,
room booking, and the inside of tenant fit-outs. The fire systems and lifts are status
only. The building has no field-level detail (no individual BACnet or Modbus
controllers); it is what a supervisory BMS server shows.
