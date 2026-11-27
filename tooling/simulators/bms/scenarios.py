"""The named faults of the simulator contract, switchable at run time.

Each scenario takes an optional target (a piece of equipment, a point, a level or a
number of seconds) and has a default that exists at the standard size where it can.
Building scenarios act on the physics; server scenarios (a restart, a new certificate,
a wrong clock, one session only, slow browsing) call hooks the server provides.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

ZONE_BOXES = ('zone_box_reheat', 'zone_box_cooling', 'zone_box_core')
METERS = ('electricity_sub_meter', 'main_electricity_meter', 'water_meter')


class ScenarioError(ValueError):
    """The scenario or its target does not exist here."""


@dataclass(frozen=True)
class Scenario:
    name: str
    title: str
    effect: str
    target: str | None  # what the target names, or None
    default: str | float | None = None
    momentary: bool = False  # happens once when switched on, and is not kept on


CATALOGUE = [
    Scenario('damper_stuck', 'Damper stuck', "One zone's damper holds its position; the zone drifts off setpoint.", 'zone box', 'L03-VAV-2'),
    Scenario('filter_alarm', 'Filter alarm', "An air handling unit's filter pressure rises until its alarm is on.", 'air handling unit', 'L03-AHU-1'),
    Scenario('chiller_trip', 'Chiller trip', 'A chiller faults; chilled water warms; the next chiller stages on.', 'chiller', None),
    Scenario('controller_offline', 'Controller offline', "One zone controller's points turn bad with no communication.", 'equipment', 'L03-VAV-2'),
    Scenario('sensor_failure', 'Sensor failure', 'One point turns bad with a failed sensor.', 'point', 'L03-VAV-2.zone_temperature'),
    Scenario('uncertain_value', 'Uncertain value', 'One point reports its last usable value as uncertain.', 'point', 'L03-VAV-3.zone_temperature'),
    Scenario('server_restart', 'Server restart', 'The server stops for a given time, then starts again.', 'seconds', 30.0, momentary=True),
    Scenario('certificate_changed', 'Certificate changed', 'The server restarts with a new certificate.', None, momentary=True),
    Scenario('clock_wrong', 'Clock wrong', 'Source times run a given offset ahead (or behind, negative).', 'seconds', 600.0),
    Scenario('meter_replaced', 'Meter replaced', "A meter's total starts again from zero.", 'meter', 'L03-EM-1', momentary=True),
    Scenario('session_limit', 'Session limit', 'The server accepts one session only.', None),
    Scenario('slow_browse', 'Slow browse', 'Browse answers are delayed by a given time.', 'seconds', 3.0),
    Scenario('hand_mode', 'Hand mode', 'One item is switched to hand at its panel; writes to it are accepted and ignored.', 'equipment', 'L03-AHU-1'),
    Scenario('power_outage', 'Power outage', 'The mains fail; the generator starts and takes the load; the supply runs on battery until then.', None),
    Scenario('water_leak', 'Water leak', "A leak detector turns on and the building's water flow rises.", 'level', 'L03'),
    Scenario('car_park_co', 'Car park carbon monoxide', 'Carbon monoxide rises on one car park level; its fans speed up.', 'car park level', 'B1'),
    Scenario('lift_fault', 'Lift fault', 'One lift goes out of service.', 'lift', 'G-LIFT-1'),
    Scenario('fire_alarm', 'Fire alarm', "One level's fire alarm turns on; its air handling unit stops.", 'level', 'L03'),
]
BY_NAME = {s.name: s for s in CATALOGUE}
SERVER_SCENARIOS = ('server_restart', 'certificate_changed', 'clock_wrong', 'session_limit', 'slow_browse')
CHILLER_ALARM = 'E-217 Low refrigerant pressure'


class Scenarios:
    """The scenarios in force on one simulated building."""

    def __init__(self, physics, hooks: dict[str, Callable] | None = None):
        self.physics = physics
        self.hooks = hooks or {}
        self.active: dict[str, object] = {}

    # What the control port and the controls page show -------------------------------

    def catalogue(self) -> list[dict]:
        return [{'name': s.name, 'title': s.title, 'effect': s.effect, 'target': s.target,
                 'default': self._default(s), 'momentary': s.momentary, 'on': s.name in self.active,
                 'in_force': self.active.get(s.name)} for s in CATALOGUE]

    def state(self) -> dict:
        return dict(self.active)

    # Switching -----------------------------------------------------------------------

    def switch(self, name: str, on: bool, target=None):
        """Switch a scenario on or off; returns the target in force (None when off)."""
        scenario = BY_NAME.get(name)
        if scenario is None:
            raise ScenarioError(f'There is no scenario called {name!r}.')
        if not on:
            if name in self.active:
                self._apply(scenario, False, self.active.pop(name))
            return None
        target = self._target(scenario, target)
        if name in self.active and self.active[name] != target:
            self._apply(scenario, False, self.active.pop(name))
        self._apply(scenario, True, target)
        if not scenario.momentary:
            self.active[name] = target
        return target

    def clear(self) -> None:
        for name in list(self.active):
            self.switch(name, False)

    # Targets -------------------------------------------------------------------------

    def _default(self, scenario: Scenario):
        if scenario.name == 'chiller_trip':
            chillers = self.physics.b.equipment_of_type('chiller')
            running = [c.key for c in chillers if self.physics.values.get(f'{c.key}.status')]
            return (running or [c.key for c in chillers] or [None])[0]
        default = scenario.default
        if isinstance(default, str) and not self._exists(scenario, default):
            return None
        return default

    def _exists(self, scenario: Scenario, target: str) -> bool:
        try:
            self._check(scenario, target)
        except ScenarioError:
            return False
        return True

    def _target(self, scenario: Scenario, target):
        if scenario.target is None:
            return True
        if target in (None, ''):
            target = self._default(scenario)
            if target is None:
                raise ScenarioError(f'{scenario.title} has nothing to act on at the {self.physics.b.size} size; name a target or run a larger size.')
        if scenario.target == 'seconds':
            if isinstance(target, bool) or not isinstance(target, (int, float, str)):
                raise ScenarioError(f'{scenario.title} takes a number of seconds.')
            try:
                seconds = float(target)
            except ValueError:
                raise ScenarioError(f'{scenario.title} takes a number of seconds.') from None
            low = -86400 if scenario.name == 'clock_wrong' else 0
            if not low <= seconds <= 86400:
                raise ScenarioError(f'{scenario.title} takes between {low} and 86400 seconds.')
            return seconds
        if not isinstance(target, str):
            raise ScenarioError(f'{scenario.title} takes the key of a {scenario.target}.')
        self._check(scenario, target)
        return target

    def _check(self, scenario: Scenario, target: str) -> None:
        b = self.physics.b
        kind = scenario.target
        if kind == 'point':
            if target not in b.points:
                raise ScenarioError(f'There is no point {target} at this size.')
            return
        if kind in ('level', 'car park level'):
            if target not in b.levels:
                raise ScenarioError(f'There is no level {target} at this size.')
            if kind == 'car park level' and not any(e.type == 'car_park_ventilation' and e.level == target for e in b.equipment.values()):
                raise ScenarioError(f'{target} has no car park.')
            return
        item = b.equipment.get(target)
        if item is None:
            raise ScenarioError(f'There is no equipment {target} at this size.')
        wanted = {'zone box': ZONE_BOXES, 'air handling unit': ('air_handling_unit',), 'chiller': ('chiller',),
                  'meter': METERS, 'lift': ('lift',)}.get(kind)
        if wanted and item.type not in wanted:
            raise ScenarioError(f'{target} is not a {kind}.')

    # Effects -------------------------------------------------------------------------

    def _apply(self, scenario: Scenario, on: bool, target) -> None:
        p = self.physics
        name = scenario.name
        if name in SERVER_SCENARIOS:
            hook = self.hooks.get(name)
            if hook is None:
                raise ScenarioError(f'{scenario.title} needs the OPC UA server.')
            hook(on, target)
            return
        if name == 'damper_stuck':
            _toggle(p.stuck, target, on)
        elif name == 'filter_alarm':
            _toggle(p.clogging, target, on)
            if not on:
                p.ahu_filter[target] = 90.0  # a clean filter fitted
        elif name == 'chiller_trip':
            p.values[f'{target}.fault'] = on
            p.values[f'{target}.alarm_code'] = CHILLER_ALARM if on else ''
        elif name == 'controller_offline':
            self._quality(p.b.equipment[target].points, on, 'BadNoCommunication')
        elif name == 'sensor_failure':
            self._quality([target], on, 'BadSensorFailure')
        elif name == 'uncertain_value':
            self._quality([target], on, 'UncertainLastUsableValue')
        elif name == 'meter_replaced':
            for point in p.b.equipment[target].points:
                if p.b.points[point].kind == 'total':
                    p.values[point] = 0.0
        elif name == 'hand_mode':
            _toggle(p.hand, target, on)
        elif name == 'power_outage':
            p.mains_available = not on
        elif name == 'water_leak':
            _toggle(p.leaks, target, on)
        elif name == 'car_park_co':
            _toggle(p.fumes, target, on)
        elif name == 'lift_fault':
            _toggle(p.out_of_service, target, on)
        elif name == 'fire_alarm':
            _toggle(p.fires, target, on)

    def _quality(self, points, on: bool, quality: str) -> None:
        p = self.physics
        values = p.read()
        for point in points:
            if on:
                p.qualities[point] = quality
                p.frozen[point] = values[point]  # the last value it had
            else:
                p.qualities.pop(point, None)
                p.frozen.pop(point, None)


def _toggle(items: set, item, on: bool) -> None:
    if on:
        items.add(item)
    else:
        items.discard(item)
