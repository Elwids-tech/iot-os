import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, MagicMock
import ssl

from notification_monitoring import alertmanager_config

spec = importlib.util.spec_from_file_location("watchdog", Path(__file__).parent / "pilot/watchdog.py")
watchdog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(watchdog)
reconcile_spec = importlib.util.spec_from_file_location("notification_reconcile", Path(__file__).parent / "pilot/reconcile_notifications.py")
notification_reconcile = importlib.util.module_from_spec(reconcile_spec)
reconcile_spec.loader.exec_module(notification_reconcile)


class NotificationsTest(unittest.TestCase):
    def test_unavailable_monitoring_never_clears_incidents(self):
        deployment = MagicMock()
        with patch.object(notification_reconcile, 'active_keys', side_effect=OSError('unavailable')):
            with self.assertRaises(OSError):
                notification_reconcile.reconcile(deployment)
        deployment.compose.assert_not_called()

    def test_watchdog_probes_the_configured_domain(self):
        opened, dialed = [], []
        response = MagicMock(status=200)
        response.__enter__.return_value = response
        with patch.object(watchdog.urllib.request, "urlopen", side_effect=lambda url, timeout: opened.append(url) or response), \
                patch.object(watchdog.socket, "create_connection", side_effect=lambda address, timeout: dialed.append(address) or MagicMock()), \
                patch.object(watchdog.ssl, "create_default_context") as context:
            self.assertEqual([], watchdog.probe({"domain": "elwids.xyz"}))
        self.assertEqual(["https://app.elwids.xyz/", "https://api.elwids.xyz/health/ready"], opened)
        self.assertEqual([("mqtt.elwids.xyz", 8883)], dialed)
        self.assertEqual("mqtt.elwids.xyz", context.return_value.wrap_socket.call_args.kwargs["server_hostname"])
        self.assertEqual("staging.elwids.xyz", watchdog.domain({}))

    def test_private_transport_keeps_tls_hostname_and_certificate_verification(self):
        connection = MagicMock()
        connection.getresponse.return_value.status = 200
        connection.getresponse.return_value.read.return_value = b'{"email_enabled":false}'
        config = {"notifications_token": "n" * 64, "notifications_private_host": "10.78.0.1"}
        with patch.object(watchdog.http.client, "HTTPSConnection", return_value=connection) as create, patch.object(watchdog.socket, "create_connection") as dial:
            self.assertFalse(watchdog.api_request(config, "/watchdog-preferences")["email_enabled"])
            args = create.call_args
            self.assertEqual(args.args[0], "api.staging.elwids.xyz")
            self.assertTrue(args.kwargs["context"].check_hostname)
            self.assertEqual(args.kwargs["context"].verify_mode, ssl.CERT_REQUIRED)
            connection._create_connection(("api.staging.elwids.xyz", 443), 8, None)
            dial.assert_called_once_with(("10.78.0.1", 443), 8, None)

    def test_webhook_receiver_has_no_parallel_smtp_route(self):
        config = alertmanager_config({"NOTIFICATION_INGEST_TOKEN": "n" * 64})
        receiver = config["receivers"][0]
        self.assertNotIn("email_configs", receiver)
        self.assertTrue(receiver["webhook_configs"][0]["send_resolved"])
        self.assertEqual(config['route']['group_interval'], '30s')

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
