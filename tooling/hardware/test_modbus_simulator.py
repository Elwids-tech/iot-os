"""The simulator answers with the register map the RT1050 example polls (app/modbus_rtu.h)."""
from pathlib import Path
import re
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import modbus_simulator as sim

ROOT = Path(__file__).resolve().parents[2]
EXAMPLE = ROOT / "firmware/sdk/examples/rt1050-evkb-ethernet/app/modbus_rtu.h"


class RegisterMapTest(unittest.TestCase):
    def test_four_registers_status_counter_and_temperature(self):
        values = sim.registers(7, 10.5)
        self.assertEqual(sim.REGISTER_COUNT, len(values))
        self.assertEqual(1, values[0])
        self.assertEqual(7 * 1000 + 10 * 7, (values[1] << 16) | values[2])
        self.assertEqual(207, values[3])  # 20.7 degrees, in tenths

    def test_the_counter_carries_into_the_high_word(self):
        values = sim.registers(247, 300.0)
        self.assertEqual(247 * 1000 + 300 * 247, (values[1] << 16) | values[2])
        self.assertGreater(values[1], 0)

    def test_every_register_is_a_16_bit_word(self):
        for address in (sim.FIRST_ADDRESS, 100, sim.LAST_ADDRESS):
            for value in sim.registers(address, 1e9):
                self.assertTrue(0 <= value <= 0xFFFF, value)

    def test_only_modbus_addresses_answer(self):
        for address in (0, 248):
            with self.assertRaises(ValueError):
                sim.registers(address, 0)

    def test_it_matches_what_the_board_example_polls(self):
        header = EXAMPLE.read_text(encoding="utf-8")
        defines = dict(re.findall(r"#define (APP_MODBUS_\w+) (\d+)", header))
        self.assertEqual(sim.REGISTER_COUNT, int(defines["APP_MODBUS_REGISTER_COUNT"]))
        self.assertEqual(0, int(defines["APP_MODBUS_FIRST_REGISTER"]))
        self.assertEqual(sim.FIRST_ADDRESS, int(defines["APP_MODBUS_FIRST_ADDRESS"]))
        self.assertEqual(sim.LAST_ADDRESS, int(defines["APP_MODBUS_LAST_ADDRESS"]))
        for line in ("0  status", "1  reading, high word", "2  reading, low word", "3  temperature in tenths"):
            self.assertIn(line, header)
            self.assertIn(line, sim.__doc__)


if __name__ == "__main__":
    unittest.main()
