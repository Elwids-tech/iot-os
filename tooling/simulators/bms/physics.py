"""The building's physics behind a small interface: step the clock, read, apply a command.

`SimpleBuilding` is the built-in physics of spec 038 (building.md, "How the building
behaves"): a seeded day of weather and people, zone heat balances, coil and plant loads,
electricity that adds up through the meter tree and water that follows occupancy. It is
deliberately simple; a detailed engine can replace it behind `Physics` without changing
the server (research R19).

It always advances in fixed steps of `STEP` simulated seconds, so the same seed, season
and start give the same day however the server's clock calls it.
"""
from __future__ import annotations

import math
import random
from abc import ABC, abstractmethod
from datetime import datetime, timedelta, timezone

from . import controls as c
from .dynamics import Day, clamp, smooth, unit
from .model import Building

STEP = 5.0
AIR = 1.2 / 1000 * 1.005  # kW per (L/s · K)
WATER = 4.186  # kW per (L/s · K)

PEOPLE_PER_M2 = {'open_office': 0.1, 'private_offices': 0.08, 'meeting_rooms': 0.25, 'circulation': 0.03, 'conference': 0.4,
                 'hall': 0.2, 'cafe': 0.5, 'kitchen': 0.1, 'lobby': 0.05, 'shop': 0.15, 'control_room': 0.03, 'back_of_house': 0.02}
LIGHTING_W_PER_M2 = {'open_office': 8, 'private_offices': 8, 'meeting_rooms': 9, 'circulation': 6, 'conference': 10, 'hall': 9,
                     'cafe': 9, 'kitchen': 10, 'lobby': 10, 'shop': 12, 'control_room': 8, 'back_of_house': 5}
PLUG_W_PER_M2 = {'open_office': (1.5, 8.0), 'private_offices': (1.5, 7.0), 'meeting_rooms': (1.0, 6.0), 'circulation': (1.0, 1.0),
                 'conference': (1.0, 5.0), 'hall': (0.5, 2.0), 'cafe': (2.0, 6.0), 'kitchen': (3.0, 60.0), 'lobby': (1.0, 2.0),
                 'shop': (2.0, 12.0), 'control_room': (15.0, 0.0), 'back_of_house': (1.0, 3.0)}
# Design airflow of a zone's box, L/s per m², by the zone's use.
# Perimeter boxes add FACADE_AIRFLOW for each m² of the façade they serve.
DESIGN_AIRFLOW = {'circulation': 1.5, 'lobby': 3.0, 'back_of_house': 2.5, 'control_room': 4.0, 'conference': 8.0, 'cafe': 7.0}
FACADE_AIRFLOW = 4.0
CORE_MINIMUM_AIRFLOW = 10.0  # % of design, for boxes without a minimum airflow command
FAN_COIL_KW_PER_M2 = 0.08
# A zone's air (with its fast contents) and its structure, per m² of floor.
AIR_J_PER_M2K = 12_000.0
STRUCTURE_J_PER_M2K = 150_000.0
STRUCTURE_W_PER_M2K = 6.0
TOWER_BASIN_MINIMUM = 4.0  # °C: basin heaters keep the water from freezing
# Perimeter zones whose box cannot heat have heating under the glazing (not a point).
PERIMETER_HEATING_W_PER_M2 = 60.0
CHILLER_KW = 900.0
BOILER_KW = 400.0
PV_KWP = 30.0
IT_LOAD_KW = 28.0


class Physics(ABC):
    """What the server needs from a building: a clock it can step, every point's
    value and status, and a way to apply an accepted command."""

    now: datetime

    @abstractmethod
    def step(self, seconds: float) -> None: ...

    @abstractmethod
    def read(self) -> dict: ...

    @abstractmethod
    def quality(self, point: str) -> str: ...

    @abstractmethod
    def apply(self, point: str, value) -> None: ...


