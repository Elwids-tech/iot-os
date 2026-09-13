import json
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from rgb_controls import DEFAULT_STATE, load_state, save_state, serve_controls, validate_changes


class RGBControlsTest(unittest.TestCase):
    def test_validation_and_retention(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
            self.assertEqual(load_state(path), DEFAULT_STATE)
            values = {**DEFAULT_STATE, **validate_changes({"color": "#12abEF", "brightness": 0, "mode": "strobe"})}
            save_state(path, values)
            self.assertEqual(load_state(path), {**values, "color": "#12ABEF", "power": False})
        for changes in [{"power": 1}, {"brightness": True}, {"brightness": -1}, {"brightness": 101}, {"mode": "rainbow"}, {"color": "red"}, {"unexpected": 1}]:
            with self.assertRaises(ValueError):
                validate_changes(changes)

    def test_local_server_is_same_origin_and_uses_device_state(self):
        class Simulator:
            lock = threading.RLock()
            online = False
            values = dict(DEFAULT_STATE)
            def apply_rgb_changes(self, changes):
                self.values = {**self.values, **validate_changes(changes)}
        simulator = Simulator()
        server = serve_controls(simulator, 0)
        url = f"http://127.0.0.1:{server.server_port}"
        try:
            with urlopen(Request(url + "/state", data=b'{"power":true}', headers={"Content-Type": "application/json"})) as response:
                self.assertTrue(json.load(response)["values"]["power"])
            with self.assertRaises(HTTPError) as error:
                urlopen(Request(url + "/state", data=b'{"power":false}', headers={"Content-Type": "application/json", "Origin": "https://untrusted.example"}))
            self.assertEqual(error.exception.code, 403)
            self.assertTrue(simulator.values["power"])
        finally:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    unittest.main()
