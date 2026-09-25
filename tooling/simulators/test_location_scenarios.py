import json
from pathlib import Path
import unittest

from location_scenarios import scenarios


class LocationScenariosTest(unittest.TestCase):
    def test_checked_in_fixtures_are_reproducible(self):
        root = Path(__file__).resolve().parents[2]
        expected = json.loads((root / "contracts/location/v1/scenarios.fixture.json").read_text())
        self.assertEqual(expected, scenarios())

    def test_parameters_are_explicit_and_configurable(self):
        cases = scenarios(interval_seconds=60, accuracy_metres=12)
        self.assertEqual(cases["cases"][0]["binding"]["max_age_seconds"], 180)
        self.assertEqual(cases["cases"][0]["event"]["readings"][-1]["value"], 12)

    def test_invalid_simulator_parameters_are_rejected(self):
        for interval, accuracy in [(0, 5), (3601, 5), (30, -1), (30, float("nan")), (30, float("inf"))]:
            with self.assertRaises(ValueError):
                scenarios(interval, accuracy)