class SimpleBuilding(Physics):
    def __init__(self, building: Building, seed: int = 7, season: str = 'summer', start: datetime | None = None):
        self.b = building
        self.seed = seed
        self.day = Day(seed, season)
        self.season = season
        self.now = (start or datetime.now(timezone.utc)).astimezone(timezone.utc).replace(microsecond=0)
        self.values: dict = {}
        self.qualities: dict[str, str] = {}
        self.hand: set[str] = set()
        self.mains_available = True
        self._pending = 0.0
        self._rng = random.Random(seed)
        self._last_day = self.now.date()
        self._index()
        self._initialise()
        self._tick(0.0)

    # The interface -----------------------------------------------------------------

    def step(self, seconds: float) -> None:
        self._pending += seconds
        while self._pending >= STEP:
            self._tick(STEP)
            self._pending -= STEP

    def read(self) -> dict:
        out = {}
        for key, value in self.values.items():
            if isinstance(value, float):
                value = round(value, 3 if self.b.points[key].kind == 'total' else 2)
            out[key] = value
        return out

    def quality(self, point: str) -> str:
        return self.qualities.get(point, 'Good')

    def apply(self, point: str, value) -> None:
        """Store an accepted command; the equipment's loop acts on it at the next step.
        Equipment in hand mode keeps the value and ignores it."""
        if point not in self.b.points or not self.b.points[point].writable:
            raise KeyError(point)
        self.values[point] = value

    # Set-up ------------------------------------------------------------------------

    def _index(self) -> None:
        b = self.b
        of = b.equipment_of_type
        self.ahus = of('air_handling_unit')
        self.boxes = of('zone_box_reheat', 'zone_box_cooling', 'zone_box_core')
        self.fcus = of('fan_coil_unit')
        self.cracs = of('room_cooling_unit')
        self.oaus = of('outdoor_air_unit')
        self.lights = of('lighting_zone')
        self.blinds = of('blind_group')
        self.chillers = sorted(of('chiller'), key=lambda e: e.key)
        self.towers = {e.key.rsplit('-', 1)[1]: e for e in of('cooling_tower')}
        self.boilers = sorted(of('boiler'), key=lambda e: e.key)
        self.plant = (of('chilled_water_plant') or [None])[0]
        self.heating = (of('heating_plant') or [None])[0]
        self.pumps = of('pump', 'variable_pump')
        self.zone_box = {e.zone: e for e in self.boxes + self.fcus}
        self.zone_lights = {e.zone: e for e in self.lights if e.zone}
        self.zone_blinds = {e.zone: e for e in self.blinds}
        self.ahu_boxes = {a.key: [x for x in self.boxes if a.key in x.fed_by.get('air', [])] for a in self.ahus}
        self.box_ahu = {x.key: x.fed_by['air'][0] for x in self.boxes}
        self.box_loops = {x.key: c.ZoneBoxLoop(x.type == 'zone_box_reheat') for x in self.boxes}
        self.fcu_loops = {x.key: c.FanCoilLoop() for x in self.fcus}
        self.crac_loops = {x.key: c.RoomCoolingLoop() for x in self.cracs}
        self.ahu_loop = c.AirHandlingUnitLoop()
        self.chiller_staging = c.StagingLoop(CHILLER_KW, duty=2)
        self.boiler_staging = c.StagingLoop(BOILER_KW, up=0.85, start_load=5.0, duty=2)
        self.generator_loop = c.GeneratorLoop()
        self.lift_levels = [k for k in b.levels if k != 'RF']
        self.lifts = of('lift')
        self._power_paths()

    def _power_paths(self) -> None:
        """For each load, the meters and transformers its power passes through."""
        present = self.b.equipment
        self.power_nodes = [e for e in present.values() if e.type in ('electricity_sub_meter', 'main_electricity_meter', 'transformer')]
        self.paths: dict[str, list[str]] = {}
        sources = [(e.key, e.fed_by) for e in present.values()] + [(z.key, z.fed_by) for z in self.b.zones.values()]
        model_feeds = self.b.power_feeds
        for key, feeds in sources:
            refs = feeds.get('power')
            if not refs:
                continue
            path, ref, seen = [], refs[0], set()
            while ref and ref not in seen:
                seen.add(ref)
                if ref in present and present[ref].type in ('electricity_sub_meter', 'main_electricity_meter', 'transformer'):
                    path.append(ref)
                ref = (model_feeds.get(ref) or [None])[0]
            self.paths[key] = path

    def _initialise(self) -> None:
        v = self.values
        for key, point in self.b.points.items():
            spec = point.spec
            if point.writable:
                v[key] = float(spec['default']) if spec['type'] == 'number' else spec['default']
            elif spec['type'] == 'boolean':
                v[key] = False
            elif spec['type'] == 'state':
                v[key] = spec['states'][0]
            elif spec['type'] == 'text':
                v[key] = ''
            else:
                v[key] = 0.0
            if point.kind == 'total':
                # A building that has been running for a while.
                scale = {'h': 20000.0, 'kWh': 400000.0, 'm³': 30000.0}.get(spec.get('unit'), 3000.0)
                v[key] = round(scale * (0.2 + 0.8 * unit(self.seed, 'total', key)), 1)
        w = self.day.weather(self.now)
        self.zone_t = {}
        self.zone_m = {}
        self.zone_co2 = {}
        for z in self.b.zones.values():
            setpoint = 22.5 if z.key in self.zone_box else 22.0
            self.zone_t[z.key] = setpoint + (w.temperature - setpoint) * 0.05 + (unit(self.seed, 'zone', z.key) - 0.5)
            self.zone_co2[z.key] = 430.0
            self.zone_m[z.key] = self.zone_t[z.key]
        self.box_air = {x.key: 0.0 for x in self.boxes}
        self.box_reheat = {x.key: 0.0 for x in self.boxes}
        self.box_discharge = {x.key: 18.0 for x in self.boxes}
        self.fcu_out = {x.key: (0.0, 0.0) for x in self.fcus}
        self.ahu_sat = {a.key: 18.0 for a in self.ahus}
        self.ahu_running = {a.key: False for a in self.ahus}
        self.ahu_setback = {a.key: False for a in self.ahus}
        self.ahu_cooling = {a.key: False for a in self.ahus}
        self.ahu_reset = {a.key: 0.0 for a in self.ahus}
        self.box_cooling = {x.key: 0.0 for x in self.boxes}
        self.box_cold = {x.key: False for x in self.boxes}
        self.ahu_filter = {a.key: 90 + 70 * unit(self.seed, 'filter', a.key) for a in self.ahus}
        self.oau_supply = {o.key: w.temperature for o in self.oaus}
        self.oau_filter = {o.key: 80 + 60 * unit(self.seed, 'filter', o.key) for o in self.oaus}
        self.chw_supply = 12.0
        self.chw_return = 12.0
        self.chiller_on_for = {x.key: 0.0 for x in self.chillers}
        self.chiller_temp = {x.key: 12.0 for x in self.chillers}
        self.tower_leaving = {k: w.wet_bulb + 6 for k in self.towers}
        self.hw_supply = 30.0
        self.boiler_supply = {x.key: 30.0 for x in self.boilers}
        self.loads = {'cooling': 0.0, 'heating': 0.0}
        self.server_t = 23.0  # return air, which the room cooling units control
        self.blind_pos = {x.key: 0.0 for x in self.blinds}
        self.peak = {}
        self.tx_winding = {}
        self.lift_state = {x.key: {'at': 0.0, 'target': None, 'door': 0.0, 'load': 0.0} for x in self.lifts}
        self.evc_delivered: dict = {}
        self.tank = {'B1-TNK-1': 82.0, 'B2-TNK-1': 45.0}
        self.tank_filling = False
        self.pit = {x.key: 20 + 30 * unit(self.seed, 'pit', x.key) for x in self.b.equipment_of_type('sump_pump')}
        self.pit_running = {x.key: False for x in self.b.equipment_of_type('sump_pump')}
        self.dhw_t = 61.0
        self.dhw_heating = False
        self.engine_t = 40.0
        self.zone_people = {}
        self.zone_fraction = {}
        self.zone_daylight = {}
        self.zone_lighting_kw = {}
        self.electric: dict[str, float] = {}
        self._purge: dict[str, bool] = {}

    # One step ----------------------------------------------------------------------

    def _tick(self, dt: float) -> None:
        if self.now.date() != self._last_day:
            self._new_day()
        w = self.day.weather(self.now)
        self._people(w)
        self._lighting(dt, w)
        self._air_handling(dt, w)
        self._zones(dt, w)
        self._fan_coils(dt)
        self._server_room(dt)
        self._outdoor_air(dt, w)
        self._chilled_water(dt, w)
        self._heating_water(dt)
        self._services(dt, w)
        self._electricity(dt, w)
        self._sensors(w)
        self.now += timedelta(seconds=dt)

    def _new_day(self) -> None:
        self._last_day = self.now.date()
        self.peak = {}
        if self.plant and self.values[f'{self.plant.key}.staging_mode'] == 'Auto' and self.plant.key not in self.hand:
            states = self.b.points[f'{self.plant.key}.lead_chiller'].spec['states']
            current = states.index(self.values[f'{self.plant.key}.lead_chiller'])
            self.values[f'{self.plant.key}.lead_chiller'] = states[(current + 1) % len(states)]

    # Helpers -----------------------------------------------------------------------

    def _set(self, equipment: str, point: str, value) -> None:
        key = f'{equipment}.{point}'
        if key in self.values:
            self.values[key] = value

    def _get(self, equipment: str, point: str, default=None):
        return self.values.get(f'{equipment}.{point}', default)

    def _noise(self, key: str, amplitude: float, period: float = 300.0) -> float:
        return amplitude * smooth(self.seed, key, self.now.timestamp(), period)

    def _add(self, equipment: str, point: str, amount: float) -> None:
        key = f'{equipment}.{point}'
        if key in self.values and amount > 0:
            self.values[key] += amount

    def _design_airflow(self, zone) -> float:
        facade = zone.facade_length * self.b.levels[zone.level].height if zone.kind == 'perimeter' else 0.0
        return min(2000.0, zone.area * DESIGN_AIRFLOW.get(zone.use, 5.0) + facade * FACADE_AIRFLOW)

    def _hours(self, dt: float) -> float:
        return dt / 3600.0

    def _state(self, equipment, state: str) -> None:
        self._set(equipment.key, 'operating_state', 'Hand' if equipment.key in self.hand else state)

    # People, lighting and blinds ----------------------------------------------------

    def _people(self, w) -> None:
        for z in self.b.zones.values():
            fraction = self.day.occupancy(z.use, z.key, self.now)
            self.zone_fraction[z.key] = fraction
            self.zone_people[z.key] = fraction * z.area * PEOPLE_PER_M2.get(z.use, 0.05)
            box = self.zone_box.get(z.key)
            if box:
                override = bool(self._get(box.key, 'occupancy_override', False))
                self._set(box.key, 'occupancy', self.zone_people[z.key] >= 0.5 or override)

    def _lighting(self, dt: float, w) -> None:
        for blind in self.blinds:
            zone = self.b.zones.get(blind.zone)
            facade = zone.facade if zone else None
            if blind.key not in self.hand:
                target = c.blind_target(self._get(blind.key, 'mode'), self._get(blind.key, 'position_setpoint'), w.on_facade(facade))
                current = self.blind_pos[blind.key]
                move = clamp(target - current, -1.0 * dt, 1.0 * dt)
                self.blind_pos[blind.key] = current + move
            self._set(blind.key, 'position', self.blind_pos[blind.key])
        for z in self.b.zones.values():
            blind = self.zone_blinds.get(z.key)
            shade = 1 - 0.8 * (self.blind_pos[blind.key] / 100 if blind else 0)
            if z.kind == 'perimeter':
                daylight = (w.sunlight * 0.25 + w.on_facade(z.facade) * 0.5) * 110 * 0.035 * shade
            elif z.kind == 'interior':
                daylight = w.sunlight * 0.03 * 110 * 0.05
            else:
                daylight = 0.0
            self.zone_daylight[z.key] = daylight
        hour = self.now.hour + self.now.minute / 60
        weekday = self.now.weekday() < 5
        for light in self.lights:
            mode = self._get(light.key, 'mode')
            level_cmd = self._get(light.key, 'level')
            if light.zone:
                zone = self.b.zones[light.zone]
                box = self.zone_box.get(light.zone)
                occupied = bool(self._get(box.key, 'occupancy')) if box else self.zone_people.get(zone.key, 0) >= 0.5
                daylight = self.zone_daylight[zone.key]
                area = zone.area
                density = LIGHTING_W_PER_M2.get(zone.use, 8)
                level = c.lighting_level(mode, level_cmd, occupied, daylight)
            else:
                daylight = 0.0
                area = light.area
                density = 3.0 if light.room and light.room.endswith('-CP') else 6.0
                if light.level == 'RF':
                    wanted = 100.0 if w.sun_elevation < 0 and 12 <= hour < 23 else 0.0
                    density = 1.5
                elif light.room and light.room.endswith('-CP'):
                    wanted = 60.0 if 6 <= hour < 22 else 20.0
                else:
                    wanted = 70.0 if weekday and 7 <= hour < 18 else 10.0
                level = {'Off': 0.0, 'On': level_cmd}.get(mode, wanted)
            if light.key in self.hand:
                level = self._get(light.key, 'power', 0.0) / max(area * density / 1000, 1e-6) * 100
            power = area * density * level / 100 / 1000
            self._set(light.key, 'daylight_level', max(0.0, daylight + self._noise(f'{light.key}.daylight', 3)) if daylight > 0 else 0.0)
            self._set(light.key, 'light_level', daylight + level / 100 * 600 + (self._noise(f'{light.key}.lux', 5) if level else 0))
            self._set(light.key, 'power', power)
            self._set(light.key, 'lights_on', level > 0.5)
            if light.zone:
                self.zone_lighting_kw[light.zone] = power

    # Air handling and zones ----------------------------------------------------------

    def _plant_supply(self) -> tuple[bool, float, bool, float]:
        chw = self.plant is not None and self.chw_supply < 12.0
        hw = self.heating is not None and self.hw_supply > 40.0
        return chw, self.chw_supply, hw, self.hw_supply

    def _air_handling(self, dt: float, w) -> None:
        hour = self.now.hour + self.now.minute / 60
        for a in self.ahus:
            boxes = self.ahu_boxes[a.key]
            zones = [self.b.zones[x.zone] for x in boxes]
            temps = [self.zone_t[z.key] for z in zones] or [22.0]
            scheduled = any(self.day.scheduled(z.use, self.now) for z in zones)
            override = bool(self._get(a.key, 'schedule_override')) or any(self._get(x.key, 'occupancy_override') for x in boxes)
            mean = sum(temps) / len(temps)
            weights = [self.box_air[x.key] for x in boxes]
            flow = sum(weights)
            return_co2 = (sum(self.zone_co2[x.zone] * f for x, f in zip(boxes, weights)) / flow) if flow > 1 else 430.0
            if a.key in self.hand:
                self._state(a, 'Hand')
                continue
            starts = [self.day.starts_in(z.use, self.now) for z in zones]
            starts = [h for h in starts if h is not None]
            warm_below = min((self._get(x.key, 'temperature_setpoint') for x in boxes), default=22.5) - 1.0
            decision = self.ahu_loop.run(self._get(a.key, 'mode'), scheduled, override, hour, w.temperature, mean, return_co2,
                                         self._get(a.key, 'minimum_outdoor_air'), self.season != 'winter',
                                         min(starts) if starts else None, warm_below)
            # Night low limit: run, unoccupied, while any zone is below its unoccupied
            # heating setpoint, until all are a degree above it.
            setback = min((self._get(x.key, 'temperature_setpoint') for x in boxes), default=22.5) - c.ZoneBoxLoop.UNOCCUPIED_WIDENING
            if min(temps) < setback:
                self.ahu_setback[a.key] = True
            elif min(temps) > setback + 1.0:
                self.ahu_setback[a.key] = False
            if not decision.running and self.ahu_setback.get(a.key):
                decision = c.AirHandlingDecision(True, 'Unoccupied', 10.0, False)
            self.ahu_running[a.key] = decision.running
            self.ahu_cooling[a.key] = decision.cooling_allowed
            self._set(a.key, 'outdoor_air_damper', decision.outdoor_air)
            self._state(a, decision.state)
            self._set(a.key, 'supply_fan_status', decision.running)
            self._set(a.key, 'return_fan_status', decision.running)
            self._purge[a.key] = decision.state == 'Night purge'

    def _zones(self, dt: float, w) -> None:
        chw, chw_t, hw, hw_t = self._plant_supply()
        level_means = {}
        for z in self.b.zones.values():
            level_means.setdefault(z.level, []).append(self.zone_t[z.key])
        level_means = {k: sum(v) / len(v) for k, v in level_means.items()}
        reheat_kw = 0.0
        for x in self.boxes:
            zone = self.b.zones[x.zone]
            ahu = self.box_ahu[x.key]
            air = self.ahu_running.get(ahu, False)
            purge = self._purge.get(ahu, False)
            occupied = (self._get(ahu, 'operating_state') == 'Occupied') or bool(self._get(x.key, 'occupancy_override'))
            setpoint = self._get(x.key, 'temperature_setpoint')
            maximum = self._design_airflow(zone)
            minimum = maximum * self._get(x.key, 'minimum_airflow', CORE_MINIMUM_AIRFLOW) / 100
            if f'{x.key}.zone_co2' in self.values:
                # Demand ventilation: carbon dioxide raises the box's minimum airflow.
                need = clamp((self.zone_co2[zone.key] - 800) / 300, 0.0, 1.0)
                minimum = max(minimum, need * maximum)
            if x.key in self.hand:
                self._set(x.key, 'operating_state', 'Hand')
            else:
                out = self.box_loops[x.key].run(dt, self.zone_t[zone.key], setpoint, occupied, air)
                self.box_cooling[x.key] = out.cooling
                self.box_cold[x.key] = self.zone_t[zone.key] < out.effective_setpoint - 0.5
                if purge or self._get(ahu, 'operating_state') == 'Warm-up':
                    flow = maximum
                elif air:
                    flow = minimum + out.cooling * (maximum - minimum)
                else:
                    flow = 0.0
                self.box_air[x.key] = flow
                self.box_reheat[x.key] = out.heating * 100
                self._set(x.key, 'effective_setpoint', out.effective_setpoint)
                self._set(x.key, 'operating_state', out.state)
                self._set(x.key, 'damper_position', flow / maximum * 100 if air else self._get(x.key, 'damper_position', 0.0))
                self._set(x.key, 'zone_temperature_alarm', occupied and abs(self.zone_t[zone.key] - out.effective_setpoint) > 3.0)
            flow = self.box_air[x.key]
            supply = self.ahu_sat.get(ahu, 18.0)
            reheat = self.box_reheat[x.key]
            discharge = supply + (reheat / 100 * max(0.0, hw_t - 30 - supply) if hw else 0.0)
            self.box_discharge[x.key] = discharge
            if reheat > 0:
                reheat_kw += reheat / 100 * flow * AIR * max(0.0, 40 - supply)  # what the valve asks for
            self._set(x.key, 'airflow', clamp(flow + self._noise(f'{x.key}.airflow', 4), 0.0, 2000.0) if flow else 0.0)
            self._set(x.key, 'reheat_valve', reheat)
            self._set(x.key, 'discharge_air_temperature', discharge)
        self.loads['reheat'] = reheat_kw

        perimeter_kw = 0.0
        for z in self.b.zones.values():
            people = self.zone_people.get(z.key, 0.0)
            fraction = self.zone_fraction[z.key]
            base, extra = PLUG_W_PER_M2.get(z.use, (1.0, 2.0))
            # Two nodes: the air, which the box acts on, and the structure (slab, walls and
            # furniture), which takes the sun and half of the internal gains and gives
            # them back slowly, as a real floor does.
            internal = people * 75 + z.area * (base + extra * fraction) + self.zone_lighting_kw.get(z.key, 0.0) * 1000 * 0.8
            gains = internal * 0.5
            to_structure = internal * 0.5
            level = self.b.levels[z.level]
            if z.kind == 'perimeter':
                facade_area = z.facade_length * level.height
                blind = self.zone_blinds.get(z.key)
                shade = 1 - 0.7 * (self.blind_pos[blind.key] / 100 if blind else 0)
                to_structure += w.on_facade(z.facade) * facade_area * 0.4 * 0.35 * shade  # glazed share, solar factor
                gains += facade_area * 1.2 * (w.temperature - self.zone_t[z.key])
            exchange = z.area * STRUCTURE_W_PER_M2K * (self.zone_m[z.key] - self.zone_t[z.key])
            gains += exchange
            gains += 15.0 * (level_means[z.level] - self.zone_t[z.key])
            box = self.zone_box.get(z.key)
            if box and box.type != 'fan_coil_unit':
                gains += self.box_air[box.key] * AIR * 1000 * (self.box_discharge[box.key] - self.zone_t[z.key])
            elif box:
                cooling, _ = self.fcu_out[box.key]
                gains -= cooling * 1000
            elif z.use == 'kitchen':
                # Make-up air drawn from the hall carries the cooking heat out through the hood.
                gains += (300.0 + 1500.0 * fraction) * (level_means[z.level] - self.zone_t[z.key])
            if z.kind == 'perimeter' and (box is None or box.type == 'zone_box_cooling'):
                setpoint = self._get(box.key, 'temperature_setpoint') if box else 21.0
                occupied_now = self.day.scheduled(z.use, self.now)
                wanted = setpoint - (0.5 if occupied_now else 3.0)
                heat = clamp((wanted - self.zone_t[z.key]) * z.area * 30, 0.0, z.area * PERIMETER_HEATING_W_PER_M2)
                if not hw:
                    heat = 0.0
                gains += heat
                perimeter_kw += (wanted - self.zone_t[z.key] > 0) * z.area * PERIMETER_HEATING_W_PER_M2 / 1000 * 0.5
            self.zone_t[z.key] += gains / (z.area * AIR_J_PER_M2K) * dt
            self.zone_m[z.key] += (to_structure - exchange) / (z.area * STRUCTURE_J_PER_M2K) * dt
            # Carbon dioxide follows the people and the outdoor air brought in.
            flow = self.box_air.get(box.key, 0.0) if box and box.type != 'fan_coil_unit' else 30.0
            ahu = self.box_ahu.get(box.key) if box and box.type != 'fan_coil_unit' else None
            outdoor = (self._get(ahu, 'outdoor_air_damper', 20.0) / 100) if ahu else 0.5
            fresh = max(flow * outdoor, 2.0)
            target = 420 + people * 5.2 / fresh * 1000
            self.zone_co2[z.key] += (target - self.zone_co2[z.key]) * min(1.0, dt / 900)
        self.loads['reheat'] += perimeter_kw
        for x in self.boxes:
            self._set(x.key, 'zone_temperature', self.zone_t[x.zone] + self._noise(f'{x.key}.t', 0.05))
            self._set(x.key, 'zone_co2', self.zone_co2[x.zone] + self._noise(f'{x.key}.co2', 8))

        # The air handling units' coils now see what their boxes asked for.
        cooling_kw = heating_kw = 0.0
        for a in self.ahus:
            boxes = self.ahu_boxes[a.key]
            flow = sum(self.box_air[x.key] for x in boxes)
            design = sum(self._design_airflow(self.b.zones[x.zone]) for x in boxes) * 0.8
            running = self.ahu_running[a.key]
            ret = (sum(self.zone_t[x.zone] * self.box_air[x.key] for x in boxes) / flow + 0.5) if flow > 1 else \
                sum(self.zone_t[x.zone] for x in boxes) / max(len(boxes), 1)
            co2 = (sum(self.zone_co2[x.zone] * self.box_air[x.key] for x in boxes) / flow) if flow > 1 else 430.0
            feeding = [o for o in a.fed_by.get('air', []) if o in self.b.equipment]
            oau_on = [o for o in feeding if self._get(o, 'fan_status')]
            outdoor_air = sum(self.oau_supply[o] for o in oau_on) / len(oau_on) if oau_on else w.temperature
            damper = self._get(a.key, 'outdoor_air_damper') / 100 if running else 0.0
            mixed = damper * outdoor_air + (1 - damper) * ret
            # Supply air reset: when no zone wants cooling and some are cold, the unit
            # raises its supply air (up to 18 °C) a little at a time, and lowers it again
            # as soon as a zone calls for cooling.
            written = self._get(a.key, 'supply_air_temperature_setpoint')
            calls = max((self.box_cooling.get(x.key, 0.0) for x in boxes), default=0.0)
            cold = any(self.box_cold.get(x.key) for x in boxes)
            reset = self.ahu_reset.get(a.key, 0.0)
            if calls > 0.8:
                reset -= 0.5 * dt / 300
            elif cold and calls < 0.3 and w.temperature < 16:
                reset += 0.5 * dt / 300
            self.ahu_reset[a.key] = reset = clamp(reset, 0.0, max(0.0, 18.0 - written))
            setpoint = written + reset
            if self._get(a.key, 'operating_state') == 'Warm-up':
                setpoint = 30.0
            purge = self._purge.get(a.key, False)
            cool_valve = heat_valve = 0.0
            target = mixed
            cooling_allowed = self.ahu_cooling.get(a.key, False)
            if running and not purge and a.key not in self.hand:
                if mixed > setpoint and chw and cooling_allowed:
                    target = max(setpoint, chw_t + 3.0)
                    cool_valve = clamp((mixed - target) / max(mixed - (chw_t + 3.0), 0.5) * 100, 0, 100)
                elif mixed < setpoint and hw:
                    target = setpoint
                    heat_valve = clamp((setpoint - mixed) / max(hw_t - 15 - mixed, 1.0) * 100, 0, 100)
            elif a.key in self.hand:
                cool_valve, heat_valve = self._get(a.key, 'cooling_valve'), self._get(a.key, 'heating_valve')
                target = mixed - cool_valve / 100 * 10 + heat_valve / 100 * 15
            self.ahu_sat[a.key] += (target - self.ahu_sat[a.key]) * min(1.0, dt / 60)
            sat = self.ahu_sat[a.key]
            if running and not purge:
                # What the coils ask the plants for, met or not: a plant starts on demand.
                cooling_kw += flow * AIR * max(0.0, mixed - setpoint) if cooling_allowed else 0.0
                heating_kw += flow * AIR * max(0.0, setpoint - mixed)
            speed = clamp(flow / max(design, 1) * 100, 25, 100) if running else 0.0
            fan_kw = design * 1.2 / 1000 * (speed / 100) ** 3 * 1.5 if running else 0.0
            if running:
                self.ahu_filter[a.key] += 0.02 * self._hours(dt) * 24
            self._set(a.key, 'supply_air_temperature', sat + self._noise(f'{a.key}.sat', 0.05))
            self._set(a.key, 'return_air_temperature', ret + self._noise(f'{a.key}.rat', 0.05))
            self._set(a.key, 'mixed_air_temperature', mixed)
            self._set(a.key, 'return_air_co2', co2 + self._noise(f'{a.key}.co2', 6))
            self._set(a.key, 'duct_static_pressure', self._get(a.key, 'duct_static_pressure_setpoint') * (1 + self._noise(f'{a.key}.dsp', 0.03)) if running else 0.0)
            self._set(a.key, 'filter_pressure_drop', (self.ahu_filter[a.key] if running else 5.0) + self._noise(f'{a.key}.filter', 2))
            self._set(a.key, 'supply_airflow', flow)
            self._set(a.key, 'supply_fan_speed', speed)
            self._set(a.key, 'return_fan_speed', speed * 0.9)
            self._set(a.key, 'cooling_valve', cool_valve)
            self._set(a.key, 'heating_valve', heat_valve)
            self._set(a.key, 'filter_alarm', self.ahu_filter[a.key] > 250)
            self._set(a.key, 'frost_alarm', running and mixed < 3.0)
            if running:
                self._add(a.key, 'run_hours', self._hours(dt))
                self._add(a.key, 'fan_energy', fan_kw * self._hours(dt))
            self.electric[a.key] = fan_kw
        self.loads['cooling'] = cooling_kw
        self.loads['heating'] = heating_kw

    def _fan_coils(self, dt: float) -> None:
        chw, _, hw, _ = self._plant_supply()
        for x in self.fcus:
            zone = self.b.zones[x.zone]
            open_hours = self.day.scheduled(zone.use, self.now)
            if x.key in self.hand:
                self._set(x.key, 'operating_state', 'Hand')
                continue
            valve, fan, state = self.fcu_loops[x.key].run(dt, self.zone_t[zone.key], self._get(x.key, 'temperature_setpoint'),
                                                          self._get(x.key, 'mode'), open_hours)
            capacity = zone.area * FAN_COIL_KW_PER_M2
            cooling = capacity * valve if valve > 0 and chw else (capacity * valve if valve < 0 and hw else 0.0)
            self.fcu_out[x.key] = (cooling, fan)
            asked = capacity * valve
            self._set(x.key, 'room_temperature', self.zone_t[zone.key] + self._noise(f'{x.key}.t', 0.05))
            self._set(x.key, 'fan_speed', fan * 100)
            self._set(x.key, 'valve_position', abs(valve) * 100)
            self._set(x.key, 'effective_setpoint', self._get(x.key, 'temperature_setpoint'))
            self._set(x.key, 'fan_status', fan > 0)
            self._set(x.key, 'operating_state', state)
            self.loads['cooling'] += max(0.0, asked)
            self.loads['heating'] += max(0.0, -asked)

    def _server_room(self, dt: float) -> None:
        if not self.cracs:
            return
        it_kw = IT_LOAD_KW + 2.0 * smooth(self.seed, 'it-load', self.now.timestamp(), 3600)
        enabled = [x for x in self.cracs if self._get(x.key, 'enable')]
        lead = enabled[:1]
        hot = self.server_t > self._get(self.cracs[0].key, 'temperature_setpoint') + 1.5
        running = enabled if hot else lead
        removed = 0.0
        for x in self.cracs:
            on = x in running
            if x.key in self.hand:
                output = self._get(x.key, 'cooling_output', 0.0)
                self._set(x.key, 'operating_state', 'Hand')
            elif on:
                share = it_kw / len(running) / 45.0
                output = 45.0 * self.crac_loops[x.key].run(dt, self.server_t, self._get(x.key, 'temperature_setpoint'), share)
                self._state(x, 'Cooling')
            else:
                output = 0.0
                self._state(x, 'Standby' if self._get(x.key, 'enable') else 'Off')
            removed += output
            self._set(x.key, 'status', on)
            self._set(x.key, 'cooling_output', output)
            self._set(x.key, 'fan_speed', 70.0 + 30 * output / 45 if on else 0.0)
            self._set(x.key, 'return_air_temperature', self.server_t + self._noise(f'{x.key}.rat', 0.1))
            self._set(x.key, 'supply_air_temperature', self.server_t - output / (3.6 * 1.005) + self._noise(f'{x.key}.sat', 0.1))
            self._set(x.key, 'return_air_humidity', self._get(x.key, 'humidity_setpoint') + self._noise(f'{x.key}.rh', 1.5))
            self._set(x.key, 'high_temperature_alarm', self.server_t > 30)
            if on:
                self._add(x.key, 'run_hours', self._hours(dt))
            self.electric[x.key] = output / 3.5 + (1.2 if on else 0.0)
        self.server_t += (it_kw - removed) * 1000 / 3_000_000 * dt
        for ups in self.b.equipment_of_type('uninterruptible_supply'):
            self._set(ups.key, 'output_power', it_kw)
            self._set(ups.key, 'load', it_kw / 80.0 * 100)
            self._set(ups.key, 'battery_charge', 100.0)
            self._set(ups.key, 'battery_run_time', clamp(900 / it_kw, 0, 240))
            self._set(ups.key, 'input_voltage', 230 + self._noise(f'{ups.key}.vin', 1.5))
            self._set(ups.key, 'output_voltage', 230 + self._noise(f'{ups.key}.vout', 0.3))
            self._set(ups.key, 'battery_temperature', 24 + self._noise(f'{ups.key}.bt', 0.5, 1800))
            self._set(ups.key, 'operating_state', 'Online')
            self._add(ups.key, 'energy', it_kw * self._hours(dt))
            self.electric[ups.key] = it_kw / 0.95

    # Outdoor air and plant -------------------------------------------------------------

    def _outdoor_air(self, dt: float, w) -> None:
        chw, chw_t, hw, hw_t = self._plant_supply()
        for o in self.oaus:
            fed = [a for a in self.ahus if o.key in a.fed_by.get('air', [])]
            demand = sum(self._get(a.key, 'supply_airflow') * self._get(a.key, 'outdoor_air_damper') / 100 / max(len(a.fed_by.get('air', [])), 1)
                         for a in fed if self.ahu_running[a.key])
            mode = self._get(o.key, 'mode')
            if o.key in self.hand:
                self._set(o.key, 'operating_state', 'Hand')
                running = bool(self._get(o.key, 'fan_status'))
                airflow = self._get(o.key, 'airflow')
            else:
                running = mode == 'On' or (mode == 'Auto' and demand > 50)
                airflow = self._get(o.key, 'airflow_setpoint') if mode == 'On' else min(demand, self._get(o.key, 'airflow_setpoint'))
                airflow = airflow if running else 0.0
                self._state(o, 'Running' if running else 'Off')
            setpoint = self._get(o.key, 'supply_air_temperature_setpoint')
            target = w.temperature
            cool_valve = heat_valve = 0.0
            if running and w.temperature > setpoint + 0.5 and chw:
                target = max(setpoint, chw_t + 3.0)
                cool_valve = clamp((w.temperature - target) / max(w.temperature - chw_t - 3, 0.5) * 100, 0, 100)
            elif running and w.temperature < setpoint - 0.5 and hw:
                target = setpoint
                heat_valve = clamp((setpoint - w.temperature) / max(hw_t - 15 - w.temperature, 1) * 100, 0, 100)
            self.oau_supply[o.key] += (target - self.oau_supply[o.key]) * min(1.0, dt / 120)
            supply = self.oau_supply[o.key]
            if running:
                self.loads['cooling'] += airflow * AIR * max(0.0, w.temperature - setpoint)
                self.loads['heating'] += airflow * AIR * max(0.0, setpoint - w.temperature)
                self.oau_filter[o.key] += 0.015 * self._hours(dt) * 24
                self._add(o.key, 'run_hours', self._hours(dt))
            speed = airflow / 12000 * 100
            self._set(o.key, 'intake_air_temperature', w.temperature + self._noise(f'{o.key}.in', 0.1))
            self._set(o.key, 'supply_air_temperature', supply + self._noise(f'{o.key}.sat', 0.05))
            self._set(o.key, 'supply_air_humidity', clamp(w.humidity * 1.07 ** (w.temperature - supply), 5, 92))
            self._set(o.key, 'airflow', airflow)
            self._set(o.key, 'filter_pressure_drop', self.oau_filter[o.key] if running else 4.0)
            self._set(o.key, 'fan_speed', speed)
            self._set(o.key, 'cooling_valve', cool_valve)
            self._set(o.key, 'heating_valve', heat_valve)
            self._set(o.key, 'fan_status', running)
            self._set(o.key, 'filter_alarm', self.oau_filter[o.key] > 250)
            self.electric[o.key] = 12.0 * (speed / 100) ** 3 if running else 0.0

    def _chilled_water(self, dt: float, w) -> None:
        load = self.loads['cooling']
        p = self.plant
        if p is None:
            return
        enabled = bool(self._get(p.key, 'plant_enable'))
        auto = self._get(p.key, 'staging_mode') == 'Auto'
        lead = self.b.points[f'{p.key}.lead_chiller'].spec['states'].index(self._get(p.key, 'lead_chiller'))
        available = [bool(self._get(x.key, 'enable')) and not self._get(x.key, 'fault') for x in self.chillers]
        if p.key in self.hand:
            running = [x for x in self.chillers if self._get(x.key, 'status')]
        elif auto:
            stages = self.chiller_staging.run(dt, load, enabled)
            running = [self.chillers[i] for i in c.lead_order(lead, available)[:stages]]
        else:
            running = [x for x, ok in zip(self.chillers, available) if ok] if enabled else []
        delivered = 0.0
        supplies = []
        for x in self.chillers:
            on = x in running
            rejection = 0.0
            was = self._get(x.key, 'status')
            if on and not was:
                self._add(x.key, 'starts', 1)
                self.chiller_on_for[x.key] = 0.0
            self.chiller_on_for[x.key] = self.chiller_on_for[x.key] + dt if on else 0.0
            starting = on and self.chiller_on_for[x.key] < 60
            effective = self._get(p.key, 'chilled_water_setpoint') if auto else self._get(x.key, 'chilled_water_setpoint')
            n = x.key.rsplit('-', 1)[1]
            tower = self.towers.get(n)
            entering = self.tower_leaving.get(n, w.wet_bulb + 6)
            if on and not starting and x.key not in self.hand:
                wanted = load / max(len([r for r in running if self.chiller_on_for[r.key] >= 60]), 1)
                limit = CHILLER_KW * self._get(x.key, 'demand_limit') / 100
                share = min(wanted, limit)
                shortfall = (wanted - share) / max(wanted, 1)
                supply = effective + 4.0 * shortfall
                self.chiller_temp[x.key] += (supply - self.chiller_temp[x.key]) * min(1.0, dt / 90)
                cop = clamp(6.5 - 0.15 * (entering - 24) - 1.5 * (1 - share / CHILLER_KW) ** 2, 2.5, 7.5)
                power = share / cop
                rejection = share + power
                leaving = entering + rejection / (50 * WATER)
                delivered += share
                supplies.append(self.chiller_temp[x.key])
                ret = self.chiller_temp[x.key] + share / (40 * WATER)
                self._state(x, 'Running')
            else:
                share = power = 0.0
                self.chiller_temp[x.key] += (16.0 - self.chiller_temp[x.key]) * min(1.0, dt / 1800)
                leaving = entering
                ret = self.chiller_temp[x.key]
                self._state(x, 'Starting' if starting else ('Fault' if self._get(x.key, 'fault') else 'Off'))
            self._set(x.key, 'status', on)
            self._set(x.key, 'load', share / CHILLER_KW * 100)
            self._set(x.key, 'power', power)
            self._set(x.key, 'chilled_water_supply_temperature', self.chiller_temp[x.key] + self._noise(f'{x.key}.chws', 0.05))
            self._set(x.key, 'chilled_water_return_temperature', ret + self._noise(f'{x.key}.chwr', 0.05))
            self._set(x.key, 'condenser_water_entering_temperature', entering)
            self._set(x.key, 'condenser_water_leaving_temperature', leaving)
            self._set(x.key, 'effective_setpoint', effective)
            if on:
                self._add(x.key, 'run_hours', self._hours(dt))
            self.electric[x.key] = power
            # Its primary pump, condenser pump and tower run with it.
            for kind, kw, dp in (('PCHWP', 7.5, 140.0), ('CWP', 11.0, 180.0)):
                pump = self.b.equipment.get(f'{x.level}-{kind}-{n}')
                if pump:
                    self._pump(pump, dt, on, kw, dp)
            if tower:
                self._tower(tower, dt, w, on, rejection)
        if supplies:
            self.chw_supply = sum(supplies) / len(supplies)
        else:
            self.chw_supply += (16.0 - self.chw_supply) * min(1.0, dt / 1200)
        flow = 40.0 * len(supplies)
        self.chw_return = self.chw_supply + (delivered / (flow * WATER) if flow else 0.0)
        speed = clamp(30 + 70 * load / (2 * CHILLER_KW), 30, 100) if running else 0.0
        for i, pump in enumerate(x for x in self.pumps if x.type == 'variable_pump'):
            self._pump(pump, dt, bool(running) and (i == 0 or speed > 85), 18.0 * (speed / 100) ** 3,
                       self._get(pump.key, 'pressure_setpoint'), speed)
        self._set(p.key, 'plant_load', delivered)
        self._set(p.key, 'flow', flow)
        self._set(p.key, 'supply_temperature', self.chw_supply)
        self._set(p.key, 'return_temperature', self.chw_return)
        self._set(p.key, 'differential_pressure', 150.0 + self._noise(f'{p.key}.dp', 3) if running else 0.0)
        self._set(p.key, 'chillers_running', float(len(running)))
        self._state(p, 'Running' if enabled else 'Off')
        self._add(p.key, 'cooling_energy', delivered * self._hours(dt))

    def _pump(self, pump, dt: float, wanted: bool, kw: float, dp: float, speed: float | None = None) -> None:
        mode = self._get(pump.key, 'mode')
        if pump.key in self.hand:
            on = bool(self._get(pump.key, 'status'))
        else:
            on = mode == 'On' or (mode == 'Auto' and wanted)
        self._set(pump.key, 'status', on)
        self._set(pump.key, 'differential_pressure', dp * (1 + self._noise(f'{pump.key}.dp', 0.02)) if on else 0.0)
        self._set(pump.key, 'power', (kw if speed is None else max(kw, 0.5)) if on else 0.0)
        if speed is not None:
            self._set(pump.key, 'speed', speed if on else 0.0)
        if on:
            self._add(pump.key, 'run_hours', self._hours(dt))
        self.electric[pump.key] = (kw if speed is None else max(kw, 0.5)) if on else 0.0

    def _tower(self, tower, dt: float, w, wanted: bool, rejection: float) -> None:
        n = tower.key.rsplit('-', 1)[1]
        mode = self._get(tower.key, 'mode')
        on = mode == 'On' or (mode == 'Auto' and wanted)
        if tower.key in self.hand:
            on = bool(self._get(tower.key, 'fan_status'))
        load_factor = 0.5 + 0.5 * rejection / (CHILLER_KW * 1.2)
        needed = w.wet_bulb + 8 * load_factor - 27.0
        speed = clamp(needed / (5 * load_factor) * 100, 0, 100) if on else 0.0
        target = w.wet_bulb + (8 - 5 * speed / 100) * load_factor if on else w.wet_bulb + 2
        self.tower_leaving[n] += (target - self.tower_leaving[n]) * min(1.0, dt / 300)
        self.tower_leaving[n] = max(self.tower_leaving[n], TOWER_BASIN_MINIMUM)
        self._set(tower.key, 'leaving_water_temperature', self.tower_leaving[n])
        self._set(tower.key, 'basin_temperature', self.tower_leaving[n] - 0.3)
        self._set(tower.key, 'fan_speed', speed)
        self._set(tower.key, 'fan_status', speed > 0)
        self._set(tower.key, 'power', 18.0 * (speed / 100) ** 3)
        self.electric[tower.key] = 18.0 * (speed / 100) ** 3

    def _heating_water(self, dt: float) -> None:
        h = self.heating
        if h is None:
            return
        load = self.loads['heating'] + self.loads.get('reheat', 0.0)
        enabled = bool(self._get(h.key, 'plant_enable'))
        stages = self.boiler_staging.run(dt, load, enabled)
        available = [bool(self._get(x.key, 'enable')) and not self._get(x.key, 'fault') for x in self.boilers]
        firing = [self.boilers[i] for i in c.lead_order(0, available)[:stages]]
        plant_setpoint = self._get(h.key, 'heating_water_setpoint')
        supplies = []
        for x in self.boilers:
            n = x.key.rsplit('-', 1)[1]
            on = x in firing and x.key not in self.hand
            effective = min(plant_setpoint, self._get(x.key, 'supply_setpoint'))
            if on:
                share = load / len(firing)
                self.boiler_supply[x.key] += (effective - self.boiler_supply[x.key]) * min(1.0, dt / 300)
                rate = clamp(share / BOILER_KW * 100, 20, 100)
                supplies.append(self.boiler_supply[x.key])
                self._add(x.key, 'run_hours', self._hours(dt))
                state = 'Firing'
            else:
                share, rate = 0.0, 0.0
                self.boiler_supply[x.key] += (25.0 - self.boiler_supply[x.key]) * min(1.0, dt / 3600)
                state = 'Standby' if enabled and self._get(x.key, 'enable') else 'Off'
            self._state(x, state)
            self._set(x.key, 'status', on)
            self._set(x.key, 'supply_temperature', self.boiler_supply[x.key] + self._noise(f'{x.key}.s', 0.1))
            self._set(x.key, 'return_temperature', self.boiler_supply[x.key] - share / (10 * WATER))
            self._set(x.key, 'firing_rate', rate)
            self._set(x.key, 'flue_gas_temperature', (60 + rate * 1.2) if on else self.boiler_supply[x.key])
            self._set(x.key, 'effective_setpoint', effective)
            self.electric[x.key] = 1.0 if on else 0.1
            pump = self.b.equipment.get(f'{x.level}-HWP-{n}')
            if pump:
                self._pump(pump, dt, on, 4.0, 120.0)
        self.hw_supply = max(supplies) if supplies else max(self.boiler_supply.values() or [25.0])
        self._set(h.key, 'supply_temperature', self.hw_supply)
        self._set(h.key, 'return_temperature', self.hw_supply - (load / (10 * WATER * max(len(firing), 1)) if firing else 0.0))
        self._state(h, 'Running' if enabled else 'Off')
        self._add(h.key, 'heat_energy', (load if firing else 0.0) * self._hours(dt))

    # Services ------------------------------------------------------------------------

    def _services(self, dt: float, w) -> None:
        hour = self.now.hour + self.now.minute / 60
        weekday = self.now.weekday() < 5
        # Car parks: carbon monoxide follows the traffic; fans dilute it.
        for v in self.b.equipment_of_type('car_park_ventilation'):
            fans = [f for f in self.b.equipment_of_type('car_park_fan') if v.key in f.fed_by.get('air', [])]
            mean_speed = sum(self._get(f.key, 'speed') for f in fans) / max(len(fans), 1)
            traffic = self.day.traffic(self.now) * (1.0 if v.level == 'B1' else 0.7)
            readings = []
            for n in range(1, len(v.sensors) + 1):
                spot = 0.6 + 0.8 * unit(self.seed, 'co-spot', v.key, n)
                raw = 2 + 28 * traffic * spot + 1.5 * (1 + smooth(self.seed, (v.key, n), self.now.timestamp(), 600))
                reading = raw * (1 - 0.5 * mean_speed / 100)
                readings.append(reading)
                self._set(v.key, f'co_{n}', reading)
                self._set(v.key, f'co_{n}_alarm', reading > 50)
            highest = max(readings) if readings else 0.0
            setpoint = self._get(v.key, 'co_setpoint')
            speed = c.car_park_fan_speed(highest, setpoint)
            self._set(v.key, 'highest_co', highest)
            self._state(v, 'Alarm' if highest > 50 else 'Boost' if speed > 60 else 'Normal')
            for f in fans:
                mode = self._get(f.key, 'mode')
                fan_speed = 100.0 if mode == 'On' else 0.0 if mode == 'Off' else (self._get(f.key, 'speed') if f.key in self.hand or v.key in self.hand else speed)
                self._set(f.key, 'speed', fan_speed)
                self._set(f.key, 'status', fan_speed > 0)
                self._set(f.key, 'power', 7.5 * (fan_speed / 100) ** 3)
                if fan_speed > 0:
                    self._add(f.key, 'run_hours', self._hours(dt))
                self.electric[f.key] = 7.5 * (fan_speed / 100) ** 3
        for f in self.b.equipment_of_type('exhaust_fan'):
            mode = self._get(f.key, 'mode')
            on = mode == 'On' or (mode == 'Auto' and 6 <= hour < 22)
            self._set(f.key, 'status', on)
            if on:
                self._add(f.key, 'run_hours', self._hours(dt))
            self.electric[f.key] = 2.2 if on else 0.0
        for f in self.b.equipment_of_type('kitchen_exhaust_fan'):
            cooking = self.day.occupancy('kitchen', f.zone or f.key, self.now)
            mode = self._get(f.key, 'mode')
            speed = 100.0 if mode == 'On' else 0.0 if mode == 'Off' else (40 + 60 * cooking if cooking > 0.1 else 0.0)
            self._set(f.key, 'speed', speed)
            self._set(f.key, 'status', speed > 0)
            if speed:
                self._add(f.key, 'run_hours', self._hours(dt))
            self.electric[f.key] = 4.0 * (speed / 100) ** 3
        for f in self.b.equipment_of_type('stair_pressurisation_fan'):
            self._set(f.key, 'status', False)
            self._set(f.key, 'stair_pressure', 0.0)
            self.electric[f.key] = 0.0

        # Lifts: trips follow the building's people.
        occupancy = sum(self.zone_people.values()) / max(sum(z.area * PEOPLE_PER_M2.get(z.use, 0.05) for z in self.b.zones.values()), 1)
        for lift in self.lifts:
            s = self.lift_state[lift.key]
            moving = False
            if s['door'] > 0:
                s['door'] = max(0.0, s['door'] - dt)
            elif s['target'] is None:
                if self._rng.random() < (0.1 + 1.5 * occupancy) / 60 * dt:  # trips a minute, busier with people
                    choice = self._rng.randrange(len(self.lift_levels))
                    if choice != round(s['at']):
                        s['target'] = float(choice)
                        s['load'] = 75.0 * self._rng.randint(1, 8) * (3 if lift.name.startswith('Goods') else 1)
            if s['target'] is not None and s['door'] == 0:
                step = clamp(s['target'] - s['at'], -dt / 2.5, dt / 2.5)
                s['at'] += step
                moving = abs(step) > 0
                if abs(s['at'] - s['target']) < 1e-6:
                    s['at'], s['target'], s['door'] = s['target'], None, 10.0
                    self._add(lift.key, 'trips', 1)
                    s['load'] = 0.0 if self._rng.random() < 0.5 else s['load']
            direction = 'Stopped' if not moving else ('Up' if s['target'] is not None and s['target'] > s['at'] else 'Down')
            self._set(lift.key, 'current_level', self.lift_levels[int(round(s['at']))])
            self._set(lift.key, 'load', s['load'])
            self._set(lift.key, 'direction', direction)
            self._set(lift.key, 'door', 'Open' if s['door'] > 0 else 'Closed')
            self._set(lift.key, 'mode', 'Normal')
            if moving:
                self._add(lift.key, 'run_hours', self._hours(dt))
            self.electric[lift.key] = 12.0 if moving else 0.6

        # Vehicle chargers: seeded sessions on working days.
        day_number = math.floor(self.now.timestamp() / 86400)
        for i, ch in enumerate(self.b.equipment_of_type('vehicle_charger')):
            enabled = bool(self._get(ch.key, 'enable'))
            session = None
            for s in (0, 1):
                start = (7.5 + 2 * unit(self.seed, 'evc', ch.key, day_number, s) + 0.3 * i) if s == 0 else (13 + 3 * unit(self.seed, 'evc', ch.key, day_number, s))
                length = 2 + 4 * unit(self.seed, 'evc-len', ch.key, day_number, s)
                wanted = s == 0 or unit(self.seed, 'evc-second', ch.key, day_number) < 0.5
                if weekday and wanted and start <= hour < start + length:
                    session = (day_number, s)
                    need = 15 + 25 * unit(self.seed, 'evc-need', ch.key, day_number, s)
            power = 0.0
            if session is not None:
                if session not in self.evc_delivered.setdefault(ch.key, {}):
                    self.evc_delivered[ch.key] = {session: 0.0}
                    self._add(ch.key, 'sessions', 1)
                if enabled and self.evc_delivered[ch.key][session] < need:
                    power = min(self._get(ch.key, 'current_limit') * 230 * 3 / 1000, 22.0)
                    self.evc_delivered[ch.key][session] += power * self._hours(dt)
            state = 'Disabled' if not enabled else 'Charging' if power > 0 else 'Available'
            self._set(ch.key, 'power', power)
            self._state(ch, state)
            self._add(ch.key, 'energy', power * self._hours(dt))
            self.electric[ch.key] = power

        # Solar: follows the sun, limited by its output limit.
        self.generation = 0.0
        for pv in self.b.equipment_of_type('solar_inverter'):
            irradiance = w.sunlight * 1.1
            cell = w.temperature + irradiance * 0.03
            available = PV_KWP * irradiance / 1000 * 0.9 * (1 - 0.004 * (cell - 25))
            limit = PV_KWP * self._get(pv.key, 'output_limit') / 100
            output = max(0.0, min(available, limit))
            producing = irradiance > 20
            voltage = 620 + 40 * irradiance / 1000 if producing else 0.0
            self._set(pv.key, 'output_power', output)
            self._set(pv.key, 'panel_voltage', voltage)
            self._set(pv.key, 'panel_current', output * 1000 / voltage if voltage else 0.0)
            self._set(pv.key, 'temperature', cell)
            self._state(pv, 'Off' if not producing else 'Limited' if available > limit + 0.1 else 'Producing')
            self._add(pv.key, 'energy', output * self._hours(dt))
            self.generation += output

        # Water: use follows the people; the tank refills through the main meter.
        use = sum(self.zone_people.values()) * 0.12 + 15 * self.day.occupancy('kitchen', 'kitchen', self.now)
        shop_use = {}
        for wm in self.b.equipment_of_type('water_meter'):
            if wm.zone:
                flow = self.zone_people.get(wm.zone, 0.0) * 0.2
                shop_use[wm.key] = flow
                self._set(wm.key, 'flow', flow)
                self._add(wm.key, 'volume', flow * dt / 60 / 1000)
        tank = self.b.equipment.get('B1-TNK-1')
        if tank:
            level = self.tank['B1-TNK-1']
            if level < 65:
                self.tank_filling = True
            elif level > 90:
                self.tank_filling = False
            refill = 600.0 if self.tank_filling else 0.0
            level += (refill - use) * dt / 60 / 60_000 * 100
            self.tank['B1-TNK-1'] = clamp(level, 0, 100)
            self._set(tank.key, 'level', self.tank['B1-TNK-1'])
            self._set(tank.key, 'low_level_alarm', self.tank['B1-TNK-1'] < 20)
            self._set(tank.key, 'high_level_alarm', self.tank['B1-TNK-1'] > 98)
            main = self.b.equipment.get('B1-WM-1')
            if main:
                self._set(main.key, 'flow', refill)
                self._add(main.key, 'volume', refill * dt / 60 / 1000)
        for i, bp in enumerate(x for x in self.pumps if x.kind == 'BP'):
            self._pump(bp, dt, use > 1 and (i == 0 or use > 150), 3 + use / 60, 420.0)
        rain_tank = self.b.equipment.get('B2-TNK-1')
        if rain_tank:
            inflow = w.rain * 1440 / 3600  # litres a second from the roof
            level = self.tank['B2-TNK-1'] + (inflow - use * 0.3 / 60) * dt / 40_000 * 100
            self.tank['B2-TNK-1'] = clamp(level, 5, 100)
            self._set(rain_tank.key, 'level', self.tank['B2-TNK-1'])
            self._set(rain_tank.key, 'low_level_alarm', self.tank['B2-TNK-1'] < 10)
            self._set(rain_tank.key, 'high_level_alarm', self.tank['B2-TNK-1'] > 95)
        for sump in self.b.equipment_of_type('sump_pump'):
            if self.pit[sump.key] > 70:
                self.pit_running[sump.key] = True
            elif self.pit[sump.key] < 20:
                self.pit_running[sump.key] = False
            rise = (0.02 + w.rain * 0.01) * dt
            self.pit[sump.key] = clamp(self.pit[sump.key] + rise - (0.5 * dt if self.pit_running[sump.key] else 0), 0, 100)
            self._set(sump.key, 'pit_level', self.pit[sump.key])
            self._set(sump.key, 'status', self.pit_running[sump.key])
            self._set(sump.key, 'high_level_alarm', self.pit[sump.key] > 90)
            if self.pit_running[sump.key]:
                self._add(sump.key, 'run_hours', self._hours(dt))
            self.electric[sump.key] = 1.5 if self.pit_running[sump.key] else 0.0
        for heater in self.b.equipment_of_type('hot_water_heater'):
            setpoint = self._get(heater.key, 'setpoint')
            if self.dhw_t < setpoint - 3:
                self.dhw_heating = True
            elif self.dhw_t >= setpoint:
                self.dhw_heating = False
            draw = use * 0.3
            change = (18_000 / (500 * 4186) if self.dhw_heating else 0.0) - draw / 60 * (self.dhw_t - 15) / 500 - (self.dhw_t - 20) * 0.00002
            self.dhw_t += change * dt
            pump = 6 <= hour < 22
            self._set(heater.key, 'tank_temperature', self.dhw_t)
            self._set(heater.key, 'return_temperature', self.dhw_t - (5 if pump else 12))
            self._set(heater.key, 'effective_setpoint', setpoint)
            self._set(heater.key, 'pump_status', pump)
            self._set(heater.key, 'low_temperature_alarm', self.dhw_t < 50)
            self._add(heater.key, 'energy', (18.0 if self.dhw_heating else 0.0) * self._hours(dt))
            self.electric[heater.key] = (18.0 if self.dhw_heating else 0.0) + (0.4 if pump else 0.0)

        for fire in self.b.equipment_of_type('fire_systems'):
            alarms = [self._get(fire.key, f'fire_alarm_{k.lower()}') for k in ('B2', 'B1', 'G', 'L01', 'L02', 'L03', 'L04', 'L05', 'L06', 'L07', 'L08', 'L09', 'L10', 'RF')]
            self._set(fire.key, 'sprinkler_tank_level', 99.0 + self._noise(f'{fire.key}.tank', 0.3, 3600))
            self._set(fire.key, 'any_fire_alarm', any(alarms))
            self._set(fire.key, 'system_normal', not any(alarms) and not self._get(fire.key, 'panel_fault'))
            self.electric[fire.key] = 0.3

    def _electricity(self, dt: float, w) -> None:
        # Plug loads of each zone, then sum every load up its meter path.
        for z in self.b.zones.values():
            base, extra = PLUG_W_PER_M2.get(z.use, (1.0, 2.0))
            self.electric[z.key] = z.area * (base + extra * self.zone_fraction[z.key]) / 1000
        totals = {node.key: 0.0 for node in self.power_nodes}
        for key, path in self.paths.items():
            kw = self.electric.get(key, 0.0)
            if key in self.b.equipment and self.b.equipment[key].type == 'solar_inverter':
                kw = -self._get(key, 'output_power', 0.0)
            for node in path:
                totals[node] += kw
        main = next((e for e in self.power_nodes if e.type == 'main_electricity_meter'), None)
        generator = (self.b.equipment_of_type('generator') or [None])[0]
        state, source = self.generator_loop.run(dt, self.mains_available, bool(self._get(generator.key, 'test_run_request')) if generator else False)
        for node in self.power_nodes:
            true = totals[node.key]
            measured = true * (1 + 0.002 * smooth(self.seed, (node.key, 'meter'), self.now.timestamp(), 120))
            pf = 0.93 + 0.02 * smooth(self.seed, (node.key, 'pf'), self.now.timestamp(), 1800)
            voltage = 230 + 1.5 * smooth(self.seed, (node.key, 'v'), self.now.timestamp(), 600)
            if node.type == 'main_electricity_meter':
                grid = measured if self.mains_available else 0.0
                self._set(node.key, 'power', grid)
                self._set(node.key, 'reactive_power', grid * math.tan(math.acos(pf)))
                for i, phase in enumerate(('l1', 'l2', 'l3')):
                    v = voltage + 0.8 * smooth(self.seed, (node.key, phase), self.now.timestamp(), 400) if self.mains_available else 0.0
                    self._set(node.key, f'voltage_{phase}', v)
                    self._set(node.key, f'current_{phase}', abs(grid) * 1000 / (3 * 230 * pf) * (1 + 0.03 * (i - 1)) if self.mains_available else 0.0)
                self._set(node.key, 'power_factor', pf)
                self._set(node.key, 'frequency', 50 + 0.02 * smooth(self.seed, 'frequency', self.now.timestamp(), 60) if self.mains_available else 0.0)
                self._add(node.key, 'energy_imported', max(grid, 0.0) * self._hours(dt))
                self._add(node.key, 'energy_exported', max(-grid, 0.0) * self._hours(dt))
            elif node.type == 'electricity_sub_meter':
                self._set(node.key, 'power', max(measured, 0.0))
                self._set(node.key, 'voltage', voltage)
                for i, phase in enumerate(('l1', 'l2', 'l3')):
                    self._set(node.key, f'current_{phase}', max(measured, 0.0) * 1000 / (3 * voltage * pf) * (1 + 0.04 * (i - 1)))
                self._set(node.key, 'power_factor', pf)
                self.peak[node.key] = max(self.peak.get(node.key, 0.0), measured)
                self._set(node.key, 'peak_demand', self.peak[node.key])
                self._add(node.key, 'energy', max(measured, 0.0) * self._hours(dt))
            else:  # transformer
                load = true / 1250 * 100
                ambient = 25.0
                winding = self.tx_winding.get(node.key, ambient + 20)
                winding += (ambient + 75 * (max(load, 0.0) / 100) ** 1.6 - winding) * min(1.0, dt / 1800)
                self.tx_winding[node.key] = winding
                self._set(node.key, 'power', true)
                self._set(node.key, 'load', load)
                self._set(node.key, 'winding_temperature', winding)
                self._set(node.key, 'cooling_fan_status', winding > 95)
                self._set(node.key, 'over_temperature_alarm', winding > 140)
        if generator:
            running = state == 'Running'
            output = (totals.get(main.key, 0.0) if main else 0.0) if source == 'Generator' else 0.0
            self.engine_t += ((85.0 if running else 40.0) - self.engine_t) * min(1.0, dt / 600)
            fuel = self._get(generator.key, 'fuel_level') or 92.0
            if running:
                fuel -= (0.5 + output * 0.3 / 20) / 3600 * dt
                self._add(generator.key, 'run_hours', self._hours(dt))
                self._add(generator.key, 'energy', output * self._hours(dt))
            self._set(generator.key, 'fuel_level', clamp(fuel, 0, 100))
            self._set(generator.key, 'battery_voltage', 27.6 if not running else 28.2)
            self._set(generator.key, 'output_power', output)
            self._set(generator.key, 'voltage', 230.0 if running else 0.0)
            self._set(generator.key, 'frequency', 50.0 if running else 0.0)
            self._set(generator.key, 'engine_temperature', self.engine_t)
            self._set(generator.key, 'oil_pressure', 420.0 if running else 0.0)
            self._set(generator.key, 'status', running)
            self._set(generator.key, 'operating_state', state)
            self._set(generator.key, 'low_fuel_alarm', fuel < 25)
        for ats in self.b.equipment_of_type('transfer_switch'):
            self._set(ats.key, 'source', source)
            self._set(ats.key, 'mains_available', self.mains_available)

    def _sensors(self, w) -> None:
        def sensors(type_name):
            return self.b.equipment_of_type(type_name)
        for s in sensors('office_floor_sensors'):
            ahu_on = self.ahu_running.get(f'{s.level}-AHU-1', False)
            self._set(s.key, 'plant_room_temperature', 24 + 0.15 * (w.temperature - 20) + (1.5 if ahu_on else 0) + self._noise(f'{s.key}.t', 0.2))
        for s in sensors('server_room_sensors'):
            self._set(s.key, 'room_temperature', self.server_t - 3 + self._noise(f'{s.key}.t', 0.1))
            self._set(s.key, 'room_humidity', 45 + self._noise(f'{s.key}.rh', 2, 1800))
        for s in sensors('level_1_sensors'):
            self._set(s.key, 'kitchen_temperature', self.zone_t.get(f'{s.level}-Z7', 24.0) + self._noise(f'{s.key}.t', 0.2))
        for s in sensors('basement_1_sensors'):
            main_kw = self._get('B1-MM-1', 'power', 0.0) or 0.0
            self._set(s.key, 'switchroom_temperature', 24 + main_kw * 0.004 + self._noise(f'{s.key}.sw', 0.2))
            self._set(s.key, 'generator_room_temperature', 20 + 0.3 * (w.temperature - 20) + (12 if self.generator_loop.state == 'Running' else 0) + self._noise(f'{s.key}.gr', 0.2))
            self._set(s.key, 'water_room_temperature', 19 + 0.1 * (w.temperature - 20) + self._noise(f'{s.key}.wr', 0.2))
        for s in sensors('plant_floor_sensors'):
            running = sum(1 for x in self.chillers if self._get(x.key, 'status'))
            self._set(s.key, 'plant_room_temperature', 27 + 0.2 * (w.temperature - 20) + running + self._noise(f'{s.key}.t', 0.2))
        for s in sensors('roof_sensors'):
            moving = sum(1 for x in self.lifts if self._get(x.key, 'direction') != 'Stopped')
            self._set(s.key, 'lift_machine_room_temperature', 26 + 0.8 * moving + 0.2 * (w.temperature - 20) + self._noise(f'{s.key}.t', 0.2))
        for s in sensors('weather_station'):
            self._set(s.key, 'outdoor_temperature', w.temperature)
            self._set(s.key, 'outdoor_humidity', w.humidity)
            self._set(s.key, 'wind_speed', w.wind_speed)
            self._set(s.key, 'wind_direction', w.wind_direction)
            self._set(s.key, 'sunlight', w.sunlight)
            self._set(s.key, 'rain', w.rain)
