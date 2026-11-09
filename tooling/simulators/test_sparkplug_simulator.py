import tempfile
import unittest
from pathlib import Path
from unittest import mock

import sparkplug_b_pb2 as sp
import sparkplug_simulator
from sparkplug_simulator import METER_INTERVAL, Simulator, meter_ids

CONFIG = {"username": "edge", "password": "test-only", "ca_file": "ca.crt", "group_id": "plant", "edge_node_id": "line-1", "host_id": "host"}


class MetersTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        with mock.patch.object(sparkplug_simulator.mqtt, "Client"):
            self.simulator = Simulator(CONFIG, Path(self.directory.name) / "state", meters=12)
        self.published = self.simulator.client.publish

    def tearDown(self):
        self.directory.cleanup()

    def messages(self):
        result = []
        for call in self.published.call_args_list:
            payload = sp.Payload()
            payload.ParseFromString(call.args[1])
            result.append((call.args[0], payload))
        return result

    def test_ids_are_zero_padded_in_order(self):
        self.assertEqual(meter_ids(3), ["meter-001", "meter-002", "meter-003"])
        self.assertEqual(meter_ids(1000)[-1], "meter-1000")
        self.assertEqual(meter_ids(0), [])
        self.assertEqual(meter_ids(2, 601), ["meter-601", "meter-602"])
        self.assertEqual(meter_ids(500, 601)[-1], "meter-1100")

    def test_birth_announces_every_meter_under_the_gateway_with_one_sequence(self):
        self.simulator.birth()
        messages = self.messages()
        births = [(topic, payload) for topic, payload in messages if "/DBIRTH/" in topic]
        self.assertEqual([topic.rsplit("/", 1)[1] for topic, _ in births], ["meter", "rgb-light", *meter_ids(12)])
        topic, payload = births[2]
        self.assertEqual(topic, "spBv1.0/plant/DBIRTH/line-1/meter-001")
        self.assertEqual([(m.name, m.datatype) for m in payload.metrics], [("flow_rate", sp.Double), ("total_volume", sp.Double)])
        self.assertEqual([payload.seq for _, payload in messages], list(range(len(messages))))

    def test_each_meter_reports_once_per_interval_by_alias(self):
        self.simulator.birth()
        self.published.reset_mock()
        for second in range(METER_INTERVAL):
            self.simulator.send_meters(second)
        topics = [topic for topic, _ in self.messages()]
        self.assertEqual(sorted(topic.rsplit("/", 1)[1] for topic in topics), meter_ids(12))
        _, payload = self.messages()[0]
        self.assertEqual([(m.alias, m.name) for m in payload.metrics], [(1, ""), (2, "")])

    def test_rebirth_requests_are_counted(self):
        request = sp.Payload()
        request.metrics.append(sparkplug_simulator.metric("Node Control/Rebirth", sp.Boolean, True))
        message = mock.Mock(topic="spBv1.0/plant/NCMD/line-1", payload=request.SerializeToString())
        with mock.patch("builtins.print") as printed:
            self.simulator.on_message(None, None, message)
            self.simulator.on_message(None, None, message)
        self.assertEqual(self.simulator.rebirths, 2)
        printed.assert_called_with("Rebirth requested (2 since start)", flush=True)


if __name__ == "__main__":
    unittest.main()
