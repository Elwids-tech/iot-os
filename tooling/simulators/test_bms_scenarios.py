"""Every building scenario's effect, and both naming styles exposing the same points.

The server scenarios (restart, certificate, clock, sessions, browsing) are checked
through a client in test_bms_server.py.
"""
import unittest
from datetime import datetime, timedelta, timezone

from bms.model import build, load
from bms.naming import flat_tags, point_tag
from bms.physics import SimpleBuilding
from bms.scenarios import BY_NAME, CATALOGUE, SERVER_SCENARIOS, ScenarioError, Scenarios

WEDNESDAY = datetime(2026, 7, 15, tzinfo=timezone.utc)
MODEL = load()
STANDARD = build(MODEL, 'standard')
TOWER = build(MODEL, 'tower')


def running(building=STANDARD, hour=10.0, warm=1800):
    physics = SimpleBuilding(building, start=WEDNESDAY + timedelta(hours=hour))
    physics.step(warm)
    return physics, Scenarios(physics)


class CatalogueTest(unittest.TestCase):
    def test_the_eighteen_scenarios_of_the_contract(self):
        self.assertEqual(len(CATALOGUE), 18)
        self.assertEqual({s.name for s in CATALOGUE}, {
            'damper_stuck', 'filter_alarm', 'chiller_trip', 'controller_offline', 'sensor_failure', 'uncertain_value',
            'server_restart', 'certificate_changed', 'clock_wrong', 'meter_replaced', 'session_limit', 'slow_browse',
            'hand_mode', 'power_outage', 'water_leak', 'car_park_co', 'lift_fault', 'fire_alarm'})

    def test_defaults_exist_at_the_standard_size_where_they_can(self):
        _, scenarios = running(warm=0)
        listed = {s['name']: s for s in scenarios.catalogue()}
        for name in ('damper_stuck', 'filter_alarm', 'chiller_trip', 'controller_offline', 'sensor_failure', 'meter_replaced',
                     'hand_mode', 'water_leak', 'fire_alarm'):
            self.assertIsNotNone(listed[name]['default'], name)
        self.assertIsNone(listed['car_park_co']['default'])  # the car parks run only in the tower
        with self.assertRaisesRegex(ScenarioError, 'larger size'):
            scenarios.switch('car_park_co', True)

    def test_unknown_scenarios_and_wrong_targets_are_refused(self):
        _, scenarios = running(warm=0)
        with self.assertRaisesRegex(ScenarioError, 'no scenario called'):
            scenarios.switch('earthquake', True)
        with self.assertRaisesRegex(ScenarioError, 'not a zone box'):
            scenarios.switch('damper_stuck', True, 'L03-AHU-1')
        with self.assertRaisesRegex(ScenarioError, 'no point'):
            scenarios.switch('sensor_failure', True, 'L03-VAV-2.weather')
        with self.assertRaisesRegex(ScenarioError, 'needs the OPC UA server'):
            scenarios.switch('server_restart', True)
        self.assertEqual(set(SERVER_SCENARIOS), {n for n, s in BY_NAME.items() if n in SERVER_SCENARIOS})


