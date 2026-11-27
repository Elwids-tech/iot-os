"""Load the building model file and build its levels, zones, equipment and points.

The model file (buildings/example-tower.yaml) is the only definition of the building.
`build(load(), 'standard')` gives the part the simulator runs at that size, with every
key made absolute (`L03-VAV-2`, `L03-VAV-2.zone_temperature`) and every position in
metres from the building's south-west corner at ground level.
"""
from __future__ import annotations

import argparse
import functools
import json
import pathlib
import re
import sys
from dataclasses import dataclass, field

import yaml
from jsonschema import Draft202012Validator

HERE = pathlib.Path(__file__).resolve().parent
MODEL_FILE = HERE / 'buildings' / 'example-tower.yaml'
SCHEMA_FILE = HERE / 'buildings' / 'building.schema.json'
SIZES = ('standard', 'tower', 'large')
LEVEL_KEY = re.compile(r'^(B[0-9]|G|L[0-9]{2}|RF)$')
MEDIA = ('power', 'air', 'water', 'chilled_water', 'condenser_water', 'heating_water')


class ModelError(ValueError):
    """The model file is not a valid building."""


@dataclass
class Level:
    key: str
    name: str
    floor_z: float
    height: float
    plan: str
    zones: list[str] = field(default_factory=list)
    rooms: list[dict] = field(default_factory=list)
    equipment: list[str] = field(default_factory=list)


