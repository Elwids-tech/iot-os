"""The building model file against its schema and the totals in the building plan.

The totals are those of specs/038-opc-ua-connector/building.md (Totals and sizes).
"""
import copy
import json
import re
import subprocess
import sys
import unittest
from collections import Counter

from bms.model import MODEL_FILE, ModelError, build, export, load

# level or group -> (points, of which commands, devices), from the building plan.
PLAN = {
    'office floor': (188, 47, 22),
    'server_room': (51, 6, 5),
    'L01': (197, 43, 19),
    'G': (135, 28, 16),
    'B1': (201, 19, 27),
    'B2': (71, 11, 12),
    'L10': (200, 39, 22),
    'RF': (67, 9, 12),
    'lifts': (40, 0, 5),
}
SIZES = {'standard': (706, 148, 84), 'tower': (2466, 531, 294), 'large': (6602, 1565, 778)}
POINT_KEY = re.compile(r'^(B[0-9]|G|L[0-9]{2}|RF)-[A-Z]{2,5}-[0-9]{1,2}\.[a-z][a-z0-9_]*$')


class ModelFileTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = load()
        cls.buildings = {size: build(cls.data, size) for size in SIZES}

    def test_the_sizes_have_the_planned_totals(self):
        for size, (points, commands, devices) in SIZES.items():
            totals = self.buildings[size].totals()
            self.assertEqual((totals['points'], totals['commands'], totals['devices']), (points, commands, devices), size)
        self.assertEqual(self.buildings['tower'].totals()['levels'], 14)
        self.assertGreaterEqual(self.buildings['large'].totals()['points'], 5000)

    def test_each_level_has_the_planned_points_commands_and_devices(self):
        tower = self.buildings['tower']
        counted = {}
        for item in tower.equipment.values():
            group = item.group if item.group in ('server_room', 'lifts') else item.level
            points, commands, devices = counted.get(group, (0, 0, 0))
            writable = sum(1 for p in item.points if tower.points[p].writable)
            counted[group] = (points + len(item.points), commands + writable, devices + 1)
        for level in ('L02', 'L03', 'L04', 'L05', 'L06', 'L07', 'L08', 'L09'):
            self.assertEqual(counted[level], PLAN['office floor'], level)
        for group in ('server_room', 'L01', 'G', 'B1', 'B2', 'L10', 'RF', 'lifts'):
            self.assertEqual(counted[group], PLAN[group], group)

    def test_the_standard_size_is_levels_2_and_3_the_plant_floor_the_roof_and_the_main_meter(self):
        standard = self.buildings['standard']
        self.assertEqual(sorted({e.level for e in standard.equipment.values()}), ['B1', 'L02', 'L03', 'L10', 'RF'])
        self.assertEqual([e.key for e in standard.equipment.values() if e.level == 'B1'], ['B1-MM-1'])
        self.assertEqual(len(standard.zones), 14)
        kinds = Counter(p.kind for p in standard.points.values())
        self.assertEqual(set(kinds), {'sensor', 'actuator', 'status', 'alarm', 'total', 'command'})

    def test_keys_follow_the_naming_rules_and_are_unique(self):
        tower = self.buildings['tower']
        for key, point in tower.points.items():
            self.assertRegex(key, POINT_KEY)
            self.assertTrue(key.startswith(point.equipment + '.'))
        for key, item in tower.equipment.items():
            self.assertEqual(key.split('-')[0], item.level)
            self.assertEqual(key.rsplit('-', 1)[0].split('-', 1)[1], item.kind)
        for key, zone in tower.zones.items():
            self.assertRegex(key, r'^(G|L[0-9]{2})-Z[0-9]$')
        self.assertIn('L03-VAV-2.zone_temperature', tower.points)
        self.assertIn('L10-CH-1', tower.equipment)
        self.assertIn('RF-CT-3', tower.equipment)
        self.assertIn('B1-EVC-4', tower.equipment)

    def test_every_point_describes_itself(self):
        for point in self.buildings['large'].points.values():
            spec = point.spec
            self.assertTrue(point.name and point.description, point.key)
            if spec['type'] == 'number' and spec['kind'] in ('sensor', 'actuator', 'command') and spec.get('unit'):
                self.assertTrue(spec.get('range') or spec.get('limits'), point.key)
            if spec['type'] == 'state':
                self.assertGreaterEqual(len(spec['states']), 2, point.key)
            if point.writable:
                if spec['type'] == 'number':
                    low, high = spec['limits']
                    self.assertTrue(low <= spec['default'] <= high, point.key)
                elif spec['type'] == 'state':
                    self.assertIn(spec['default'], spec['states'], point.key)

    def test_zone_setpoints_accept_18_to_28(self):
        spec = self.buildings['standard'].points['L03-VAV-2.temperature_setpoint'].spec
        self.assertEqual(spec['limits'], [18, 28])

    def test_fire_lifts_transfer_switch_and_supply_have_no_commands(self):
        tower = self.buildings['tower']
        for item in tower.equipment.values():
            if item.type in ('fire_systems', 'lift', 'transfer_switch', 'uninterruptible_supply'):
                self.assertFalse(any(tower.points[p].writable for p in item.points), item.key)

    def test_positions_are_inside_the_building_on_their_level(self):
        tower = self.buildings['tower']
        width, depth = self.data['building']['size']
        for item in tower.equipment.values():
            x, y, z = item.position
            level = tower.levels[item.level]
            self.assertTrue(0 <= x <= width and 0 <= y <= depth, item.key)
            self.assertTrue(level.floor_z <= z <= level.floor_z + max(level.height, 3.0), item.key)
        for point in tower.points.values():
            if point.position:
                x, y, z = point.position
                self.assertTrue(0 <= x <= width and 0 <= y <= depth, point.key)
        sensor = tower.points['L03-VAV-2.zone_temperature'].position
        self.assertEqual(sensor, (42.0, 15.0, 16.5))  # the zone's inner wall, 1.5 m above Level 3

    def test_zone_boxes_hang_at_the_centre_of_their_zone_below_the_slab(self):
        tower = self.buildings['tower']
        for item in tower.equipment_of_type('zone_box_reheat', 'zone_box_cooling', 'zone_box_core'):
            level = tower.levels[item.level]
            self.assertAlmostEqual(item.position[2], level.floor_z + level.height - 0.6, places=3, msg=item.key)

    def test_large_adds_office_floors_above_the_plant_floor(self):
        large = self.buildings['large']
        self.assertEqual(len([l for l in large.levels.values() if l.plan == 'office']), 30)
        self.assertEqual(list(large.levels)[-1], 'RF')
        self.assertEqual(large.levels['L11'].floor_z, 48.0)
        self.assertGreater(large.levels['RF'].floor_z, large.levels['L32'].floor_z)

    def test_every_feed_points_at_equipment_of_the_model(self):
        tower = self.buildings['tower']
        for item in tower.equipment.values():
            for refs in item.fed_by.values():
                for ref in refs:
                    self.assertIn(ref, tower.equipment, item.key)
        self.assertEqual(tower.equipment['L03-AHU-1'].fed_by['air'], ['L10-OAU-1', 'L10-OAU-2'])
        self.assertEqual(tower.equipment['L03-VAV-2'].fed_by['air'], ['L03-AHU-1'])

    def test_export_is_plain_json_with_the_totals(self):
        exported = json.loads(json.dumps(export(self.buildings['tower'])))
        self.assertEqual(exported['totals'], {'levels': 14, 'points': 2466, 'commands': 531, 'devices': 294})
        self.assertEqual(len(exported['points']), 2466)
        self.assertEqual(exported['site']['name'], 'Example Campus')

    def test_the_command_line_prints_the_model(self):
        result = subprocess.run([sys.executable, '-m', 'bms.model', '--size', 'tower', '--totals'], capture_output=True,
                                text=True, check=True, cwd=MODEL_FILE.parents[2])
        self.assertEqual(json.loads(result.stdout)['points'], 2466)

    def test_a_broken_model_is_refused(self):
        broken = copy.deepcopy(self.data)
        broken['plans']['office']['equipment'][1]['fed_by']['air'] = 'AHU-9'
        with self.assertRaisesRegex(ModelError, 'unknown equipment L02-AHU-9'):
            build(broken, 'tower')
        broken = copy.deepcopy(self.data)
        broken['library']['air_handling_unit']['kind'] = 'XYZ'
        with self.assertRaisesRegex(ModelError, 'key kind is XYZ'):
            build(broken, 'standard')
        with self.assertRaisesRegex(ModelError, 'unknown size'):
            build(self.data, 'huge')


if __name__ == '__main__':
    unittest.main()
