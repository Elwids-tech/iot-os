# Example Tower: the networks

[The building plan](../038-opc-ua-connector/building.md) lists the equipment on each
level. This document adds what joins it: the pipes, ducts and cables, where they run,
and the meters and valves on them. It is written so that:

- the simulator can keep each network in balance (what goes in comes out, unless a
  story opens a leak or trips a breaker);
- a fault between two points can be found by comparing the meters at those points;
- a 3D model can draw each network as a layer.

Positions use the building plan's axes: metres from the south-west corner at ground
level, x east, y north, z up.

## Shafts

Four vertical shafts in the core carry everything between levels.

| Shaft | Key | Centre (x, y) | Carries | Runs |
| --- | --- | --- | --- | --- |
| Water | `RS-W` | 31.5, 19.5 | Cold water, hot water and its return, fire water | B2 to L10 |
| Pipes | `RS-M` | 16.5, 19.5 | Chilled water and heating water, supply and return; condenser water | G to RF |
| Air | `RS-A` | 16.5, 10.5 | Outdoor air down to each floor's plant room; toilet exhaust up | G to RF |
| Power | `RS-E` | 31.5, 10.5 | The rising busbar and data cables | B2 to RF |

Each shaft is 1.5 m square. On every level it has a **node** named
`<network>-<level>`, for example `DCW-L05`: the point where that level's branch leaves
the riser.

## How a network is written

A network is **nodes** joined by **segments**.

- A node is a source, a piece of equipment, a junction, or a riser node.
- A segment joins two nodes and has a service, a size and a route (a list of points it
  passes through). A riser segment joins two levels' nodes; a branch segment joins a
  riser node to equipment on that level.
- A **meter** sits on a segment or at a node. The meters are what make a fault findable.

The nodes, segments and routes go in the building model file, in a `networks` section.
This document fixes which networks exist, where their meters and valves are, and what
each adds to the point list.

## The eight networks

### 1. Cold water (`DCW`)

```text
street ─ main meter ─ tank ─ booster pumps ─ riser base ═══ riser ═══ top (L10)
                                             (B1)          │ │ │
                                                 a branch on every served level:
                                                 valve ─ meter ─ toilets, tenants, plant
```

- **Path**: the street main enters Basement 1 at the south wall, passes the main water
  meter into the tank, and the booster pumps push it up `RS-W`.
- **Branches**: twelve, one each for Ground, Levels 1 to 10 and the Roof (cooling tower
  make-up). Ground's branch feeds the two tenant meters.
- **Meters on the riser**: four, at the base (B1), Level 1, Level 5 and Level 9. They
  cut the riser into four **sections**: B1 to L01, L01 to L05, L05 to L09, and L09 to
  the top.
- **On every branch**: an isolation valve that can be closed by a command, a flow
  meter and a pressure sensor.

**Finding a leak.** Two checks, both from ordinary readings:

| Check | Calculation | Says |
| --- | --- | --- |
| Section balance | Flow into a section, less the flow out of its top, less the flow into its branches | Above the threshold for ten minutes: water is leaving the riser inside that section |
| Night flow | A branch's flow while its level is unoccupied | Above the threshold: a leak or a running tap beyond that branch's meter |

The threshold allows for meter error: the larger of 2% of the flow into the section and
0.05 litres a second. A burst also shows as a pressure drop at the branches above it.

### 2. Hot water (`DHW`)

The heater in Basement 1 feeds a supply pipe and a return pipe in `RS-W`, a loop that
keeps hot water near every tap. Branches to Ground, Level 1's kitchen and the toilets on
Levels 2 to 9. One new point: the temperature at the top of the loop, which falls first
when the loop pump or heater fails.

### 3. Fire water (`FW`)

The sprinkler tank and fire pumps in Basement 1 feed a riser in `RS-W`. Every level
below the roof has a floor valve with two read-only points: a flow switch (water is
moving, so a sprinkler has opened) and a tamper switch (someone has closed the valve).
One riser pressure. Nothing here can be commanded.

### 4. Chilled water (`CHW`)

```text
chillers ─ primary pumps ─ secondary pumps ═══ riser down RS-M ═══ Ground
 (L10)                                          │ │ │
                                    a branch on every level with a coil:
                                    meter ─ air handling unit (and Level 2's server room)
```

Supply and return pipes side by side. Ten branches (Ground and Levels 1 to 9), each
with a flow meter and supply and return temperatures, which together give the cooling
each level uses. The two outdoor air units on Level 10 connect at the plant.

