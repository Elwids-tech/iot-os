import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

from waveshare_bridge import Bridge, METRICS, broker_endpoint, decode_command, metric, sp, validate

VALUES = {"power": False, "color": "#FF0000", "mode": "solid", "brightness": 20,
          "alarm_active": False, "alarm_mode": "beep", "volume": 15, "alarm_duration": 5}


class HardwareBridgeTest(unittest.TestCase):
    def test_staging_broker_requires_explicit_opt_in_and_verified_endpoint(self):
        self.assertEqual(broker_endpoint("ssl://localhost:8883"), ("localhost", 8883))
        self.assertEqual(broker_endpoint("ssl://mqtt.staging.elwids.xyz:8883", True), ("mqtt.staging.elwids.xyz", 8883))
        for url, allowed in [
            ("ssl://mqtt.staging.elwids.xyz:8883", False),
            ("mqtt://mqtt.staging.elwids.xyz:8883", True),
            ("ssl://mqtt.staging.elwids.xyz:1883", True),
            ("ssl://mqtt.elwids.xyz:8883", True),
            ("ssl://46.225.74.65:8883", True),
            ("ssl://mqtt.staging.elwids.xyz.attacker.test:8883", True),
            ("ssl://user:password@mqtt.staging.elwids.xyz:8883", True),
            ("ssl://mqtt.staging.elwids.xyz:8883?insecure=true", True),
        ]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                broker_endpoint(url, allowed)

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.client_patch = patch("waveshare_bridge.mqtt.Client")
        self.client_patch.start()
        self.addCleanup(self.client_patch.stop)
        self.bridge = Bridge({"username": "test", "password": "test", "ca_file": "unused",
                              "group_id": "test", "edge_node_id": "board", "host_id": "host"},
                             "unused", Path(self.directory.name) / "sequence")
        self.bridge.mqtt_connected = self.bridge.host_online = True

    def report(self, **changes):
        return {"protocol": "waveshare-audio.v1", "hardware_ok": True, "boot_id": 1,
                "seq": 1, "values": dict(VALUES), **changes}

    def test_commands_do_not_become_reported_state(self):
        self.bridge.accept_report(self.report())
        self.bridge.client.publish.reset_mock()
        payload = sp.Payload()
        payload.metrics.append(metric("Power", sp.Boolean, True))
        message = Mock(topic=self.bridge.topic("DCMD", "rgb-light"), payload=payload.SerializeToString(), retain=False)
        self.bridge.on_message(None, None, message)
        self.assertFalse(self.bridge.values["power"])
        self.assertEqual(self.bridge.commands.qsize(), 1)
        self.bridge.client.publish.assert_not_called()
        self.bridge.accept_report(self.report(seq=2, values={**VALUES, "power": True}))
        self.assertTrue(self.bridge.values["power"])
        self.assertEqual(self.bridge.client.publish.call_count, 1)

    def test_gateway_subscription_matches_literal_mosquitto_acl(self):
        reason = Mock(is_failure=False)
        self.bridge.on_connect(self.bridge.client, None, None, reason, None)
        self.bridge.client.subscribe.assert_called_once_with([
            (self.bridge.topic("NCMD"), 0),
            (self.bridge.topic("DCMD", "+"), 0),
            ("spBv1.0/STATE/host", 1),
        ])

    def test_commands_for_other_device_never_reach_the_board(self):
        self.bridge.accept_report(self.report())
        payload = sp.Payload()
        payload.metrics.append(metric("Power", sp.Boolean, True))
        message = Mock(topic=self.bridge.topic("DCMD", "another-device"), payload=payload.SerializeToString(), retain=False)
        self.bridge.on_message(None, None, message)
        self.assertTrue(self.bridge.commands.empty())

    def test_report_validation_rejects_replays_partial_and_faulted_states(self):
        self.bridge.accept_report(self.report())
        for report in [self.report(), self.report(seq=2, hardware_ok=False),
                       self.report(seq=2, values={"power": True}), self.report(seq=2, values={**VALUES, "volume": 101})]:
            with self.assertRaises(ValueError):
                self.bridge.accept_report(report)
        self.bridge.accept_report(self.report(boot_id=2, seq=0))
        self.assertEqual(self.bridge.boot_id, 2)

    def test_stale_offline_and_retained_commands_never_queue(self):
        self.bridge.accept_report(self.report())
        payload = sp.Payload()
        payload.metrics.append(metric("Alarm active", sp.Boolean, True))
        msg = Mock(topic=self.bridge.topic("DCMD", "rgb-light"), payload=payload.SerializeToString(), retain=True)
        self.bridge.on_message(None, None, msg)
        msg.retain = False
        self.bridge.last_report = time.monotonic() - 4
        self.bridge.on_message(None, None, msg)
        self.assertTrue(self.bridge.commands.empty())
        self.bridge.mark_offline()
        self.assertFalse(self.bridge.born)

    def test_strict_command_types_and_atomic_validation(self):
        for values in [{"brightness": True}, {"volume": -1}, {"alarm_duration": 0},
                       {"mode": "rainbow"}, {"alarm_active": 1}, {"power": True, "unexpected": 2}]:
            with self.assertRaises(ValueError):
                validate(values)
        payload = sp.Payload()
        item = metric("Volume", sp.Int32, 15, 7)
        item.ClearField("name")
        payload.metrics.append(item)
        self.assertEqual(decode_command(payload), {"volume": 15})
        payload.metrics[0].ClearField("int_value")
        with self.assertRaises(ValueError):
            decode_command(payload)

    def test_fixture_and_gateway_names_types_match(self):
        fixture = json.loads((Path(__file__).parents[2] / "contracts/definitions/device-profiles/waveshare-audio.v1.json").read_text())
        types = {"boolean": sp.Boolean, "string": sp.String, "enum": sp.String, "integer": sp.Int32}
        self.assertEqual([(p["key"], p["label"], types[p["data_type"]]) for p in fixture["parameters"]], METRICS)


if __name__ == "__main__":
    unittest.main()