class BuildingScenariosTest(unittest.TestCase):
    def test_a_stuck_damper_holds_and_the_zone_drifts(self):
        # A cooling-only zone: with reheat, the valve would hide a stuck damper.
        p, scenarios = running(hour=8, warm=2 * 3600)
        before = p.read()['L03-VAV-5.damper_position']
        scenarios.switch('damper_stuck', True, 'L03-VAV-5')
        p.apply('L03-VAV-5.temperature_setpoint', 21.0)  # a healthy zone gets there in half an hour
        p.step(3600)
        values = p.read()
        self.assertEqual(values['L03-VAV-5.damper_position'], before)
        self.assertGreater(values['L03-VAV-5.zone_temperature'] - values['L03-VAV-5.effective_setpoint'], 0.7)
        scenarios.switch('damper_stuck', False)
        p.step(1800)
        self.assertNotEqual(p.read()['L03-VAV-5.damper_position'], before)
        self.assertAlmostEqual(p.read()['L03-VAV-5.zone_temperature'], 21.0, delta=0.5)

    def test_a_filter_loads_up_until_its_alarm(self):
        p, scenarios = running()
        self.assertFalse(p.read()['L03-AHU-1.filter_alarm'])
        scenarios.switch('filter_alarm', True)
        p.step(300)
        self.assertTrue(p.read()['L03-AHU-1.filter_alarm'])
        self.assertGreater(p.read()['L03-AHU-1.filter_pressure_drop'], 250)
        scenarios.switch('filter_alarm', False)
        p.step(10)
        self.assertFalse(p.read()['L03-AHU-1.filter_alarm'])

    def test_a_chiller_trips_chilled_water_warms_and_the_next_one_starts(self):
        p, scenarios = running(hour=11)
        lead = next(k for k in ('L10-CH-1', 'L10-CH-2', 'L10-CH-3') if p.read()[f'{k}.status'])
        self.assertEqual(scenarios.switch('chiller_trip', True), lead)
        p.step(40)
        values = p.read()
        self.assertTrue(values[f'{lead}.fault'])
        self.assertEqual(values[f'{lead}.operating_state'], 'Fault')
        self.assertTrue(values[f'{lead}.alarm_code'])
        self.assertGreater(values['L10-CHP-1.supply_temperature'], 6.6)  # warming while the next starts
        p.step(600)
        values = p.read()
        others = [k for k in ('L10-CH-1', 'L10-CH-2', 'L10-CH-3') if k != lead]
        self.assertTrue(any(values[f'{k}.status'] for k in others))
        self.assertAlmostEqual(values['L10-CHP-1.supply_temperature'], 6.5, delta=0.5)

    def test_an_offline_controller_turns_its_points_bad_and_the_rest_stay_good(self):
        p, scenarios = running()
        before = p.read()['L03-VAV-2.zone_temperature']
        scenarios.switch('controller_offline', True)
        p.step(1800)
        for point in p.b.equipment['L03-VAV-2'].points:
            self.assertEqual(p.quality(point), 'BadNoCommunication')
        self.assertEqual(p.read()['L03-VAV-2.zone_temperature'], before)  # its last value, held
        for point in p.b.equipment['L03-VAV-3'].points:
            self.assertEqual(p.quality(point), 'Good')
        scenarios.switch('controller_offline', False)
        self.assertEqual(p.quality('L03-VAV-2.zone_temperature'), 'Good')
        self.assertNotEqual(p.read()['L03-VAV-2.zone_temperature'], before)

    def test_a_failed_sensor_and_an_uncertain_value(self):
        p, scenarios = running()
        scenarios.switch('sensor_failure', True)
        scenarios.switch('uncertain_value', True, 'L03-AHU-1.supply_air_temperature')
        self.assertEqual(p.quality('L03-VAV-2.zone_temperature'), 'BadSensorFailure')
        self.assertEqual(p.quality('L03-AHU-1.supply_air_temperature'), 'UncertainLastUsableValue')
        self.assertEqual(p.quality('L03-VAV-2.zone_co2'), 'Good')
        scenarios.clear()
        self.assertEqual(p.quality('L03-VAV-2.zone_temperature'), 'Good')
        self.assertEqual(scenarios.state(), {})

    def test_a_replaced_meter_starts_again_from_zero_and_rises(self):
        p, scenarios = running()
        self.assertGreater(p.read()['L03-EM-1.energy'], 1000)
        scenarios.switch('meter_replaced', True)
        self.assertEqual(p.read()['L03-EM-1.energy'], 0.0)
        self.assertNotIn('meter_replaced', scenarios.state())  # it happens once
        p.step(3600)
        self.assertGreater(p.read()['L03-EM-1.energy'], 0.0)

    def test_hand_mode_accepts_a_write_and_ignores_it(self):
        p, scenarios = running()
        scenarios.switch('hand_mode', True)
        p.apply('L03-AHU-1.mode', 'Off')
        p.step(60)
        values = p.read()
        self.assertEqual(values['L03-AHU-1.mode'], 'Off')
        self.assertEqual(values['L03-AHU-1.operating_state'], 'Hand')
        self.assertGreater(values['L03-VAV-2.airflow'], 0)  # the fans keep running

    def test_a_power_outage_starts_the_generator_and_the_supply_runs_on_battery_until_then(self):
        p, scenarios = running(TOWER, warm=600)
        scenarios.switch('power_outage', True)
        p.step(5)
        values = p.read()
        self.assertEqual(values['L02-UPS-1.operating_state'], 'On battery')
        self.assertTrue(values['L02-UPS-1.on_battery_alarm'])
        self.assertLess(values['L02-UPS-1.battery_charge'], 100)
        p.step(30)
        values = p.read()
        self.assertEqual(values['B1-ATS-1.source'], 'Generator')
        self.assertTrue(values['B1-GEN-1.status'])
        self.assertEqual(values['B1-MM-1.power'], 0.0)
        self.assertEqual(values['L02-UPS-1.operating_state'], 'Online')
        scenarios.switch('power_outage', False)
        p.step(10)
        self.assertEqual(p.read()['B1-ATS-1.source'], 'Mains')

    def test_a_water_leak_trips_its_detector_and_the_flow_rises(self):
        p, scenarios = running(TOWER, warm=600)
        p.step(3600)
        quiet = p.read()['B1-BP-1.power']
        scenarios.switch('water_leak', True, 'L05')
        p.step(60)
        values = p.read()
        self.assertTrue(values['L05-SEN-1.leak_detector'])
        self.assertFalse(values['L06-SEN-1.leak_detector'])
        self.assertGreater(values['B1-BP-1.power'], quiet)  # the boosters supply the leak

    def test_car_park_carbon_monoxide_rises_and_its_fans_speed_up(self):
        p, scenarios = running(TOWER, hour=14, warm=600)
        before = p.read()
        scenarios.switch('car_park_co', True, 'B2')
        p.step(120)
        after = p.read()
        self.assertGreater(after['B2-CPV-1.highest_co'], before['B2-CPV-1.highest_co'] + 30)
        self.assertGreater(after['B2-CPF-1.speed'], before['B2-CPF-1.speed'])
        self.assertAlmostEqual(after['B1-CPV-1.highest_co'], before['B1-CPV-1.highest_co'], delta=10)

    def test_a_lift_goes_out_of_service(self):
        p, scenarios = running(TOWER, warm=600)
        scenarios.switch('lift_fault', True)
        trips = p.read()['G-LIFT-1.trips']
        p.step(1800)
        values = p.read()
        self.assertEqual(values['G-LIFT-1.mode'], 'Out of service')
        self.assertTrue(values['G-LIFT-1.fault'])
        self.assertEqual(values['G-LIFT-1.trips'], trips)
        self.assertEqual(values['G-LIFT-2.mode'], 'Normal')

    def test_a_fire_alarm_stops_its_floor_air_handling_unit(self):
        p, scenarios = running(TOWER, warm=600)
        scenarios.switch('fire_alarm', True, 'L04')
        p.step(120)
        values = p.read()
        self.assertTrue(values['B1-FIRE-1.fire_alarm_l04'])
        self.assertTrue(values['B1-FIRE-1.any_fire_alarm'])
        self.assertFalse(values['B1-FIRE-1.system_normal'])
        self.assertEqual(values['L04-AHU-1.operating_state'], 'Shut down')
        self.assertFalse(values['L04-AHU-1.supply_fan_status'])
        self.assertTrue(values['L05-AHU-1.supply_fan_status'])
        self.assertTrue(values['RF-SPF-1.status'])
        self.assertEqual(values['G-LIFT-1.mode'], 'Fire')
        scenarios.switch('fire_alarm', False)
        p.step(60)
        self.assertNotEqual(p.read()['L04-AHU-1.operating_state'], 'Shut down')


class NamingTest(unittest.TestCase):
    def test_both_styles_expose_the_same_points(self):
        for building in (STANDARD, TOWER):
            tags = flat_tags(building)
            self.assertEqual(set(tags), set(building.points))
            self.assertEqual(len(set(tags.values())), len(building.points))

    def test_flat_tags_read_like_a_vendors(self):
        tags = flat_tags(STANDARD)
        self.assertEqual(tags['L03-VAV-2.zone_temperature'], 'ET_L03_VAV_2.ZN-T')
        self.assertEqual(point_tag('temperature_setpoint'), 'T-SP')
        for tag in tags.values():
            self.assertRegex(tag, r'^ET_(B[0-9]|G|L[0-9]{2}|RF)_[A-Z]+_[0-9]+\.[A-Z0-9-]+$')


if __name__ == '__main__':
    unittest.main()
