"""The command rules and every local control loop reaching its setpoint.

Simulated time starts on a Wednesday in July (summer) unless a test says otherwise.
"""
import unittest
from datetime import datetime, timedelta, timezone

from bms import controls as c
from bms.model import build, load
from bms.physics import SimpleBuilding

WEDNESDAY = datetime(2026, 7, 15, tzinfo=timezone.utc)
MODEL = load()
BUILDINGS = {}


def building(size='standard', season='summer', hour=9.0, seed=7):
    if size not in BUILDINGS:
        BUILDINGS[size] = build(MODEL, size)
    return SimpleBuilding(BUILDINGS[size], seed=seed, season=season, start=WEDNESDAY + timedelta(hours=hour))


def write(physics, point, value):
    status, stored = c.check_write(physics.b.points[point].spec, value)
    assert status == c.GOOD, (point, value, status)
    physics.apply(point, stored)


class CommandRulesTest(unittest.TestCase):
    def setUp(self):
        self.points = build(MODEL, 'standard').points

    def check(self, point, value):
        return c.check_write(self.points[point].spec, value)

    def test_a_setpoint_inside_its_limits_is_accepted(self):
        self.assertEqual(self.check('L03-VAV-2.temperature_setpoint', 21), (c.GOOD, 21.0))
        self.assertEqual(self.check('L03-VAV-2.temperature_setpoint', 28.0), (c.GOOD, 28.0))

    def test_a_value_outside_its_limits_is_out_of_range(self):
        self.assertEqual(self.check('L03-VAV-2.temperature_setpoint', 40)[0], c.OUT_OF_RANGE)
        self.assertEqual(self.check('L03-VAV-2.temperature_setpoint', 17.9)[0], c.OUT_OF_RANGE)
        self.assertEqual(self.check('L03-AHU-1.mode', 3)[0], c.OUT_OF_RANGE)
        self.assertEqual(self.check('L03-AHU-1.mode', 'Sideways')[0], c.OUT_OF_RANGE)

    def test_the_wrong_type_is_a_type_mismatch(self):
        self.assertEqual(self.check('L03-VAV-2.temperature_setpoint', 'warm')[0], c.TYPE_MISMATCH)
        self.assertEqual(self.check('L03-VAV-2.temperature_setpoint', True)[0], c.TYPE_MISMATCH)
        self.assertEqual(self.check('L03-VAV-2.occupancy_override', 1)[0], c.TYPE_MISMATCH)
        self.assertEqual(self.check('L03-AHU-1.mode', 1.5)[0], c.TYPE_MISMATCH)

    def test_modes_and_requests_take_their_named_states_or_on_and_off(self):
        self.assertEqual(self.check('L03-AHU-1.mode', 1), (c.GOOD, 'Off'))
        self.assertEqual(self.check('L03-AHU-1.mode', 'On'), (c.GOOD, 'On'))
        self.assertEqual(self.check('L03-VAV-2.occupancy_override', True), (c.GOOD, True))
        self.assertEqual(self.check('L10-CHP-1.lead_chiller', 'Chiller 2'), (c.GOOD, 'Chiller 2'))

    def test_sensors_statuses_alarms_and_totals_can_never_be_written(self):
        for point in ('L03-VAV-2.zone_temperature', 'L03-VAV-2.damper_position', 'L03-VAV-2.operating_state',
                      'L03-AHU-1.filter_alarm', 'L03-AHU-1.run_hours', 'B1-MM-1.energy_imported'):
            self.assertEqual(self.check(point, 1.0)[0], c.NOT_WRITABLE, point)

    def test_every_command_accepts_its_default(self):
        for point in self.points.values():
            if point.writable:
                self.assertEqual(c.check_write(point.spec, point.spec['default'])[0], c.GOOD, point.key)


