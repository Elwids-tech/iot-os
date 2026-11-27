"""The two naming styles of the simulator, two spellings of the same keys.

structured  Example Campus / Example Tower / Level 3 / East / L03-VAV-2 / zone_temperature
flat        one folder of vendor-style tags: ET_L03_VAV_2.ZN-T

A flat tag is the building key, the equipment key with underscores, and the point's
abbreviated name, the way many BMS servers name their points.
"""
from __future__ import annotations

from .model import Building

STYLES = ('structured', 'flat')

# Words a BMS vendor abbreviates; anything else keeps its first three letters.
WORDS = {
    'zone': 'ZN', 'temperature': 'T', 'supply': 'S', 'return': 'R', 'air': 'A', 'mixed': 'M', 'outdoor': 'OA',
    'intake': 'IN', 'discharge': 'D', 'humidity': 'H', 'co2': 'CO2', 'co': 'CO', 'pressure': 'P', 'static': 'SP',
    'differential': 'DP', 'drop': 'DP', 'airflow': 'FLW', 'flow': 'FLW', 'fan': 'F', 'speed': 'SPD', 'valve': 'VLV',
    'cooling': 'CLG', 'heating': 'HTG', 'damper': 'DMP', 'position': 'POS', 'status': 'STS', 'operating': 'OP',
    'state': 'ST', 'fault': 'FLT', 'alarm': 'ALM', 'filter': 'FLTR', 'frost': 'FRST', 'run': 'RUN', 'hours': 'HRS',
    'energy': 'KWH', 'mode': 'MODE', 'setpoint': 'SP', 'minimum': 'MIN', 'schedule': 'SCHD', 'override': 'OVR',
    'occupancy': 'OCC', 'effective': 'EFF', 'communication': 'COMM', 'reheat': 'RH', 'room': 'RM', 'output': 'OUT',
    'enable': 'EN', 'high': 'HI', 'low': 'LO', 'leak': 'LK', 'level': 'LVL', 'light': 'LT', 'daylight': 'DL',
    'power': 'KW', 'lights': 'LTS', 'on': 'ON', 'chilled': 'CHW', 'water': 'W', 'condenser': 'CW', 'entering': 'E',
    'leaving': 'L', 'load': 'LD', 'alarm_code': 'ALMCD', 'starts': 'STRT', 'demand': 'DMD', 'limit': 'LIM',
    'plant': 'PLT', 'chillers': 'CH', 'running': 'RUN', 'lead': 'LEAD', 'chiller': 'CH', 'staging': 'STG',
    'basin': 'BSN', 'vibration': 'VIB', 'firing': 'FIRE', 'rate': 'RT', 'flue': 'FLUE', 'gas': 'GAS', 'heat': 'HT',
    'tank': 'TNK', 'pump': 'PMP', 'highest': 'MAX', 'stair': 'STR', 'reactive': 'KVAR', 'voltage': 'V',
    'current': 'I', 'factor': 'PF', 'frequency': 'HZ', 'imported': 'IMP', 'exported': 'EXP', 'peak': 'PK',
    'winding': 'WDG', 'source': 'SRC', 'mains': 'MAINS', 'available': 'AV', 'fuel': 'FUEL', 'battery': 'BAT',
    'engine': 'ENG', 'oil': 'OIL', 'test': 'TST', 'request': 'REQ', 'charge': 'CHG', 'time': 'TM', 'input': 'IN',
    'panel': 'PNL', 'sessions': 'SESS', 'volume': 'VOL', 'pit': 'PIT', 'sprinkler': 'SPR', 'system': 'SYS',
    'normal': 'NRM', 'any': 'ANY', 'direction': 'DIR', 'door': 'DR', 'trips': 'TRIPS', 'outdoor_temperature': 'OAT',
    'wind': 'WND', 'sunlight': 'SUN', 'rain': 'RAIN', 'plug': 'PLG', 'kitchen': 'KIT', 'switchroom': 'SWR',
    'generator': 'GEN', 'machine': 'MCH', 'lift': 'LFT', 'refrigerant': 'REF', 'detector': 'DET', 'condensate': 'CND',
    'value': 'VAL', 'reached': '', 'or': '', 'off': 'OFF', 'today': '', 'demand_limit': 'DMDLIM', 'l1': 'L1',
    'l2': 'L2', 'l3': 'L3', 'b2': 'B2', 'b1': 'B1', 'g': 'G', 'rf': 'RF', 'cooling_output': 'CLGOUT',
}


def point_tag(short: str) -> str:
    """`zone_temperature` -> `ZN-T`; `supply_air_temperature_setpoint` -> `S-A-T-SP`."""
    parts = []
    for word in short.split('_'):
        if word.isdigit():
            parts.append(word)
            continue
        abbreviation = WORDS.get(word, word[:3].upper())
        if abbreviation:
            parts.append(abbreviation)
    return '-'.join(parts)


def equipment_tag(building: Building, equipment: str) -> str:
    return f'{building.info["key"]}_{equipment.replace("-", "_")}'


def flat_tags(building: Building) -> dict[str, str]:
    """Every point's flat tag, by point key. Two points of one equipment item never
    share a tag: a clash keeps the first and numbers the next."""
    tags: dict[str, str] = {}
    for item in building.equipment.values():
        seen: dict[str, int] = {}
        prefix = equipment_tag(building, item.key)
        for key in item.points:
            tag = point_tag(building.points[key].short)
            if tag in seen:
                seen[tag] += 1
                tag = f'{tag}{seen[tag]}'
            else:
                seen[tag] = 1
            tags[key] = f'{prefix}.{tag}'
    return tags
