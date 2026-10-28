import fcntl
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch
from types import SimpleNamespace

import yaml

spec = importlib.util.spec_from_file_location("release", Path(__file__).with_name("manage.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
spec = importlib.util.spec_from_file_location("ship", Path(__file__).with_name("ship.py"))
ship = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ship)


class ReleaseTests(unittest.TestCase):
    def test_adapter_manager_and_worker_are_private_opt_in_services(self):
        overlay = yaml.safe_load((release.RELEASE/'compose.adapters.yml').read_text())['services']
        self.assertNotIn('ports', overlay['adapter-manager'])
        self.assertEqual(['private'], overlay['adapter-manager']['networks'])
        self.assertNotIn('/var/run/docker.sock:/var/run/docker.sock', overlay['adapter-worker']['volumes'])
        self.assertIn('/var/run/docker.sock:/var/run/docker.sock', overlay['adapter-manager']['volumes'])
        self.assertEqual('database', overlay['api']['environment']['IOT_ADAPTER_QUEUE_CONNECTION'])
        with tempfile.TemporaryDirectory() as temp:
            deployment = self.deployment(temp)
            self.assertFalse(deployment.adapters_enabled)
            self.assertEqual([], deployment.adapter_containers())
            deployment.env['IOT_ADAPTERS_ENABLED'] = 'true'
            with patch.object(release,'run',return_value=SimpleNamespace(stdout=b'')) as run:
                deployment.compose('config','--quiet')
            self.assertIn(release.RELEASE/'compose.adapters.yml', run.call_args.args[0])
            self.assertIn('webhook-receiver', run.call_args.kwargs['env']['EXPECTED_SERVICES'].split(','))

    def test_every_adapter_overlay_service_is_started_and_expected(self):
        overlay = yaml.safe_load((release.RELEASE/'compose.adapters.yml').read_text())['services']
        # Services with their own image are new containers; the rest only add settings to release services.
        self.assertEqual(sorted(name for name, service in overlay.items() if 'image' in service), sorted(release.ADAPTER_SERVICES))
        receiver = overlay['webhook-receiver']
        self.assertNotIn('ports', receiver)
        self.assertTrue(receiver['read_only'])
        self.assertNotIn('/var/run/docker.sock:/var/run/docker.sock', receiver['volumes'])

    def test_mosquitto_is_the_broker_and_admin_has_no_public_port(self):
        services = yaml.safe_load((release.RELEASE/'compose.yml').read_text())['services']
        self.assertNotIn('emqx', services)
        self.assertNotIn('ports', services['broker-admin'])
        self.assertEqual(services['mqtt']['ports'], ['8883:8883'])
        self.assertFalse((release.RELEASE/'compose.mosquitto.yml').exists())
        with tempfile.TemporaryDirectory() as temp:
            deployment = self.deployment(temp)
            deployment.render()
            prometheus = yaml.safe_load((deployment.config/'prometheus.yml').read_text())
            probe = next(job for job in prometheus['scrape_configs'] if job['job_name'] == 'health')
            self.assertIn('http://broker-admin:8082/health/ready', probe['static_configs'][0]['targets'])
            self.assertIn('sync_interval: always', (deployment.config/'nats.conf').read_text())

    def test_mosquitto_backup_quiesces_adapter_and_broker(self):
        with tempfile.TemporaryDirectory() as temp:
            deployment = self.deployment(temp)
            deployment.config.mkdir()
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
        values.update(DEVICE_BROKER_ADMIN_TOKEN='b'*64, MOSQUITTO_ADMIN_PASSWORD='c'*64)
        values.update(STATE_DIR=str(root/'state'), CONFIG_DIR=str(root/'private'), DOMAIN='staging.example.test', ACME_EMAIL='operator@example.test', MAIL_FROM_ADDRESS='app@example.test', MAIL_USERNAME='application', MAIL_PASSWORD='application-password', ALERT_EMAIL='operator@example.test')
        path = root/'environment'
        release.private_write(path, ''.join(k+'='+v+'\n' for k,v in values.items()))
        return release.Deployment(path, None)

    def test_domain_rename_keeps_previous_hostnames_working(self):
        with tempfile.TemporaryDirectory() as temp:
            deployment = self.deployment(temp)
            deployment.render()
            self.assertEqual('', (deployment.config/'legacy.Caddyfile').read_text())
            self.assertEqual('', (deployment.config/'legacy-acme.Caddyfile').read_text())
            deployment.env.update(DOMAIN='example.test', LEGACY_DOMAIN='staging.example.test')
            deployment.render()
            redirects = (deployment.config/'legacy.Caddyfile').read_text()
            for host in ('app', 'admin', 'api', 'ops'):
                self.assertIn(f'{host}.staging.example.test {{\n    redir https://{host}.example.test{{uri}} 308', redirects)
            self.assertIn('http://mqtt.staging.example.test {', (deployment.config/'legacy-acme.Caddyfile').read_text())
            with patch.object(release, 'run') as run, patch.object(deployment, 'running', return_value=['caddy']):
                deployment.certificates(dry_run=True)
            args = run.call_args.args[0]
            self.assertEqual(['mqtt.example.test', 'mqtt.staging.example.test'], [args[i+1] for i, arg in enumerate(args) if arg == '-d'])
            self.assertIn('--expand', args)
            self.assertEqual('mqtt.example.test', args[args.index('--cert-name')+1])
            for invalid in ('example.test', 'not a domain'):
                deployment.env['LEGACY_DOMAIN'] = invalid
                with self.assertRaisesRegex(ValueError, 'LEGACY_DOMAIN'):
                    deployment.validate()
            caddy = yaml.safe_load((release.RELEASE/'compose.yml').read_text())['services']['caddy']['volumes']
            self.assertIn('${CONFIG_DIR:?}/legacy.Caddyfile:/etc/caddy/legacy.Caddyfile:ro', caddy)

    def test_webhook_receiver_host_is_rendered_only_with_adapters(self):
        with tempfile.TemporaryDirectory() as temp:
            deployment = self.deployment(temp)
            deployment.render()
            self.assertEqual('', (deployment.config/'webhooks.Caddyfile').read_text())
            deployment.env.update(IOT_WEBHOOK_PUBLIC_URL='https://hooks.staging.example.test', IOT_ADAPTERS_ENABLED='true')
            deployment.render()
            hooks = (deployment.config/'webhooks.Caddyfile').read_text()
            self.assertIn('hooks.staging.example.test {', hooks)
            self.assertIn('@ingest path /w/*', hooks)
            self.assertIn('reverse_proxy webhook-receiver:8095', hooks)
            deployment.env['IOT_WEBHOOK_PUBLIC_URL'] = 'http://hooks.staging.example.test'
            with self.assertRaisesRegex(ValueError, 'IOT_WEBHOOK_PUBLIC_URL'):
                deployment.render()

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
            actual = next(r['expr'] for g in rules['groups'] for r in g['rules'] if r['alert'] == 'TelemetryStalled')
            expected = yaml.safe_load((release.RELEASE/'monitoring/alerts.yml').read_text())
            expression = next(r['expr'] for g in expected['groups'] for r in g['rules'] if r['alert'] == 'TelemetryStalled')
            self.assertEqual(actual, expression)
            self.assertIn('iot_simulator_expected_devices > 0', actual)
            self.assertTrue({'BackupOverdue', 'StreamCapacityLow', 'MessagesDeadLettered', 'WorkerStalled', 'RestoreDrillOverdue'} <= names)
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

    def test_runtime_starts_after_the_control_plane(self):
        services = yaml.safe_load((release.RELEASE/"compose.yml").read_text())["services"]
        self.assertTrue(services["runtime"]["environment"]["DEVICE_CONTROL_URL"].startswith("http://api-web/"))
        self.assertEqual(services["runtime"]["depends_on"], {"api-web": {"condition": "service_started"}})

    def test_connection_kits_ship_the_cas_the_runtime_trusts(self):
        services = yaml.safe_load((release.RELEASE/"compose.yml").read_text())["services"]
        trusted = services["runtime"]["environment"]["DEVICE_MQTT_CA_FILE"]
        for name in ("api", "default-worker"):
            self.assertEqual(services[name]["environment"]["DEVICE_MQTT_CA_FILE"], trusted)

    def test_release_exposes_only_ingress_and_mqtt(self):
        compose = yaml.safe_load((release.RELEASE/"compose.yml").read_text())
        public = {key: value["ports"] for key, value in compose["services"].items() if value.get("ports")}
        self.assertEqual(public, {"caddy": ["80:80", "443:443"], "mqtt": ["8883:8883"]})
        self.assertNotIn("build", compose["services"]["api"])
        self.assertEqual(compose["services"]["api"]["environment"]["APP_DEBUG"], "false")
        self.assertEqual(compose["services"]["migrate"]["restart"], "no")
        self.assertEqual(compose["services"]["simulator"]["profiles"], ["demo"])

    def test_the_installed_source_is_readable_by_the_containers_that_mount_it(self):
        # Grafana (uid 472) reads its provisioning directory from the installed source.
        # Unpacked under ship's umask 077, every directory was 0700 and Grafana could not.
        mounts = set()
        for name in ("compose.yml", "compose.adapters.yml", "compose.database.yml", "compose.external-db.yml"):
            for service in yaml.safe_load((release.RELEASE/name).read_text())["services"].values():
                for volume in service.get("volumes", []):
                    source = volume.split(":")[0] if isinstance(volume, str) else volume.get("source", "")
                    if source.startswith("."):
                        mounts.add((release.RELEASE/source).resolve().relative_to(release.ROOT))
        self.assertIn(Path("deploy/monitoring/local/grafana/provisioning"), mounts)
        with tempfile.TemporaryDirectory() as temp:
            archive, installed = Path(temp)/"source.tar.gz", Path(temp)/"source"
            subprocess.run(["git", "archive", "--format=tar.gz", "-o", archive, "HEAD"], cwd=release.ROOT, check=True)
            installed.mkdir(mode=0o700)
            umask = os.umask(0o077)
            try:
                ship.unpack(archive, installed)
            finally:
                os.umask(umask)
            for mount in mounts:
                self.assertTrue((installed/mount).exists(), f"{mount} is mounted but not in the source")
            for path in [installed, *installed.rglob("*")]:
                expected = {"0o755"} if path.is_dir() else {"0o644", "0o755"}
                self.assertIn(oct(path.stat().st_mode & 0o777), expected, path.relative_to(installed))

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

    def test_passport_keys_are_added_once_and_survive_quoting(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)/"env"
            release.private_write(path, "DOMAIN=example.com\n")
            self.assertTrue(release.add_passport_keys(path))
            first = release.read_env(path)
            self.assertTrue(first["PASSPORT_PRIVATE_KEY"].startswith("-----BEGIN PRIVATE KEY-----\n"))
            self.assertTrue(first["PASSPORT_PUBLIC_KEY"].startswith("-----BEGIN PUBLIC KEY-----\n"))
            self.assertEqual(first["DOMAIN"], "example.com")
            self.assertFalse(release.add_passport_keys(path))
            self.assertEqual(release.read_env(path), first)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_docker_run_environment_passes_multi_line_values_exactly(self):
        key = "-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----\n"
        arguments, environment = release.docker_run_environment({"PASSPORT_PRIVATE_KEY": key, "DB_HOST": "db"})
        self.assertEqual(["-e", "PASSPORT_PRIVATE_KEY", "-e", "DB_HOST"], arguments)
        self.assertEqual(key, environment["PASSPORT_PRIVATE_KEY"])
        self.assertEqual("db", environment["DB_HOST"])
        self.assertIn("PATH", environment)

    def test_a_lone_passport_key_is_never_regenerated(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)/"env"
            release.private_write(path, 'PASSPORT_PUBLIC_KEY="kept"\n')
            with self.assertRaisesRegex(ValueError, "Only one Passport key"):
                release.add_passport_keys(path)

    def test_agent_access_needs_passport_keys(self):
        with tempfile.TemporaryDirectory() as temp:
            deployment = self.deployment(temp)
            deployment.env['APP_KEY'] = 'base64:'+'a'*44
            # Validation stops at the missing release manifest once every earlier check passes.
            with self.assertRaisesRegex(ValueError, 'release manifest'):
                deployment.validate()
            deployment.env['IOT_AGENTS_ENABLED'] = 'true'
            with self.assertRaisesRegex(ValueError, 'without Passport keys'):
                deployment.validate()
            deployment.env.update(release.passport_keys())
            with self.assertRaisesRegex(ValueError, 'release manifest'):
                deployment.validate()

    def test_api_web_serves_agent_discovery_but_still_hides_dotfiles(self):
        config = (release.ROOT/'deploy/docker/api/nginx.release.conf').read_text()
        discovery = config.index('location ^~ /.well-known/ { try_files $uri /index.php?$query_string; }')
        self.assertLess(discovery, config.index('location ~ /\\. { deny all; }'))

    def test_smoke_checks_agent_discovery_only_when_agents_are_on(self):
        class Ok:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *args): return False
        with tempfile.TemporaryDirectory() as temp:
            deployment = self.deployment(temp)
            discovery = 'https://api.staging.example.test/.well-known/oauth-protected-resource/mcp'
            with patch.object(release.urllib.request, 'urlopen', return_value=Ok()) as opened:
                deployment.smoke()
                self.assertNotIn(discovery, [call.args[0] for call in opened.call_args_list])
                deployment.env['IOT_AGENTS_ENABLED'] = 'true'
                deployment.smoke()
                self.assertIn(discovery, [call.args[0] for call in opened.call_args_list])

    def test_production_refuses_demo_configuration(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)/"env"
            release.private_write(path, f"STATE_DIR={temp}/state\nCONFIG_DIR={temp}/private\nDEVICE_BROKER_ADMIN_TOKEN={'b'*64}\nMOSQUITTO_ADMIN_PASSWORD={'c'*64}\nDEPLOY_ENVIRONMENT=production\nIOT_STAGING_DEMO_ENABLED=true\n")
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

    def hold_operation_lock(self, deployment, seconds):
        deployment.config.mkdir(parents=True, exist_ok=True)
        holder = (deployment.config/'operation.lock').open('w')
        fcntl.flock(holder, fcntl.LOCK_EX)
        threading.Timer(seconds, holder.close).start()

    def test_operation_lock_fails_without_a_wait_and_waits_when_asked(self):
        with tempfile.TemporaryDirectory() as temp:
            deployment = self.deployment(temp)
            self.hold_operation_lock(deployment, 0.5)
            with self.assertRaisesRegex(BlockingIOError, 'Another release operation holds the lock'):
                with deployment.lock():
                    pass
            with deployment.lock(5):
                pass

    def test_scheduled_commands_wait_for_a_timer_that_holds_the_lock(self):
        # The pilot's backup and metrics timers lost this race to the notification
        # reconciler whenever systemd started them in the same second.
        with tempfile.TemporaryDirectory() as temp:
            deployment = self.deployment(temp)
            for command in ('metrics', 'backup'):
                self.hold_operation_lock(deployment, 0.5)
                argv = ['manage.py', command, '--env', str(deployment.env_path), '--backup-env', 'private-env']
                with patch.object(release.sys, 'argv', argv), patch.object(release.os, 'umask'), patch.object(release.Deployment, 'backup') as backup:
                    release.main()
                if command == 'backup':
                    backup.assert_called_once_with('private-env')
            self.assertTrue((deployment.state/'metrics/containers.prom').is_file())

    def test_new_environments_get_generated_mosquitto_secrets(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)/'environment'
            with patch.object(release.sys, 'argv', ['manage.py', 'init', '--env', str(path)]), patch.object(release.os, 'umask'):
                release.main()
            values = release.read_env(path)
            for key in release.BROKER_KEYS:
                self.assertRegex(values[key], r'^[a-f0-9]{64}$')
            self.assertFalse(any('EMQX' in key or key == 'DEVICE_BROKER_PROVIDER' for key in values))

    def test_an_environment_still_on_emqx_is_refused(self):
        # ADR-019: deploying over EMQX would start an empty Mosquitto and drop every device.
        with tempfile.TemporaryDirectory() as temp:
            deployment = self.deployment(temp)
            deployment.env['DEVICE_BROKER_PROVIDER'] = 'emqx'
            with self.assertRaisesRegex(ValueError, 'still runs EMQX'):
                deployment.validate()
            del deployment.env['DEVICE_BROKER_PROVIDER']
            (deployment.state/'emqx').mkdir(parents=True)
            with self.assertRaisesRegex(ValueError, 'still runs EMQX'):
                deployment.validate()
            # A migrated environment keeps its old EMQX directory next to Mosquitto's state.
            (deployment.state/'mosquitto').mkdir()
            (deployment.state/'mosquitto/dynamic-security.json').write_text('{}')
            deployment.refuse_emqx()


if __name__ == "__main__":
    unittest.main()
