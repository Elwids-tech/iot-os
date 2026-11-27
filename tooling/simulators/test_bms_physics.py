"""The simulated day: repeatable from a seed, totals that only rise, electricity that adds
up and values that stay what their points say they are."""
import math
import unittest
from datetime import datetime, timedelta, timezone

from bms.dynamics import Day
from bms.model import build, load
from bms.physics import SimpleBuilding

WEDNESDAY = datetime(2026, 7, 15, tzinfo=timezone.utc)
MODEL = load()
STANDARD = build(MODEL, 'standard')
TOWER = build(MODEL, 'tower')


def at(hour, building=STANDARD, season='summer', seed=7):
    return SimpleBuilding(building, seed=seed, season=season, start=WEDNESDAY + timedelta(hours=hour))


def root_meters(building):
    """Sub-meters whose power goes straight to the main meter: the feeders in the whole
    tower, the floor meters when only some floors run."""
    physics = SimpleBuilding(building, start=WEDNESDAY)
    roots = set()
    for key in physics.paths.values():
        meters = [k for k in key if building.equipment[k].type == 'electricity_sub_meter']
        if meters:
            roots.add(meters[-1])
    return sorted(roots)


class DayTest(unittest.TestCase):
    def test_the_same_seed_gives_the_same_day_however_the_clock_is_stepped(self):
        one, two = at(6), at(6)
        one.step(4 * 3600)
        for _ in range(4 * 3600 // 13):
            two.step(13)
        two.step(4 * 3600 - (4 * 3600 // 13) * 13)
        self.assertEqual(one.now, two.now)
        self.assertEqual(one.read(), two.read())

    def test_another_seed_gives_another_day(self):
        one, two = at(6, seed=7), at(6, seed=8)
        one.step(3600)
        two.step(3600)
        self.assertNotEqual(one.read()['RF-WX-1.outdoor_temperature'], two.read()['RF-WX-1.outdoor_temperature'])

    def test_the_day_has_its_shape(self):
        p = at(0)
        samples = {}
        for hour in range(24):
            samples[hour] = p.read()
            p.step(3600)
        self.assertLess(samples[5]['RF-WX-1.outdoor_temperature'], samples[15]['RF-WX-1.outdoor_temperature'])
        self.assertEqual(samples[2]['RF-PV-1.output_power'], 0.0)
        self.assertGreater(samples[12]['RF-PV-1.output_power'], 10.0)
        self.assertEqual(samples[2]['L03-AHU-1.operating_state'], 'Unoccupied')
        self.assertEqual(samples[10]['L03-AHU-1.operating_state'], 'Occupied')
        self.assertEqual(samples[2]['L10-CHP-1.chillers_running'], 0)
        self.assertGreaterEqual(samples[14]['L10-CHP-1.chillers_running'], 1)
        self.assertFalse(samples[3]['L03-VAV-1.occupancy'])
        self.assertTrue(samples[10]['L03-VAV-1.occupancy'])
        self.assertGreater(samples[11]['L03-VAV-1.zone_co2'], samples[3]['L03-VAV-1.zone_co2'] + 200)
        self.assertGreater(samples[14]['B1-MM-1.power'], samples[3]['B1-MM-1.power'])

    def test_seasons_change_the_weather(self):
        summer, winter = Day(7, 'summer'), Day(7, 'winter')
        noon = WEDNESDAY + timedelta(hours=13)
        self.assertGreater(summer.weather(noon).temperature, winter.weather(noon).temperature + 15)
        self.assertGreater(summer.weather(noon).sunlight, winter.weather(noon).sunlight)
        with self.assertRaises(ValueError):
            Day(7, 'monsoon')

    def test_a_weekend_is_quiet(self):
        saturday = SimpleBuilding(STANDARD, start=WEDNESDAY + timedelta(days=3, hours=10))
        saturday.step(1800)
        self.assertEqual(saturday.read()['L03-AHU-1.operating_state'], 'Unoccupied')


class TotalsTest(unittest.TestCase):
    def test_totals_only_rise(self):
        p = at(0)
        totals = [k for k, point in STANDARD.points.items() if point.kind == 'total']
        last = {k: p.read()[k] for k in totals}
        risen = set()
        for _ in range(24):
            p.step(3600)
            now = p.read()
            for key in totals:
                self.assertGreaterEqual(now[key], last[key], key)
                if now[key] > last[key]:
                    risen.add(key)
            last = {k: now[k] for k in totals}
        for key in ('B1-MM-1.energy_imported', 'L03-AHU-1.run_hours', 'L03-AHU-1.fan_energy', 'L10-CH-1.run_hours',
                    'L10-CHP-1.cooling_energy', 'RF-PV-1.energy', 'L03-EM-1.energy'):
            self.assertIn(key, risen)


class ElectricityTest(unittest.TestCase):
    def assert_adds_up(self, building, start, hours):
        roots = root_meters(building)
        p = at(start, building)
        for _ in range(hours):
            p.step(3600)
            values = p.read()
            solar = sum(values[f'{e.key}.output_power'] for e in building.equipment_of_type('solar_inverter'))
            metered = sum(values[f'{k}.power'] for k in roots) - solar
            main = values['B1-MM-1.power']
            self.assertAlmostEqual(metered, main, delta=abs(main) * 0.01 + 0.01, msg=f'{p.now:%H:%M}')
        return roots

    def test_the_feeders_add_up_to_the_main_meter_in_the_tower(self):
        roots = self.assert_adds_up(TOWER, 6, 6)
        self.assertEqual(roots, [f'B1-EM-{n}' for n in range(1, 7)])

    def test_the_floor_meters_add_up_to_the_main_meter_at_the_standard_size(self):
        roots = self.assert_adds_up(STANDARD, 8, 4)
        self.assertEqual(roots, ['L02-EM-1', 'L02-EM-2', 'L02-EM-3', 'L03-EM-1', 'L03-EM-2', 'L10-EM-1'])

    def test_a_feeder_is_the_sum_of_the_floor_meters_it_feeds(self):
        p = at(11, TOWER)
        p.step(600)
        values = p.read()
        floors = sum(values[f'L{n:02d}-EM-1.power'] for n in range(2, 10)) + values['L02-EM-3.power'] \
            + values['G-EM-1.power'] + values['G-EM-2.power']
        self.assertAlmostEqual(values['B1-EM-5.power'], floors, delta=values['B1-EM-5.power'] * 0.01)


class ValuesTest(unittest.TestCase):
    def test_every_point_keeps_its_type_and_range_through_the_day(self):
        for season in ('summer', 'winter'):
            p = at(0, TOWER, season)
            for _ in range(8):
                values = p.read()
                self.assertEqual(set(values), set(TOWER.points))
                for key, value in values.items():
                    spec = TOWER.points[key].spec
                    self.assertEqual(p.quality(key), 'Good')
                    if spec['type'] == 'number':
                        self.assertIsInstance(value, float, key)
                        self.assertTrue(math.isfinite(value), key)
                        bounds = spec.get('limits') or spec.get('range')
                        if bounds:
                            self.assertTrue(bounds[0] - 0.01 <= value <= bounds[1] + 0.01, f'{key} = {value} in {season} at {p.now:%H:%M}')
                    elif spec['type'] == 'boolean':
                        self.assertIsInstance(value, bool, key)
                    elif spec['type'] == 'state':
                        self.assertIn(value, spec['states'], key)
                    else:
                        self.assertIsInstance(value, str, key)
                p.step(3 * 3600)

    def test_lifts_move_and_count_their_trips(self):
        p = at(8, TOWER)
        before = p.read()['G-LIFT-1.trips']
        levels = set()
        for _ in range(60):
            p.step(60)
            levels.add(p.read()['G-LIFT-1.current_level'])
        self.assertGreater(p.read()['G-LIFT-1.trips'], before)
        self.assertGreater(len(levels), 2)
        self.assertTrue(levels <= set(TOWER.levels))

    def test_water_follows_occupancy_and_the_tank_refills(self):
        p = at(9, TOWER)
        p.step(3600)
        values = p.read()
        self.assertGreater(values['G-WM-1.flow'], 0)
        self.assertTrue(20 < values['B1-TNK-1.level'] < 100)
        self.assertTrue(values['B1-BP-1.status'])


if __name__ == '__main__':
    unittest.main()
