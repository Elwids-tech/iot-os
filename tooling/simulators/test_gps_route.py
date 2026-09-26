import math
import unittest

from gps_route import gps_position


class GpsRouteTest(unittest.TestCase):
    def test_route_is_deterministic_and_crosses_demo_boundary(self):
        self.assertEqual(gps_position(0), gps_position(0))
        latitude, longitude, accuracy = gps_position(0)
        self.assertAlmostEqual(latitude, 51.0)
        self.assertAlmostEqual(longitude, -113.988)
        self.assertEqual(accuracy, 5.0)

        latitude, longitude, _ = gps_position(30 * math.pi)
        self.assertAlmostEqual(latitude, 51.012)
        self.assertAlmostEqual(longitude, -114.0)

        latitude, longitude, _ = gps_position(60 * math.pi / 4)
        self.assertLess(abs(latitude - 51.0), 0.01)
        self.assertLess(abs(longitude + 114.0), 0.01)


if __name__ == "__main__":
    unittest.main()