@dataclass
class Zone:
    key: str
    level: str
    name: str
    kind: str
    use: str
    facade: str | None
    outline: list[list[float]]
    fed_by: dict[str, list[str]]

    @functools.cached_property
    def area(self) -> float:
        return polygon_area(self.outline)

    @functools.cached_property
    def centre(self) -> tuple[float, float]:
        xs = [p[0] for p in self.outline]
        ys = [p[1] for p in self.outline]
        return (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2

    @functools.cached_property
    def facade_length(self) -> float:
        xs = [p[0] for p in self.outline]
        ys = [p[1] for p in self.outline]
        if self.facade in ('north', 'south'):
            return max(xs) - min(xs)
        if self.facade in ('east', 'west'):
            return max(ys) - min(ys)
        return 0.0


@dataclass
class Point:
    key: str  # <equipment>.<point>
    equipment: str
    short: str  # the point's own key
    spec: dict
    name: str
    description: str
    position: tuple[float, float, float] | None = None

    @property
    def kind(self) -> str:
        return self.spec['kind']

    @property
    def type(self) -> str:
        return self.spec['type']

    @property
    def writable(self) -> bool:
        return self.spec['kind'] == 'command'


@dataclass
class Equipment:
    key: str
    type: str
    type_name: str
    kind: str
    name: str
    level: str
    zone: str | None
    room: str | None
    group: str | None
    position: tuple[float, float, float]
    facing: float
    footprint: tuple[float, float, float] | None
    area: float | None
    fed_by: dict[str, list[str]]
    sensor: tuple[float, float, float] | None
    sensors: list[tuple[float, float, float]]
    points: list[str] = field(default_factory=list)


@dataclass
class Building:
    size: str
    site: dict
    info: dict
    levels: dict[str, Level]
    zones: dict[str, Zone]
    equipment: dict[str, Equipment]
    points: dict[str, Point]
    library: dict
    # Power feeds of every equipment item in the model, including the ones that do not
    # run at this size, so a meter chain can be followed through them.
    power_feeds: dict[str, list[str]] = field(default_factory=dict)

    def equipment_of_type(self, *types: str) -> list[Equipment]:
        if not hasattr(self, '_by_type'):
            self._by_type = {}
            for item in self.equipment.values():
                self._by_type.setdefault(item.type, []).append(item)
        return [e for t in types for e in self._by_type.get(t, [])] if len(types) > 1 else list(self._by_type.get(types[0], []))

    def totals(self) -> dict:
        commands = sum(1 for p in self.points.values() if p.writable)
        return {'levels': len(self.levels), 'points': len(self.points), 'commands': commands, 'devices': len(self.equipment)}


def load(path: pathlib.Path | str = MODEL_FILE) -> dict:
    """Read the model file and check it against its schema and its own references."""
    with open(path, encoding='utf-8') as handle:
        data = yaml.safe_load(handle)
    schema = json.loads(SCHEMA_FILE.read_text(encoding='utf-8'))
    errors = sorted(Draft202012Validator(schema).iter_errors(data), key=lambda e: list(e.absolute_path))
    if errors:
        first = errors[0]
        where = '/'.join(str(part) for part in first.absolute_path) or '(top)'
        raise ModelError(f'{path}: {where}: {first.message}')
    build(data, 'large')  # resolves every reference of the largest size, or raises
    return data


def build(data: dict, size: str = 'standard') -> Building:
    """The levels, zones, equipment and points that run at a size."""
    if size not in SIZES:
        raise ModelError(f'unknown size {size!r}; choose one of {", ".join(SIZES)}')
    library = data['library']
    sizing = data['sizes'][size]
    level_specs = [dict(spec) for spec in data['levels']]
    added = sizing.get('add_office_levels')
    if added:
        for n in range(added['from'], added['to'] + 1):
            level_specs.append({'key': f'L{n:02d}', 'name': f'Level {n}', 'height': added['height'], 'plan': added['plan'],
                                'floor_z': added['first_floor_z'] + added['height'] * (n - added['from'])})
    for key, moved in (sizing.get('move') or {}).items():
        for spec in level_specs:
            if spec['key'] == key:
                spec['floor_z'] = moved['floor_z']
    level_specs.sort(key=lambda spec: spec['floor_z'])
    all_level_keys = {spec['key'] for spec in level_specs}
    if len(all_level_keys) != len(level_specs):
        raise ModelError('level keys must be unique')

    levels: dict[str, Level] = {}
    zones: dict[str, Zone] = {}
    equipment: dict[str, Equipment] = {}
    for spec in level_specs:
        plan = data['plans'].get(spec['plan'])
        if plan is None:
            raise ModelError(f'level {spec["key"]} names unknown plan {spec["plan"]!r}')
        level = Level(spec['key'], spec['name'], float(spec['floor_z']), float(spec['height']), spec['plan'])
        levels[level.key] = level
        overrides = {z['key']: z for z in spec.get('zones', [])}
        plan_zones = {z['key'] for z in plan.get('zones', [])}
        for unknown in set(overrides) - plan_zones:
            raise ModelError(f'level {level.key} overrides unknown zone {unknown}')
        for z in plan.get('zones', []):
            key = f'{level.key}-{z["key"]}'
            outline = overrides.get(z['key'], z)['outline']
            zones[key] = Zone(key, level.key, z['name'], z['kind'], z['use'], z.get('facade'), outline,
                              _feeds(z.get('fed_by'), level.key, all_level_keys))
            level.zones.append(key)
        level.rooms = [dict(r, key=f'{level.key}-{r["key"]}') for r in plan.get('rooms', []) + spec.get('rooms', [])]
        room_keys = {r['key'] for r in level.rooms}
        for e in plan['equipment'] + spec.get('equipment', []):
            item = _equipment(e, level, library, all_level_keys, room_keys)
            if item.key in equipment:
                raise ModelError(f'equipment key {item.key} is used twice')
            if item.zone and item.zone not in zones:
                raise ModelError(f'{item.key} is in unknown zone {item.zone}')
            equipment[item.key] = item
            level.equipment.append(item.key)

    for item in equipment.values():
        for medium, refs in item.fed_by.items():
            for ref in refs:
                if ref not in equipment:
                    raise ModelError(f'{item.key} is fed {medium} by unknown equipment {ref}')
    for zone in zones.values():
        for refs in zone.fed_by.values():
            for ref in refs:
                if ref not in equipment:
                    raise ModelError(f'zone {zone.key} is fed by unknown equipment {ref}')
    for item in equipment.values():
        if item.type == 'lighting_zone' and not item.zone and not item.area:
            raise ModelError(f'{item.key} lights no zone, so it needs an area')

    # Keep what runs at this size.
    keep_levels = list(levels) if sizing['levels'] == 'all' else list(sizing['levels'])
    for key in keep_levels:
        if key not in levels:
            raise ModelError(f'size {size} names unknown level {key}')
    keep_equipment = {k for k in sizing.get('equipment', [])}
    for key in keep_equipment:
        if key not in equipment:
            raise ModelError(f'size {size} names unknown equipment {key}')
    kept_levels = {k: levels[k] for k in levels if k in keep_levels}
    for key in keep_equipment:
        owner = equipment[key].level
        if owner not in kept_levels:
            kept_levels[owner] = Level(levels[owner].key, levels[owner].name, levels[owner].floor_z, levels[owner].height,
                                       levels[owner].plan, [], levels[owner].rooms, [])
    for key, level in kept_levels.items():
        if key not in keep_levels:
            level.equipment = [e for e in levels[key].equipment if e in keep_equipment]
    kept_levels = dict(sorted(kept_levels.items(), key=lambda item: item[1].floor_z))
    kept_equipment = {k: e for k, e in equipment.items() if e.level in keep_levels or k in keep_equipment}
    kept_zones = {k: z for k, z in zones.items() if z.level in keep_levels}

    points: dict[str, Point] = {}
    for item in kept_equipment.values():
        level = kept_levels[item.level]
        zone = kept_zones.get(item.zone) if item.zone else None
        for spec, n in _point_specs(library[item.type], item):
            short = spec['key'].format(n=n) if n else spec['key']
            key = f'{item.key}.{short}'
            name = spec['name'].format(n=n) if n else spec['name']
            where = zone.name if zone else level.name
            description = spec.get('description') or f'{name} of {item.name}, {where} ({item.key})'
            position = None
            if n:
                position = item.sensors[n - 1]
            elif spec.get('at') == 'wall' and item.sensor:
                position = item.sensor
            elif spec.get('at') == 'ceiling' and zone:
                cx, cy = zone.centre
                position = (cx, cy, round(level.floor_z + level.height - 0.05, 3))
            points[key] = Point(key, item.key, short, spec, name, description, position)
            item.points.append(key)
    power_feeds = {k: e.fed_by.get('power', []) for k, e in equipment.items()}
    return Building(size, data['site'], data['building'], kept_levels, kept_zones, kept_equipment, points, library, power_feeds)


def export(building: Building) -> dict:
    """The building at its size as plain JSON, for other tools (`--export-model`)."""
    return {
        'schema_version': 'bms-building-export.v1',
        'size': building.size,
        'site': building.site,
        'building': building.info,
        'totals': building.totals(),
        'levels': [{'key': l.key, 'name': l.name, 'floor_z': l.floor_z, 'height': l.height, 'zones': l.zones,
                    'rooms': l.rooms, 'equipment': l.equipment} for l in building.levels.values()],
        'zones': [{'key': z.key, 'level': z.level, 'name': z.name, 'kind': z.kind, 'use': z.use, 'facade': z.facade,
                   'outline': z.outline, 'area': round(z.area, 2)} for z in building.zones.values()],
        'equipment': [{'key': e.key, 'type': e.type, 'type_name': e.type_name, 'kind': e.kind, 'name': e.name,
                       'level': e.level, 'zone': e.zone, 'room': e.room, 'group': e.group, 'position': e.position,
                       'facing': e.facing, 'footprint': e.footprint, 'fed_by': e.fed_by, 'points': e.points}
                      for e in building.equipment.values()],
        'points': [{'key': p.key, 'equipment': p.equipment, 'name': p.name, 'description': p.description,
                    'kind': p.kind, 'type': p.type, 'unit': p.spec.get('unit'), 'range': p.spec.get('range'),
                    'states': p.spec.get('states'), 'command': p.spec.get('command'), 'limits': p.spec.get('limits'),
                    'default': p.spec.get('default'), 'brick': p.spec.get('brick'), 'position': p.position}
                   for p in building.points.values()],
    }


def polygon_area(outline: list[list[float]]) -> float:
    total = 0.0
    for (x1, y1), (x2, y2) in zip(outline, outline[1:] + outline[:1]):
        total += x1 * y2 - x2 * y1
    return abs(total) / 2


def _point_specs(type_spec: dict, item: Equipment):
    for spec in type_spec['points']:
        yield spec, None
    per_sensor = type_spec.get('per_sensor')
    if per_sensor:
        if not item.sensors:
            raise ModelError(f'{item.key} is a {type_spec["name"]} and needs its sensors listed')
        for n in range(1, len(item.sensors) + 1):
            for spec in per_sensor:
                yield spec, n


def _resolve(ref: str, level: str, level_keys: set[str]) -> str:
    head = ref.split('-', 1)[0]
    return ref if LEVEL_KEY.match(head) and head in level_keys else f'{level}-{ref}'


def _feeds(spec: dict | None, level: str, level_keys: set[str]) -> dict[str, list[str]]:
    feeds = {}
    for medium, refs in (spec or {}).items():
        refs = [refs] if isinstance(refs, str) else refs
        feeds[medium] = [_resolve(ref, level, level_keys) for ref in refs]
    return feeds


def _equipment(spec: dict, level: Level, library: dict, level_keys: set[str], room_keys: set[str]) -> Equipment:
    type_spec = library.get(spec['type'])
    if type_spec is None:
        raise ModelError(f'{level.key}-{spec["key"]} has unknown type {spec["type"]!r}')
    if LEVEL_KEY.match(spec['key'].split('-', 1)[0]):
        raise ModelError(f'{spec["key"]}: keys inside a plan or level are written without the level')
    key = f'{level.key}-{spec["key"]}'
    kind = spec['key'].rsplit('-', 1)[0]
    if type_spec.get('kind') and type_spec['kind'] != kind:
        raise ModelError(f'{key} is a {type_spec["name"]}, whose key kind is {type_spec["kind"]}')
    room = f'{level.key}-{spec["room"]}' if spec.get('room') else None
    if room and room not in room_keys:
        raise ModelError(f'{key} is in unknown room {room}')
    x, y, z = spec['at']
    footprint = spec.get('footprint') or type_spec.get('footprint')
    zone = f'{level.key}-{spec["zone"]}' if spec.get('zone') else None
    name = spec.get('name') or type_spec['name']
    sensor = spec.get('sensor')
    return Equipment(
        key=key, type=spec['type'], type_name=type_spec['name'], kind=kind, name=name, level=level.key, zone=zone,
        room=room, group=spec.get('group'), position=(x, y, round(level.floor_z + z, 3)), facing=float(spec.get('facing', 0)),
        footprint=tuple(footprint) if footprint else None, area=spec.get('area'),
        fed_by=_feeds(spec.get('fed_by'), level.key, level_keys),
        sensor=(sensor[0], sensor[1], round(level.floor_z + sensor[2], 3)) if sensor else None,
        sensors=[(s[0], s[1], round(level.floor_z + s[2], 3)) for s in spec.get('sensors', [])],
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Check the building model file and print it as JSON.')
    parser.add_argument('--size', choices=SIZES, default='standard')
    parser.add_argument('--model', default=str(MODEL_FILE))
    parser.add_argument('--totals', action='store_true', help='print only the totals')
    args = parser.parse_args(argv)
    try:
        building = build(load(args.model), args.size)
    except ModelError as error:
        print(f'model error: {error}', file=sys.stderr)
        return 1
    print(json.dumps(building.totals() if args.totals else export(building), indent=2, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