### 5. Condenser water (`CW`)

A short loop: chillers on Level 10 to the cooling towers on the Roof and back, through
the three condenser pumps. Drawn, with no new points; the chillers and towers already
report its temperatures.

### 6. Heating water (`HW`)

Boilers on Level 10 feed supply and return pipes down `RS-M`. Ten branches (Ground and
Levels 1 to 9) to the air handling units' heating coils and the perimeter zone boxes'
reheat coils, each with a flow meter and supply and return temperatures.

### 7. Air (`OA`, `SA`, `EA`)

- **Outdoor air**: the two outdoor air units on Level 10 push air down `RS-A`. Each of
  the ten levels below has a branch into its plant room, with a damper and an airflow
  sensor.
- **Supply air**: on each level, a main duct leaves the air handling unit, rings the
  core, and branches to each zone box. Drawn; the zone boxes already report airflow.
- **Exhaust**: toilet exhaust rises in `RS-A` to the two roof fans. Drawn only.

### 8. Power (`EL`)

```text
street ─ 2 transformers ─ main switchboard ─┬─ six feeders (each already metered)
                │                           │
        generator ─ transfer switch         └═══ rising busbar in RS-E ═══ Roof
                                                 │ │ │
                                    distribution boards on every level
```

- **Boards**: 28 in all. Each office level has two (light and power; mechanical),
  matching its two sub-meters. Level 2's server room has one, fed through the
  uninterruptible supply. Level 1 has two, Ground has three (one and one for each
  shop), Basement 1 two, Basement 2 one, Level 10 two, the Roof one.
- **Each board** reports its main breaker (closed or open), a trip alarm and its
  temperature, and takes one command: shed its non-essential load.
- **Essential and non-essential**: the generator carries the essential boards only
  (lifts, fire pumps, the server room, emergency lighting, the control room). When the
  mains fail, the others read no power until the mains return.
- **Solar** joins at the Roof board; the **chargers** hang off Basement 1's car park
  board.

**Finding a fault.** A board whose sub-meter reads no power while its neighbours read
normally has tripped. A feeder that reads more than the sum of its boards has a loss
between them.

## What the networks add

New equipment types, added to the building plan's point library:

| Type | Key | Points | Commands | Count |
| --- | --- | --- | --- | --- |
| Water branch | `WBR` | 5: valve status, flow, volume (total), pressure, valve command | 1 | 12 |
| Water risers | `WRS` | 15: flow, volume and pressure at the four riser meters; cold riser top pressure; hot loop top temperature; fire riser pressure | 0 | 1 |
| Sprinkler floor valve | `SFV` | 2: flow switch, tamper switch | 0 | 13 |
| Chilled water branch | `CBR` | 4: flow, supply and return temperature, cooling energy (total) | 0 | 10 |
| Heating water branch | `HBR` | 3: flow, supply and return temperature | 0 | 10 |
| Outdoor air branch | `OBR` | 2: airflow, damper position | 0 | 10 |
| Distribution board | `DB` | 4: breaker status, trip alarm, temperature, shed command | 1 | 28 |

| | Points | Commands | Devices |
| --- | --- | --- | --- |
| The tower before the networks | 2,466 | 531 | 294 |
| Added by the networks | 303 | 40 | 84 |
| **The tower with its networks** | **2,769** | **571** | **378** |
| The `standard` size with its networks | 797 | 160 | 106 |

## Drawing the networks in 3D

- **One layer for each network**, so a viewer can show cold water alone, or power alone.
- **Shafts**: four boxes through the core at the centres above.
- **Risers**: a pipe, duct or busbar for each network inside its shaft, cut at each
  level's node so one section can be coloured by itself. A leak in the section from
  Level 5 to Level 9 should be able to turn that length of pipe red.
- **Branches**: from the riser node to the equipment, at 0.4 m below the slab above for
  pipes and ducts, and on a cable tray at 0.3 m below it for power. Routes come from the
  model file.
- **A kit of parts**: straight pipe, bend, tee and valve in two sizes; rectangular duct
  and bend; cable tray; busbar; flow meter; distribution board. Object names use the
  segment keys, for example `DCW-L05-L09` for a riser section and `DCW-L05-BR` for a
  branch.

## Not modelled

Drainage and sewers, gas pipes (the boilers and kitchen report gas only as a valve
state and a leak alarm), compressed air, data networks, and pipe sizes chosen by a
hydraulic calculation. Sizes in the model file are typical, for drawing only.
