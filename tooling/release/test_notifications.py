import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from notification_monitoring import alertmanager_config

spec = importlib.util.spec_from_file_location("watchdog", Path(__file__).parent / "pilot/watchdog.py")
watchdog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(watchdog)


class NotificationsTest(unittest.TestCase):
    def test_webhook_receiver_has_no_parallel_smtp_route(self):
        config = alertmanager_config({"NOTIFICATION_INGEST_TOKEN": "n" * 64})
        receiver = config["receivers"][0]
        self.assertNotIn("email_configs", receiver)
        self.assertTrue(receiver["webhook_configs"][0]["send_resolved"])

    def test_outage_records_and_replays_events_while_email_is_muted(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
            muted = {"email_enabled": False, "grid": {"critical": True, "recovery": True}}
            def unavailable(config, endpoint, payload=None):
                if endpoint == "/watchdog-preferences":
                    return muted
                raise OSError("API down")
            with patch.object(watchdog, "probe", return_value=["API"]), patch.object(watchdog, "api_request", side_effect=unavailable), patch.object(watchdog, "send_email") as mail:
                for _ in range(4):
                    state = watchdog.run({}, path)
                mail.assert_not_called()
                self.assertTrue(state["active"])
                self.assertEqual(len(state["pending_events"]), 1)
            delivered = []
            def recovered(config, endpoint, payload=None):
                if endpoint == "/watchdog-preferences":
                    return muted
                delivered.append(payload["status"])
                return {"accepted": True}
            with patch.object(watchdog, "probe", return_value=[]), patch.object(watchdog, "api_request", side_effect=recovered), patch.object(watchdog, "send_email") as mail:
                state = watchdog.run({}, path)
                mail.assert_not_called()
            self.assertEqual(delivered, ["firing", "resolved"])
            self.assertFalse(state["active"])
            self.assertEqual(state["pending_events"], [])

    def test_preference_api_failure_retains_a_cached_opt_out(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
            path.write_text(json.dumps({"failures": 2, "active": False, "last_sent": 0, "preferences": {"email_enabled": False, "grid": {"critical": True}}}))
            with patch.object(watchdog, "probe", return_value=["API"]), patch.object(watchdog, "api_request", side_effect=OSError("down")), patch.object(watchdog, "send_email") as mail:
                state = watchdog.run({}, path)
                mail.assert_not_called()
                self.assertTrue(state["active"])


if __name__ == "__main__":
    unittest.main()
