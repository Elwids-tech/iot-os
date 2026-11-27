"""Each controller's own loop, and the rules a command write must pass.

The connector of spec 038 only reads, but the building runs itself the way its local
controllers would, and its command points behave like a real server's: a supervisory
system asks for an outcome (a setpoint, a mode, a request) and the equipment's own loop
moves the damper or valve.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

from .dynamics import clamp

GOOD = 'Good'
OUT_OF_RANGE = 'BadOutOfRange'
TYPE_MISMATCH = 'BadTypeMismatch'
NOT_WRITABLE = 'BadNotWritable'
ACCESS_DENIED = 'BadUserAccessDenied'


def check_write(spec: dict, value):
    """Whether a value may be written to a point: (status, the value as stored).

    A state may be given by its index (as OPC UA carries it) or by its label.
    """
    if spec.get('kind') != 'command':
        return NOT_WRITABLE, None
    kind = spec['type']
    if kind == 'number':
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            return TYPE_MISMATCH, None
        low, high = spec['limits']
        if not low <= value <= high:
            return OUT_OF_RANGE, None
        return GOOD, float(value)
    if kind == 'boolean':
        if not isinstance(value, bool):
            return TYPE_MISMATCH, None
        return GOOD, value
    if kind == 'state':
        states = spec['states']
        if isinstance(value, bool):
            return TYPE_MISMATCH, None
        if isinstance(value, int):
            if not 0 <= value < len(states):
                return OUT_OF_RANGE, None
            return GOOD, states[value]
        if isinstance(value, str):
            if value not in states:
                return OUT_OF_RANGE, None
            return GOOD, value
        return TYPE_MISMATCH, None
    return NOT_WRITABLE, None


class PI:
    """A proportional-integral loop with an output between `low` and `high`."""

    def __init__(self, kp: float, ki: float, low: float = 0.0, high: float = 1.0):
        self.kp, self.ki, self.low, self.high = kp, ki, low, high
        self.integral = 0.0

    def update(self, error: float, dt: float) -> float:
        candidate = self.integral + self.ki * error * dt
        output = self.kp * error + candidate
        # Stop integrating while the output is pinned and the error would push it further.
        if (output > self.high and error > 0) or (output < self.low and error < 0):
            output = self.kp * error + self.integral
        else:
            self.integral = clamp(candidate, self.low, self.high)
        return clamp(output, self.low, self.high)

    def reset(self) -> None:
        self.integral = 0.0


@dataclass
class ZoneBoxOutput:
    cooling: float  # 0..1 of the box's range above its minimum airflow
    heating: float  # 0..1 of the reheat valve
    effective_setpoint: float
    state: str


class ZoneBoxLoop:
    """Moves the damper, then the reheat valve, to hold the effective setpoint; widens
    the setpoint by 3 °C either way when the zone is unoccupied."""

    UNOCCUPIED_WIDENING = 3.0
    HEATING_BELOW = 0.5

    def __init__(self, reheat: bool):
        self.reheat = reheat
        self.cool = PI(0.6, 0.004)
        self.heat = PI(0.5, 0.003)

    def run(self, dt: float, temperature: float, setpoint: float, occupied: bool, air_available: bool) -> ZoneBoxOutput:
        widen = 0.0 if occupied else self.UNOCCUPIED_WIDENING
        cooling_setpoint = setpoint + widen
        heating_setpoint = setpoint - (widen or self.HEATING_BELOW)
        effective = setpoint if occupied else (cooling_setpoint if temperature >= setpoint else heating_setpoint)
        if not air_available:
            self.cool.reset()
            self.heat.reset()
            return ZoneBoxOutput(0.0, 0.0, effective, 'Deadband' if occupied else 'Unoccupied')
        cooling = self.cool.update(temperature - cooling_setpoint, dt)
        heating = self.heat.update(heating_setpoint - temperature, dt) if self.reheat else 0.0
        if cooling > 0.02:
            heating = 0.0
            self.heat.reset()
        if cooling > 0.02:
            state = 'Cooling'
        elif heating > 0.02:
            state = 'Heating'
        else:
            state = 'Deadband' if occupied else 'Unoccupied'
        return ZoneBoxOutput(cooling, heating, effective, state)


class FanCoilLoop:
    """Holds a room at its setpoint with one valve, cooling or heating by mode."""

    LOW_LIMIT = 15.0

    def __init__(self):
        self.loop = PI(0.5, 0.003)

    def run(self, dt: float, temperature: float, setpoint: float, mode: str, open_hours: bool) -> tuple[float, float, str]:
        """(valve 0..1 with sign: + cooling, - heating, fan speed 0..1, operating state)."""
        if mode == 'Off':
            self.loop.reset()
            return 0.0, 0.0, 'Off'
        if mode == 'Auto' and not open_hours:
            # Out of hours only the low limit runs: heat while the room is below 15 °C.
            if temperature < self.LOW_LIMIT:
                demand = self.loop.update(self.LOW_LIMIT + 1 - temperature, dt)
                return -demand, 0.3 + 0.7 * demand, 'Heating'
            self.loop.reset()
            return 0.0, 0.0, 'Off'
        if mode == 'Fan only':
            return 0.0, 0.3, 'Fan only'
        error = temperature - setpoint
        if mode == 'Cool' or (mode == 'Auto' and error > -0.5):
            demand = self.loop.update(error, dt)
            return demand, 0.3 + 0.7 * demand, 'Cooling' if demand > 0.02 else 'Fan only'
        demand = self.loop.update(-error, dt)
        return -demand, 0.3 + 0.7 * demand, 'Heating' if demand > 0.02 else 'Fan only'


@dataclass
class AirHandlingDecision:
    running: bool
    state: str
    outdoor_air: float  # damper 0..100
    cooling_allowed: bool


class AirHandlingUnitLoop:
    """Follows the floor's schedule, opens outdoor air with carbon dioxide and purges
    at night when outside is cool."""

    WARM_UP_HOURS = 2.0

    def run(self, mode: str, scheduled: bool, override: bool, hour: float, outdoor: float, zone_mean: float,
            return_co2: float, minimum_outdoor_air: float, purge_season: bool,
            starts_in: float | None = None, warm_up_below: float | None = None) -> AirHandlingDecision:
        """`starts_in` is the hours until the schedule's next start; the unit warms the
        floor up on recirculated air before it when the zones are below `warm_up_below`."""
        if mode == 'Off':
            return AirHandlingDecision(False, 'Off', 0.0, False)
        occupied = mode == 'On' or scheduled or override
        if occupied:
            damper = minimum_outdoor_air
            if return_co2 > 700:  # demand ventilation: fully open by 1,000 ppm
                damper += (return_co2 - 700) / 300 * (100 - minimum_outdoor_air)
            if 12 < outdoor < zone_mean - 2:  # free cooling from outside air
                damper = 100.0
            return AirHandlingDecision(True, 'Occupied', clamp(damper, 0, 100), True)
        if starts_in is not None and 0 < starts_in <= self.WARM_UP_HOURS and warm_up_below is not None and zone_mean < warm_up_below:
            return AirHandlingDecision(True, 'Warm-up', 0.0, False)
        if purge_season and 2 <= hour < 6 and outdoor < 18 and zone_mean > 22 and zone_mean - outdoor > 3:
            return AirHandlingDecision(True, 'Night purge', 100.0, False)
        return AirHandlingDecision(False, 'Unoccupied', 0.0, False)


class StagingLoop:
    """Starts and stops units of a plant with its load: one more when the running ones
    pass `up` of their capacity for `up_delay` seconds, one fewer when the rest could
    carry the load under `down` of theirs for `down_delay` seconds."""

    def __init__(self, capacity: float, up: float = 0.9, down: float = 0.6, up_delay: float = 120, down_delay: float = 300,
                 start_load: float = 20.0, stop_delay: float = 600, duty: int = 2):
        self.capacity, self.up, self.down = capacity, up, down
        self.up_delay, self.down_delay, self.start_load, self.stop_delay, self.duty = up_delay, down_delay, start_load, stop_delay, duty
        self.stages = 0
        self._timer = 0.0
        self._direction = 0

    def run(self, dt: float, load: float, enabled: bool) -> int:
        if not enabled:
            self.stages, self._timer, self._direction = 0, 0.0, 0
            return 0
        want = 0
        if self.stages == 0:
            want = 1 if load > self.start_load else 0
            delay = 30.0
        elif load > self.up * self.stages * self.capacity and self.stages < self.duty:
            want, delay = 1, self.up_delay
        elif self.stages > 1 and load < self.down * (self.stages - 1) * self.capacity:
            want, delay = -1, self.down_delay
        elif self.stages == 1 and load < self.start_load / 2:
            want, delay = -1, self.stop_delay
        else:
            delay = 0.0
        if want != self._direction:
            self._direction, self._timer = want, 0.0
        if want:
            self._timer += dt
            if self._timer >= delay:
                self.stages = max(0, self.stages + want)
                self._timer, self._direction = 0.0, 0
        return self.stages


def lead_order(lead: int, available: list[bool]) -> list[int]:
    """Unit indexes from the lead onwards, skipping the ones that cannot run."""
    n = len(available)
    return [i % n for i in range(lead, lead + n) if available[i % n]]


class RoomCoolingLoop:
    """A room cooling unit's output, holding its return air at the setpoint."""

    def __init__(self):
        self.loop = PI(0.25, 0.002, low=-0.5, high=0.5)

    def run(self, dt: float, return_air: float, setpoint: float, base_fraction: float) -> float:
        """`base_fraction` is the share of the room's heat this unit is expected to
        carry; the loop trims it to hold the setpoint."""
        return clamp(base_fraction + self.loop.update(return_air - setpoint, dt), 0.0, 1.0)


