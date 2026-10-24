import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import fire_watch_box
from fire_watch_box import FireWatchBox, METRICS, serve_controls


def quiet_init(self, config, state_file):
    self.lock = threading.RLock()
    self.online = False
    self.running = True


class FireWatchBoxTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        with mock.patch.object(fire_watch_box.Simulator, '__init__', quiet_init):
            self.box = FireWatchBox({}, Path(self.directory.name) / 'state')
        self.box.note = lambda text: None

    def tearDown(self):
        self.directory.cleanup()

    def run_for(self, seconds):
        for _ in range(seconds):
            for incident in self.box.active:
                self.box.active[incident] -= 1
            self.box.advance(1)

    def test_hot_work_raises_flame_then_smoke_and_counts_each_detection_once(self):
        self.box.change({'incident': 'hot_spot', 'active': True})
        self.run_for(6)
        self.assertGreater(self.box.last['thermal_max'], 80)
        self.assertTrue(self.box.last['flame'])
        self.assertFalse(self.box.last['smoke'])
        self.run_for(12)
        self.assertTrue(self.box.last['smoke'])
        self.assertEqual(self.box.last['detections'], 2)
        self.box.change({'clear': True})
        self.run_for(10)
        self.assertFalse(self.box.last['flame'])
        self.assertLess(self.box.last['thermal_max'], 60)
        self.assertEqual(self.box.last['detections'], 2)

    def test_a_blocked_view_reports_unknown_not_clear(self):
        self.box.change({'incident': 'intrusion', 'active': True})
        self.run_for(2)
        self.assertTrue(self.box.last['person'])
        self.box.change({'incident': 'camera_blocked', 'active': True})
        self.run_for(3)
        self.assertTrue(self.box.last['camera_blocked'])
        self.assertIsNone(self.box.last['person'])
        self.assertIsNone(self.box.last['thermal_max'])
        nulls = {name for item, (name, _, key) in zip(self.box.readings(), METRICS) if item.is_null}
        self.assertEqual(nulls, {'Thermal/Max temperature', 'Thermal/Scene temperature', 'Detection/Flame', 'Detection/Flame confidence', 'Detection/Smoke', 'Detection/Person in zone'})
        # Uncovering the lens sees the person still there, without counting a second detection.
        self.box.change({'incident': 'camera_blocked', 'active': False})
        self.run_for(1)
        self.assertTrue(self.box.last['person'])
        self.assertEqual(self.box.last['detections'], 1)

    def test_battery_drains_on_battery_and_persists(self):
        self.box.change({'incident': 'power_cut', 'active': True})
        self.box.change({'battery': 25})
        self.run_for(60)
        self.assertTrue(self.box.last['on_battery'])
        self.assertAlmostEqual(self.box.last['battery'], 19.0, delta=0.2)
        saved = json.loads((Path(self.directory.name) / 'state.box.json').read_text())
        self.assertAlmostEqual(saved['battery'], 19.0, delta=0.2)
        for body in [{}, {'battery': 101}, {'battery': True}, {'incident': 'fire', 'active': True}, {'incident': 'smoke', 'active': 1}]:
            with self.assertRaises(ValueError):
                self.box.change(body)

    def test_controls_accept_only_local_same_origin_requests(self):
        server = serve_controls(self.box, 0)
        url = f'http://127.0.0.1:{server.server_port}/state'
        try:
            request = Request(url, data=json.dumps({'incident': 'smoke', 'active': True}).encode(), headers={'Content-Type': 'application/json'})
            self.assertEqual(json.loads(urlopen(request).read())['incidents'], ['smoke'])
            hostile = Request(url, data=b'{"clear": true}', headers={'Content-Type': 'application/json', 'Origin': 'https://example.com'})
            with self.assertRaises(HTTPError) as error:
                urlopen(hostile)
            self.assertEqual(error.exception.code, 403)
        finally:
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    unittest.main()