class LoopsTest(unittest.TestCase):
    def test_a_zone_follows_a_new_setpoint_within_30_minutes(self):
        p = building(hour=8)
        p.step(2 * 3600)
        # Within its deadband: cooling holds the setpoint, reheat half a degree below it.
        self.assertTrue(21.9 <= p.read()['L03-VAV-2.zone_temperature'] <= 23.0)
        write(p, 'L03-VAV-2.temperature_setpoint', 21.0)
        p.step(5)
        self.assertEqual(p.read()['L03-VAV-2.effective_setpoint'], 21.0)  # at once
        p.step(30 * 60)
        self.assertAlmostEqual(p.read()['L03-VAV-2.zone_temperature'], 21.0, delta=0.5)

    def test_every_zone_holds_its_setpoint_through_the_working_day(self):
        for season in ('summer', 'winter'):
            p = building(season=season, hour=0)  # from the night before, through warm-up
            p.step(9 * 3600)
            for _ in range(9):
                values = p.read()
                for item in p.b.equipment_of_type('zone_box_reheat', 'zone_box_cooling', 'zone_box_core'):
                    self.assertAlmostEqual(values[f'{item.key}.zone_temperature'], values[f'{item.key}.temperature_setpoint'],
                                           delta=1.0, msg=f'{item.key} in {season} at {p.now:%H:%M}')
                p.step(3600)

    def test_an_unoccupied_zone_widens_its_setpoint(self):
        p = building(hour=23)
        p.step(60)
        values = p.read()
        self.assertEqual(values['L03-VAV-2.operating_state'], 'Unoccupied')
        self.assertIn(values['L03-VAV-2.effective_setpoint'], (22.5 + 3, 22.5 - 3))
        write(p, 'L03-VAV-2.occupancy_override', True)
        p.step(10)
        self.assertEqual(p.read()['L03-VAV-2.effective_setpoint'], 22.5)

    def test_an_air_handling_unit_follows_its_schedule_and_holds_supply_air(self):
        p = building(hour=10)
        p.step(1800)
        values = p.read()
        self.assertEqual(values['L03-AHU-1.operating_state'], 'Occupied')
        self.assertTrue(values['L03-AHU-1.supply_fan_status'])
        self.assertAlmostEqual(values['L03-AHU-1.supply_air_temperature'], 13.0, delta=0.5)
        self.assertGreater(values['L03-AHU-1.duct_static_pressure'], 200)
        write(p, 'L03-AHU-1.supply_air_temperature_setpoint', 15.0)
        p.step(600)
        self.assertAlmostEqual(p.read()['L03-AHU-1.supply_air_temperature'], 15.0, delta=0.5)
        write(p, 'L03-AHU-1.mode', 'Off')
        p.step(10)
        values = p.read()
        self.assertEqual(values['L03-AHU-1.operating_state'], 'Off')
        self.assertFalse(values['L03-AHU-1.supply_fan_status'])
        self.assertEqual(values['L03-VAV-2.airflow'], 0.0)

    def test_carbon_dioxide_opens_the_outdoor_air_damper(self):
        loop = c.AirHandlingUnitLoop()
        quiet = loop.run('Auto', True, False, 10, 30, 23, 600, 30, True)
        busy = loop.run('Auto', True, False, 10, 30, 23, 950, 30, True)
        self.assertEqual(quiet.outdoor_air, 30)
        self.assertGreater(busy.outdoor_air, 80)

    def test_the_chilled_water_plant_holds_its_setpoint_and_stops_when_switched_off(self):
        p = building(hour=11)
        p.step(1800)
        values = p.read()
        self.assertGreaterEqual(values['L10-CHP-1.chillers_running'], 1)
        self.assertAlmostEqual(values['L10-CHP-1.supply_temperature'], 6.5, delta=0.5)
        write(p, 'L10-CHP-1.chilled_water_setpoint', 8.0)
        p.step(900)
        self.assertAlmostEqual(p.read()['L10-CHP-1.supply_temperature'], 8.0, delta=0.5)
        write(p, 'L10-CHP-1.plant_enable', False)
        p.step(10)
        values = p.read()
        self.assertEqual(values['L10-CHP-1.chillers_running'], 0)
        self.assertFalse(any(values[f'L10-CH-{n}.status'] for n in (1, 2, 3)))

    def test_the_lead_chiller_runs_first_and_a_disabled_one_is_skipped(self):
        p = building(hour=11)
        write(p, 'L10-CHP-1.lead_chiller', 'Chiller 2')
        p.step(1200)
        values = p.read()
        self.assertTrue(values['L10-CH-2.status'])
        self.assertFalse(values['L10-CH-1.status'])
        self.assertTrue(values['L10-PCHWP-2.status'] and values['L10-CWP-2.status'])
        write(p, 'L10-CH-2.enable', False)
        p.step(1200)
        values = p.read()
        self.assertFalse(values['L10-CH-2.status'])
        self.assertTrue(values['L10-CH-3.status'])

    def test_chillers_stage_with_load(self):
        staging = c.StagingLoop(900)
        for _ in range(10):
            stages = staging.run(5, 300, True)
        self.assertEqual(stages, 1)
        for _ in range(30):
            stages = staging.run(5, 1200, True)
        self.assertEqual(stages, 2)
        for _ in range(70):
            stages = staging.run(5, 300, True)
        self.assertEqual(stages, 1)
        self.assertEqual(staging.run(5, 3000, False), 0)
        self.assertEqual(c.lead_order(1, [True, True, True]), [1, 2, 0])
        self.assertEqual(c.lead_order(0, [True, False, True]), [0, 2])

    def test_the_heating_plant_holds_its_setpoint_in_winter(self):
        p = building(season='winter', hour=8)
        p.step(3600)
        values = p.read()
        self.assertEqual(values['L10-BLR-1.operating_state'], 'Firing')
        self.assertAlmostEqual(values['L10-HP-1.supply_temperature'], 70.0, delta=1.5)
        write(p, 'L10-HP-1.heating_water_setpoint', 60.0)
        p.step(1800)
        self.assertAlmostEqual(p.read()['L10-HP-1.supply_temperature'], 60.0, delta=1.5)

    def test_the_server_room_is_held_and_the_standby_unit_takes_over(self):
        p = building(hour=3)
        p.step(1800)
        values = p.read()
        self.assertAlmostEqual(values['L02-CRAC-1.return_air_temperature'], 22.0, delta=0.6)
        self.assertTrue(values['L02-CRAC-1.status'])
        self.assertFalse(values['L02-CRAC-2.status'])
        write(p, 'L02-CRAC-1.enable', False)
        p.step(1800)
        values = p.read()
        self.assertTrue(values['L02-CRAC-2.status'])
        self.assertAlmostEqual(values['L02-CRAC-2.return_air_temperature'], 22.0, delta=0.6)

    def test_lighting_dims_against_daylight_and_follows_its_mode(self):
        p = building(hour=11)
        p.step(1800)
        values = p.read()
        self.assertTrue(values['L03-LTG-5.lights_on'])  # an occupied interior zone
        self.assertGreaterEqual(values['L03-LTG-5.light_level'], 480)
        write(p, 'L03-LTG-5.mode', 'Off')
        p.step(5)
        self.assertEqual(p.read()['L03-LTG-5.power'], 0.0)
        write(p, 'L03-LTG-5.mode', 'On')
        write(p, 'L03-LTG-5.level', 40.0)
        p.step(5)
        self.assertAlmostEqual(p.read()['L03-LTG-5.power'], 162 * 8 * 0.4 / 1000, delta=0.01)
        night = building(hour=1)
        night.step(60)
        self.assertFalse(night.read()['L03-LTG-1.lights_on'])

    def test_blinds_lower_with_direct_sun_and_follow_a_manual_position(self):
        p = building(hour=11.5)
        p.step(600)
        self.assertEqual(p.read()['L03-BLD-3.position'], 100.0)  # south façade at noon
        self.assertEqual(p.read()['L03-BLD-1.position'], 0.0)  # north façade
        write(p, 'L03-BLD-1.mode', 'Manual')
        write(p, 'L03-BLD-1.position_setpoint', 30.0)
        p.step(60)
        self.assertEqual(p.read()['L03-BLD-1.position'], 30.0)

    def test_car_park_fans_run_faster_as_carbon_monoxide_rises(self):
        self.assertEqual(c.car_park_fan_speed(5, 25), 0)
        self.assertAlmostEqual(c.car_park_fan_speed(10.1, 25), 30.0, delta=1.0)  # starts at 30%
        self.assertEqual(c.car_park_fan_speed(25, 25), 100)
        rush = building('tower', hour=8.25)
        rush.step(600)
        night = building('tower', hour=3)
        night.step(600)
        self.assertGreater(rush.read()['B1-CPF-1.speed'], 0)
        self.assertGreater(rush.read()['B1-CPV-1.highest_co'], night.read()['B1-CPV-1.highest_co'])
        self.assertEqual(night.read()['B1-CPF-1.speed'], 0)

    def test_a_fan_coil_holds_its_shop(self):
        p = building('tower', hour=10)
        p.step(3600)
        values = p.read()
        for n in (1, 2):
            self.assertAlmostEqual(values[f'G-FCU-{n}.room_temperature'], values[f'G-FCU-{n}.temperature_setpoint'], delta=1.0)

    def test_the_generator_starts_and_takes_the_load_when_the_mains_fail(self):
        p = building('tower', hour=10)
        p.step(60)
        p.mains_available = False
        p.step(30)
        values = p.read()
        self.assertEqual(values['B1-GEN-1.operating_state'], 'Running')
        self.assertEqual(values['B1-ATS-1.source'], 'Generator')
        self.assertEqual(values['B1-MM-1.power'], 0.0)
        self.assertGreater(values['B1-GEN-1.output_power'], 50)
        p.mains_available = True
        p.step(10)
        self.assertEqual(p.read()['B1-ATS-1.source'], 'Mains')

    def test_a_generator_test_run_runs_it_and_its_hours_rise(self):
        p = building('tower', hour=10)
        before = p.read()['B1-GEN-1.run_hours']
        write(p, 'B1-GEN-1.test_run_request', True)
        p.step(1800)
        values = p.read()
        self.assertEqual(values['B1-GEN-1.operating_state'], 'Running')
        self.assertEqual(values['B1-ATS-1.source'], 'Mains')
        self.assertGreater(values['B1-GEN-1.run_hours'], before + 0.4)
        write(p, 'B1-GEN-1.test_run_request', False)
        p.step(30)
        self.assertEqual(p.read()['B1-GEN-1.operating_state'], 'Cooling down')

    def test_equipment_in_hand_accepts_a_write_and_ignores_it(self):
        p = building(hour=10)
        p.step(1800)
        damper = p.read()['L03-VAV-2.damper_position']
        p.hand.add('L03-VAV-2')
        write(p, 'L03-VAV-2.temperature_setpoint', 19.0)
        p.step(900)
        values = p.read()
        self.assertEqual(values['L03-VAV-2.temperature_setpoint'], 19.0)
        self.assertEqual(values['L03-VAV-2.operating_state'], 'Hand')
        self.assertEqual(values['L03-VAV-2.damper_position'], damper)


if __name__ == '__main__':
    unittest.main()