def car_park_fan_speed(highest_co: float, setpoint: float) -> float:
    """Fans run faster as carbon monoxide rises: off below 40% of the setpoint, then
    from 30% up to full speed at the setpoint."""
    start = 0.4 * setpoint
    if highest_co <= start:
        return 0.0
    return clamp(30 + 70 * (highest_co - start) / max(setpoint - start, 1e-6), 30, 100)


def lighting_level(mode: str, level: float, occupied: bool, daylight: float, target: float = 500.0, design: float = 600.0) -> float:
    """In auto: on with occupancy, dimmed against daylight to reach the target."""
    if mode == 'Off':
        return 0.0
    if mode == 'On':
        return level
    if not occupied:
        return 0.0
    needed = max(0.0, target - daylight)
    return clamp(needed / design * 100, 10.0, 100.0)


def blind_target(mode: str, position_setpoint: float, direct_sun: float) -> float:
    """In auto: lowered when direct sun falls on the façade."""
    if mode == 'Manual':
        return position_setpoint
    return 100.0 if direct_sun > 250 else 0.0


class GeneratorLoop:
    """The generator starts and takes the load when the mains fail, and runs a test on
    request; the transfer switch follows it."""

    START = 10.0  # seconds to reach speed
    COOL_DOWN = 120.0

    def __init__(self):
        self.state = 'Off'
        self._timer = 0.0

    def run(self, dt: float, mains_available: bool, test_request: bool, fault: bool = False) -> tuple[str, str]:
        """(generator operating state, transfer switch source)."""
        wanted = (not mains_available or test_request) and not fault
        if fault:
            self.state = 'Fault'
        elif wanted and self.state in ('Off', 'Cooling down', 'Fault'):
            self.state, self._timer = 'Starting', 0.0
        elif self.state == 'Starting':
            self._timer += dt
            if self._timer >= self.START:
                self.state = 'Running'
        elif not wanted and self.state == 'Running':
            self.state, self._timer = 'Cooling down', 0.0
        elif self.state == 'Cooling down':
            self._timer += dt
            if self._timer >= self.COOL_DOWN:
                self.state = 'Off'
        source = 'Generator' if not mains_available and self.state == 'Running' else 'Mains'
        return self.state, source
