# Example Tower: the stories

A story is something that happens to the building, told the same way each time: what
physically happens, what the sensors show, what the platform should notice, what a 3D
twin should show, and what a person or an automation does about it.

The stories do two jobs:

- **They are scripts.** The simulator plays each one from a file, so the same events
  happen at the same simulated times on every run.
- **They are the specification.** Each one says what the platform and a digital twin
  must be able to do with this building. Where one of them cannot do it yet, that is a
  gap to record, and the story does not hide it.

The platform and the twin learn about a story only through the building's ordinary
readings. There is no side channel that tells them what is being played.

## Contents

- [The tour](#the-tour)
- [How a story is told](#how-a-story-is-told)
- [1. An ordinary weekday](#1-an-ordinary-weekday)
- [2. A leak in the cold water riser](#2-a-leak-in-the-cold-water-riser)
- [3. The basement floods](#3-the-basement-floods)
- [4. A fire on Level 6](#4-a-fire-on-level-6)
- [5. The mains fail](#5-the-mains-fail)
- [6. A chiller trips on a hot afternoon](#6-a-chiller-trips-on-a-hot-afternoon)
- [7. Level 4 goes quiet](#7-level-4-goes-quiet)
- [8. A wasteful night](#8-a-wasteful-night)
- [What the stories ask for](#what-the-stories-ask-for)

## The tour

Four journeys through the building. Together they pass every system, and they are the
order in which a twin of the tower would be built and shown.

**A litre of water.** It arrives from the street main at the south wall of Basement 1
and is counted by the main meter. It waits in the storage tank until a booster pump
lifts it into the riser in the core. It passes the riser meter at the base, then the
one at Level 1, then the one at Level 5. On Level 7 it turns off into the floor's
branch, through an isolation valve and a branch meter, and reaches a tap in the wet
core. Every meter it passed counted it. If the meters ever disagree, it went somewhere
it should not have.

**A breath of air.** It is drawn in on Level 10 by an outdoor air unit, filtered, and
cooled or warmed. It falls down the air shaft to Level 3's plant room, where the
floor's air handling unit mixes it with air returning from the floor and cools it again
with chilled water. A duct carries it around the core to the east zone's box, whose
damper opens just enough to hold the meeting rooms at their setpoint. A sensor on the
wall measures how much carbon dioxide the people in the room have added to it.

**A kilowatt.** It comes in from the street, through a transformer in Basement 1 to the
main switchboard, where the main meter counts it. A feeder takes it to the rising
busbar in the core, and at Level 3 it leaves through the floor's light and power board,
past a sub-meter, to a row of desks in the north zone. On a sunny day some of it never
came from the street at all: it came down from the solar panels on the roof. If the
street fails, the generator in the next room takes over the boards that matter most.

**A person's day.** She parks in Basement 1 at ten to eight; the carbon monoxide rises a
little and the fans answer. She plugs the car in. A lift takes her from the basement to
Level 6. The floor has been cooling since seven, because the building started early on
a hot morning. Her zone's lights come on as she walks in and dim as the sun reaches the
façade; at eleven the blinds lower. At one she is in a conference room on Level 1 with
forty others, and the room's box opens wide. At six she leaves, the zone goes quiet,
and by eight the floor is dark and drifting warm.

## How a story is told

Each story has the same parts:

| Part | What it holds |
| --- | --- |
| **Setting** | The season, the day and time it starts, how long it runs, the size it needs |
| **Events** | A timeline: what happens to the building, and when |
| **The sensors show** | What can be read from the building as it unfolds |
| **The platform should** | What it should detect, and how soon |
| **A twin should show** | Where a person looking at the 3D model sees it |
| **Then** | What an operator or an automation does, and what the building does in answer |

Times are simulated, written as hours and minutes from the start of the story.

## 1. An ordinary weekday

**Setting**: summer, a Tuesday, midnight, 24 hours. Any size.

**Events**: none. The building is left alone with its own controls, its people and its
weather. This story is the baseline every other story departs from.

**The sensors show**
- 00:00 to 06:00: the building is dark and quiet. Zones drift to about 27 °C. One
  chiller runs lightly for the server room. Water flow is near zero.
- 06:30: the air handling units start early to pre-cool. A second chiller starts.
- 08:00 to 09:00: people arrive. Lifts are busy, carbon monoxide rises in the car park,
  zone carbon dioxide climbs, lights come on, water flow rises.
- 12:00 to 15:00: the afternoon peak. The south and west blinds lower. Solar output is
  highest and the main meter's power is at its highest too.
- 18:00 to 20:00: people leave; zones return to their unoccupied setpoints.

**The platform should**: show every device online and no alerts all day. This is the
test that the quiet periods at night do not look like devices going offline.

**A twin should show**: lights, blinds and lift cars following the day; the cooling
load moving with the sun from the east façade to the west.

**Then**: nothing. Totals at the end of the day are the figures the other stories are
compared with.

## 2. A leak in the cold water riser

**Setting**: summer, a Wednesday, 01:00, 8 hours. Needs the networks.

**Events**
- 00:20: a joint in the riser starts to weep between Level 5 and Level 9: 0.1 litres a
  second.
- 03:00: the joint opens: 1.5 litres a second.
- 03:10: water reaches the wet core on Level 5; its leak detector turns on.

**The sensors show**
- From 00:20, the riser meter at Level 5 reads 0.1 litres a second more than the meter
  at Level 9 and the four branches between them added together. It is night, so there
  is almost no other flow and the difference stands out.
- From 03:00, the difference is 1.5 litres a second, branch pressure falls on Levels 6
  to 10, the booster pumps run continuously, and the tank level starts to fall.

**The platform should**
- Raise a warning within 15 minutes of 00:20 that the riser section from Level 5 to
  Level 9 is out of balance, naming the section.
- Raise a critical alert within 2 minutes of 03:00.
- Not blame Levels 6 to 9: their branches are in balance.

**A twin should show**: the cold water layer with that length of riser coloured, the
imbalance as a figure on it, and Level 5's wet core marked when the detector turns on.

**Then**: an operator, or an automation, switches the booster pumps off. Pressure falls
to nothing above Level 1, the imbalance returns to zero and the tank stops falling. The
levels above the leak have no water, which the story also shows.

## 3. The basement floods

**Setting**: summer, a Saturday, 14:00, 4 hours. `tower` size.

**Events**
- 00:10: a heavy storm starts. The weather station reports rain and wind.
- 00:30: the rainwater tank is full.
- 00:40: sump pump 1 in Basement 2 fails to start.
- 01:20: sump pump 2 trips on overload.
- 02:30: the storm passes.

**The sensors show**
- The pit level rises as soon as the storm starts, levels off while pump 2 keeps up
  alone, then climbs steadily after 01:20.
- The pit's high level alarm at about 01:35; the lift pit leak detector at about 01:50.
- Both pumps report a fault. Neither has run hours rising.

**The platform should**
- Alert when pump 1 fails to start although the pit is rising: a pump that should be
  running and is not.
- Raise the alert to critical when both pumps are faulted.
- Estimate, from the rate of rise, how long until the high level.

**A twin should show**: Basement 2 with the water level drawn in the pit and then
across the floor, and both pumps marked as faulted.

**Then**: there is nothing to command; sump pumps and lifts are status only. The right
answer is a person on site. The story checks that the platform says so plainly and
early, and that the lifts report out of service once water reaches the pit.

## 4. A fire on Level 6

**Setting**: any season, a Thursday, 10:00, 1 hour. `tower` size.

The simulator shows what a BMS would see of a fire. It does not model how fire or smoke
spreads.

**Events**
- 00:05: a fire starts in Level 6's interior west zone.
- 00:06: Level 6's fire alarm turns on.
- 00:08: a sprinkler opens: Level 6's flow switch turns on and the fire pump starts.
- 00:25: the fire is out.

**The sensors show**
- The zone's temperature rises sharply, and its neighbours' rise slowly.
- On the alarm, the building's own safety logic acts with no command from anyone:
  Level 6's air handling unit stops, both stair pressurisation fans start, every lift
  reports fire mode and returns to Ground, and the toilet exhaust fans stop.
- The fire riser's pressure dips and recovers as the pump starts; the sprinkler tank
  level falls.
- Later, Level 5's leak detector turns on: sprinkler water coming down.

**The platform should**
- Show the fire alarm for Level 6 within seconds, as the most severe alert.
- Not raise a second wave of alerts for the consequences. A stopped air handling unit,
  lifts out of normal service and a running fire pump are expected during a fire alarm,
  and should read as part of it.

**A twin should show**: Level 6 marked, the zone where the temperature is rising, the
stairs pressurised, the lift cars at Ground.

**Then**: nothing can be commanded on the fire systems, and nothing should be. After
the fire is out, the alarm is reset at the panel (an event in the story) and the
building restarts itself.

## 5. The mains fail

**Setting**: summer, a Monday, 15:00, 2 hours. `tower` size, with the networks.

**Events**
- 00:10: the street supply fails.
- 00:10 to 00:11: the generator starts; the transfer switch moves to it.
- 01:10: the street supply returns; five minutes later the switch moves back.

**The sensors show**
- The main meter reads no power. The server room's supply reports "on battery" for
  about 40 seconds, then "online" again.
- The generator's output rises, its fuel level starts to fall.
- Essential boards keep their power. Non-essential boards read none: office lights and
  desks, the chillers, the chargers. Their equipment's readings turn bad, not zero.
- Without the chillers, every zone starts to warm; the server room holds, on its own
  cooling units and an essential board.

**The platform should**
- Raise one alert for the outage, not several hundred for the devices behind it.
- Show the non-essential devices as unknown, never as healthy with a value of zero.
- Track the generator: load, fuel, and the hours of fuel left at this load.
- Clear by itself when the mains return, and show that devices came back.

**A twin should show**: the power layer with the dead feeders and boards dimmed and the
generator's path lit; the building warming floor by floor.

**Then**: an automation sheds load on the essential boards that can spare it, and the
generator's output falls. When power returns the chillers restart one at a time, which
the story also checks, because starting all three together would trip the supply.

## 6. A chiller trips on a hot afternoon

**Setting**: summer, a Friday, 13:00, 5 hours. Any size.

**Events**
- 00:30: chiller 1 trips on a fault, at the hottest part of the day.
- 00:35: the plant starts the standby chiller.
- 01:30: chiller 2 loses a third of its capacity (a fouled condenser).

**The sensors show**
- The chilled water supply temperature jumps, recovers when the standby starts, then
  creeps up after 01:30 as the two running chillers fall short.
- Air handling units open their cooling valves fully. West-facing zones go over their
  setpoints first, then the south, then the interior.
- Chiller 2 uses more power for less cooling.

**The platform should**
- Alert on the trip, and show that the standby took over.
- Notice the slower problem: chiller 2's efficiency has fallen against its own history.
- Count the zones that are too warm, and for how long.

**A twin should show**: the tripped chiller, the chilled water layer warming, and the
warm zones spreading across the west façade.

**Then**: a demand automation raises zone setpoints by 1 °C, lowers the west and south
blinds and limits the chargers. The plant catches up and the count of warm zones falls.

## 7. Level 4 goes quiet

**Setting**: any season, a Tuesday, 11:00, 2 hours. `tower` size.

**Events**
- 00:15: the network switch for Level 4's controllers fails. The BMS server loses every
  controller on that level.
- 00:50: one zone's temperature sensor on Level 7 starts to drift, half a degree every
  ten minutes.
- 01:15: Level 4's switch is replaced.

**The sensors show**
- Every point on Level 4 turns bad with a "no communication" status, all at the same
  moment. The server keeps their last values; they are not zero and not good.
- The floor itself carries on: its controllers still run it. Level 4's sub-meters, on a
  different network, still report.
- On Level 7 the drifting sensor reads warmer and warmer. The zone's box opens to cool
  a room that is not warm; its neighbours cool down; its airflow is high for no reason.

**The platform should**
- Show Level 4's devices as not reporting, grouped as one event on one level.
- Never show a last value from Level 4 as current.
- Flag Level 7's sensor as suspect: it disagrees with its neighbours and with its own
  box's behaviour.
- Show Level 4 recover, with a gap in its history and no invented values.

**A twin should show**: Level 4 greyed out as a whole floor, which reads at a glance as
"we cannot see this floor", not "this floor is in trouble".

**Then**: for the drifting sensor, an operator sets the box to a fixed airflow until it
is replaced.

## 8. A wasteful night

**Setting**: summer, a Friday, 17:00, 14 hours. Any size.

**Events**
- 01:00: someone sets Level 3's schedule override to "occupied" and leaves.
- 01:30: the north zone's lighting is switched to "on" by hand.
- 03:00: Level 2's occupancy override is left on in two zones.

**The sensors show**: nothing is broken and no alarm turns on. Level 3's air handling
unit runs all night in an empty building, a chiller runs for it, and the lights stay
on. The floor's sub-meters read four times what Level 5's read.

**The platform should**
- Notice without any alarm: a level using energy while it has no people.
- Say what it cost, compared with the same night in story 1.

**A twin should show**: one lit, cooled floor in a dark tower.

**Then**: a night automation releases every override at 22:00 and switches the lighting
back to auto. Run the story again with it in place, and the night matches story 1.

## What the stories ask for

Each story needs something from the three products. This table is the starting list;
the plan checks each cell against what exists today and records the gaps.

| Story | The simulator needs | The platform needs | A twin needs |
| --- | --- | --- | --- |
| 1 Weekday | The building and its controls (spec 038) | Devices that stay online through quiet hours | Lights, blinds, lifts that follow readings |
| 2 Riser leak | The networks, water kept in balance, a leak event | A rule over several meters on different devices; an alert that names a section | Network layers; a section of pipe that takes a colour |
| 3 Flood | Rain, a pit that fills, pump failures | "Should be running and is not"; a time-to-limit estimate | A water level drawn in a space |
| 4 Fire | The fire panel's logic acting on other equipment | Alerts that fold consequences under their cause | A level and a zone marked; lift positions |
| 5 Outage | Essential and non-essential boards; equipment that loses power | One alert for many devices; bad is not zero; recovery | The power layer, with live and dead paths |
| 6 Chiller trip | Staging, lost capacity | Comparison with a device's own history; counting zones over a limit | Plant state; zones coloured by how far from setpoint |
| 7 Quiet level | A whole level's points turning bad; sensor drift | Grouping by level; never showing stale as current; spotting a sensor that disagrees | A level greyed out |
| 8 Wasteful night | Overrides left on | Energy against occupancy; comparison between two runs | Night view of the tower |

Stories 2, 5, 6 and 8 end with an automation. Those endings need writing from the
platform, which is a later spec; until then the simulator plays the operator's part
from the story file.
