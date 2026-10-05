import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

import yaml

spec = importlib.util.spec_from_file_location("release", Path(__file__).with_name("manage.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
    def test_mosquitto_is_opt_in_and_admin_has_no_public_port(self):
        with tempfile.TemporaryDirectory() as temp:
            deployment = self.deployment(temp)
            self.assertEqual(deployment.broker, 'emqx')
            deployment.env['DEVICE_BROKER_PROVIDER'] = 'mosquitto'
            self.assertEqual(deployment.broker, 'mqtt')
            self.assertEqual(deployment.broker_uid, 1883)
            overlay = yaml.safe_load((release.RELEASE/'compose.mosquitto.yml').read_text())['services']
            self.assertNotIn('ports', overlay['broker-admin'])
            self.assertEqual(overlay['mqtt']['ports'], ['8883:8883'])
            self.assertEqual(overlay['emqx']['profiles'], ['legacy-broker'])
            deployment.render()
            prometheus = yaml.safe_load((deployment.config/'prometheus.yml').read_text())
            probe = next(job for job in prometheus['scrape_configs'] if job['job_name'] == 'health')
            self.assertIn('http://broker-admin:8082/health/ready', probe['static_configs'][0]['targets'])

    def test_mosquitto_backup_quiesces_adapter_and_broker(self):
        with tempfile.TemporaryDirectory() as temp:
            deployment = self.deployment(temp)
            deployment.config.mkdir()
            deployment.env['DEVICE_BROKER_PROVIDER'] = 'mosquitto'
            with patch.object(deployment,'restic'), patch.object(deployment,'running',return_value=['mqtt','broker-admin','api']), patch.object(deployment,'compose') as compose, patch.object(deployment,'database_command',side_effect=RuntimeError('dump failed')), patch.object(release.time,'sleep'):
                with self.assertRaises(RuntimeError): deployment.backup('backup')
            self.assertEqual(compose.call_args_list[0].args, ('stop','caddy','simulator','gps-simulator','mqtt','broker-admin'))
            self.assertEqual(compose.call_args_list[-2].args, ('up','-d','--no-recreate','--wait','mqtt'))
            self.assertEqual(compose.call_args_list[-1].args, ('start','broker-admin','api'))

    def test_external_database_rejects_public_loopback_and_hostname_targets(self):
        with tempfile.TemporaryDirectory() as temp:
            deployment = self.deployment(temp)
            for host in ('8.8.8.8', '127.0.0.1', '169.254.169.254', 'database.example.com', '', '::1'):
                deployment.env['DATABASE_HOST'] = host
                with self.subTest(host=host), self.assertRaises(ValueError):
                    deployment.validate_database_host()
            deployment.env['DATABASE_HOST'] = '10.78.0.2'
            deployment.validate_database_host()

    def test_external_database_uses_tunnel_and_disposable_client(self):
        with tempfile.TemporaryDirectory() as temp:
            deployment = self.deployment(temp)
            deployment.env['DATABASE_HOST'] = '10.78.0.2'
            with patch.object(release, 'run', return_value=SimpleNamespace(stdout='[{"dev":"wg-elwids"}]')), patch.object(deployment, 'compose') as compose:
                deployment.database_ready()
                self.assertEqual(compose.call_args.args[:5], ('run', '--rm', '--no-deps', '-T', 'db-client'))
            with patch.object(release, 'run', return_value=SimpleNamespace(stdout='[{"dev":"eth0"}]')), patch.object(deployment, 'compose') as compose:
                with self.assertRaisesRegex(ValueError, 'WireGuard'):
                    deployment.database_ready()
                compose.assert_not_called()

    def test_external_restore_never_contacts_live_database(self):
        with tempfile.TemporaryDirectory() as temp:
            deployment = self.deployment(temp)
            deployment.env['DATABASE_HOST'] = '10.78.0.2'
            with patch.object(deployment, 'compose') as compose, patch.object(deployment, 'restic') as restic:
                with self.assertRaisesRegex(ValueError, 'Remote database restore is disabled'):
                    deployment.restore('backup.env', 'latest', Path(temp)/'restore')
                compose.assert_not_called()
                restic.assert_not_called()

    def test_external_database_host_is_monitored_over_its_private_address(self):
        with tempfile.TemporaryDirectory() as temp:
            deployment = self.deployment(temp)
            deployment.env['DATABASE_HOST'] = '10.78.0.2'
            deployment.render()
            prometheus = yaml.safe_load((deployment.config/'prometheus.yml').read_text())
            host = next(job for job in prometheus['scrape_configs'] if job['job_name'] == 'host')
            self.assertIn({'targets': ['10.78.0.2:9100'], 'labels': {'role': 'database'}}, host['static_configs'])

    def deployment(self, root):
        root = Path(root)
        values = release.read_env(release.RELEASE/'environment.example')
        values.update({key: 'a'*64 for key in release.SECRET_KEYS})
        values['DEVICE_EMQX_API_KEY'] = 'a'*24
        values.update(STATE_DIR=str(root/'state'), CONFIG_DIR=str(root/'private'), DOMAIN='staging.example.test', ACME_EMAIL='operator@example.test', MAIL_FROM_ADDRESS='app@example.test', MAIL_USERNAME='application', MAIL_PASSWORD='application-password', ALERT_EMAIL='operator@example.test')
        path = root/'environment'
        release.private_write(path, ''.join(k+'='+v+'\n' for k,v in values.items()))
        return release.Deployment(path, None)

    def test_stream_budget_requires_headroom(self):
        with tempfile.TemporaryDirectory() as temp:
            deployment = self.deployment(temp)
            self.assertEqual(deployment.nats_capacity(), 24<<30)
            deployment.env['IOT_NATS_STORE_MAX_BYTES'] = str(20<<30)
            with self.assertRaisesRegex(ValueError, '10%'):
                deployment.nats_capacity()
            deployment.env['IOT_NATS_STORE_MAX_BYTES'] = '-1'
            with self.assertRaisesRegex(ValueError, 'between'):
                deployment.nats_capacity()

    def test_release_monitoring_uses_staging_routes_and_separate_smtp(self):
        with tempfile.TemporaryDirectory() as temp:
            deployment = self.deployment(temp)
            deployment.env.update(ALERT_SMTP_USERNAME='alert-key', ALERT_SMTP_PASSWORD='alert-password')
            deployment.render()
            alert = yaml.safe_load((deployment.config/'alertmanager.yml').read_text())
            self.assertEqual(alert['global']['smtp_auth_username'], 'alert-key')
            self.assertEqual(alert['global']['smtp_auth_password'], 'alert-password')
            self.assertTrue(alert['global']['smtp_require_tls'])
            self.assertEqual(alert['route']['routes'][0]['repeat_interval'], '30m')
            rules = yaml.safe_load((deployment.config/'alerts.yml').read_text())
            names = {r['alert'] for g in rules['groups'] for r in g['rules']}
            self.assertTrue({'BackupOverdue', 'StreamCapacityLow', 'WorkerStalled', 'RestoreDrillOverdue'} <= names)
            self.assertNotIn('localhost', (deployment.config/'alerts.yml').read_text())
            self.assertNotIn('environment="local"', (deployment.config/'loki-rules/fake/errors.yml').read_text())
            dashboard = json.loads((deployment.config/'dashboards/platform.json').read_text())
            self.assertEqual(dashboard['uid'], 'iot-platform')
            self.assertNotIn('Mailpit', json.dumps(dashboard))
            self.assertEqual((deployment.config/'dashboards').stat().st_mode & 0o777, 0o755)
            deployment.env.update(ALERT_SMTP_USERNAME='', ALERT_SMTP_PASSWORD='', ALERT_FROM_ADDRESS='')
            deployment.render()
            alert = yaml.safe_load((deployment.config/'alertmanager.yml').read_text())
            self.assertEqual(alert['global']['smtp_auth_username'], 'application')
            self.assertEqual(alert['global']['smtp_from'], 'app@example.test')

    def test_webroot_dry_run_cleans_bootstrap_and_never_restarts_broker(self):
        with tempfile.TemporaryDirectory() as temp:
            deployment = self.deployment(temp)
            with patch.object(deployment, 'running', return_value=[]), patch.object(deployment, 'compose', return_value=SimpleNamespace(stdout='a'*64)) as compose, patch.object(release, 'run') as run:
                deployment.certificates(dry_run=True)
            args = run.call_args_list[0].args[0]
            self.assertIn('--webroot', args)
            self.assertIn('--dry-run', args)
            self.assertNotIn('--dns-cloudflare', args)
            self.assertEqual(run.call_args_list[-1].args[0], ['docker', 'stop', 'a'*64])
            self.assertEqual(compose.call_count, 1)
            self.assertFalse((deployment.state/'mqtt-certs').exists())

    def test_webroot_failure_always_cleans_temporary_server(self):
        with tempfile.TemporaryDirectory() as temp:
            deployment = self.deployment(temp)
            with patch.object(deployment, 'running', return_value=[]), patch.object(deployment, 'compose', return_value=SimpleNamespace(stdout='b'*64)), patch.object(release, 'run', side_effect=[RuntimeError('issuance failed'), None]) as run:
                with self.assertRaisesRegex(RuntimeError, 'issuance failed'):
                    deployment.certificates()
            self.assertEqual(run.call_args_list[-1].args[0], ['docker', 'stop', 'b'*64])

    def test_monitoring_failure_withholds_external_heartbeat(self):
        with tempfile.TemporaryDirectory() as temp:
            deployment = self.deployment(temp)
            deployment.env['MONITORING_HEARTBEAT_URL'] = 'https://heartbeat.example.test/private'
            with patch.object(deployment, 'compose', side_effect=RuntimeError('unhealthy')), patch.object(deployment, 'ping_heartbeat') as ping:
                with self.assertRaises(RuntimeError): deployment.monitoring_heartbeat()
                ping.assert_not_called()

    def test_automation_worker_is_stopped_and_resumed_during_backup(self):
        compose = yaml.safe_load((release.RELEASE/'compose.yml').read_text())
        worker = compose['services']['automation-worker']
        self.assertEqual(worker['environment']['IOT_WORKER_NAME'], 'automation')
        self.assertIn('automation-worker', release.WRITERS)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root/'private').mkdir()
            path = root/'env'
            release.private_write(path, f'STATE_DIR={temp}/state\nCONFIG_DIR={temp}/private\n')
            deployment = release.Deployment(path, None)
            calls = []
            def fail_dump(*args, **kwargs):
                calls.append(args)
                if args[0] == 'exec':
                    raise RuntimeError('dump failed')
            with patch.object(deployment, 'restic'), patch.object(deployment, 'running', return_value=['api', 'automation-worker', 'nats']), patch.object(deployment, 'compose', side_effect=fail_dump), patch.object(release.time, 'sleep'):
                with self.assertRaisesRegex(RuntimeError, 'dump failed'):
                    deployment.backup('private-env')
            self.assertTrue(any(call[0] == 'stop' and 'automation-worker' in call for call in calls))
            writers_stop = next(i for i, call in enumerate(calls) if call[0] == 'stop' and 'automation-worker' in call)
            self.assertLess(writers_stop, calls.index(('stop', 'nats')))
            self.assertEqual(calls[-2], ('up', '-d', '--no-recreate', '--wait', 'nats'))
            self.assertEqual(calls[-1], ('start', 'api', 'automation-worker'))

    def test_environment_is_literal_not_shell_code(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)/"env"
            path.write_text('KEY=$(touch /tmp/do-not-create)\nQUOTED="with spaces"\n')
            self.assertEqual(release.read_env(path), {"KEY": "$(touch /tmp/do-not-create)", "QUOTED": "with spaces"})

    def test_private_write_permissions_and_replacement(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)/"secret"
            release.private_write(path, "first")
            release.private_write(path, "second")
            self.assertEqual(path.read_text(), "second")
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_release_exposes_only_ingress_and_mqtt(self):
        compose = yaml.safe_load((release.RELEASE/"compose.yml").read_text())
        public = {key: value["ports"] for key, value in compose["services"].items() if value.get("ports")}
        self.assertEqual(public, {"caddy": ["80:80", "443:443"], "emqx": ["8883:8883"]})
        self.assertNotIn("build", compose["services"]["api"])
        self.assertEqual(compose["services"]["api"]["environment"]["APP_DEBUG"], "false")
        self.assertEqual(compose["services"]["migrate"]["restart"], "no")
        self.assertEqual(compose["services"]["simulator"]["profiles"], ["demo"])

    def test_restore_refuses_nonempty_state_before_touching_docker(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            state = root/"state"
            state.mkdir()
            (state/"valuable").write_text("preserve")
            env = root/"env"
            env.write_text(f"STATE_DIR={state}\nCONFIG_DIR={root}/private\n")
            deployment = release.Deployment(env, None)
            with patch.object(deployment, "compose") as compose:
                with self.assertRaisesRegex(ValueError, "empty"):
                    deployment.restore(None, "snapshot", root/"restored")
                compose.assert_not_called()

    def test_production_refuses_demo_configuration(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)/"env"
            release.private_write(path, f"STATE_DIR={temp}/state\nCONFIG_DIR={temp}/private\nDEPLOY_ENVIRONMENT=production\nIOT_STAGING_DEMO_ENABLED=true\n")
            with self.assertRaisesRegex(ValueError, "disable demo"):
                release.Deployment(path, None).validate()

    def test_failed_remote_preflight_does_not_stop_services(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)/'env'
            release.private_write(path, f'STATE_DIR={temp}/state\nCONFIG_DIR={temp}/private\n')
            deployment = release.Deployment(path, None)
            with patch.object(deployment, 'restic', side_effect=RuntimeError('offline')), patch.object(deployment, 'compose') as compose:
                with self.assertRaisesRegex(RuntimeError, 'offline'):
                    deployment.backup('private-env')
                compose.assert_not_called()

    def test_backup_failure_resumes_only_previously_running_services(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root/'private').mkdir()
            path = root/'env'
            release.private_write(path, f'STATE_DIR={temp}/state\nCONFIG_DIR={temp}/private\n')
            deployment = release.Deployment(path, None)
            calls = []
            def compose(*args, **kwargs):
                calls.append(args)
                if args[0] == 'exec':
                    raise RuntimeError('dump failed')
            with patch.object(deployment, 'restic'), patch.object(deployment, 'running', return_value=['api','runtime','nats']), patch.object(deployment, 'compose', side_effect=compose), patch.object(release.time, 'sleep'):
                with self.assertRaisesRegex(RuntimeError, 'dump failed'):
                    deployment.backup('private-env')
            self.assertEqual(calls[-2], ('up','-d','--no-recreate','--wait','nats'))
            self.assertEqual(calls[-1], ('start','api','runtime'))
            self.assertEqual(list((root/'private').glob('checkpoint-*')), [])


if __name__ == "__main__":
    unittest.main()
