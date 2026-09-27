import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import yaml

spec = importlib.util.spec_from_file_location("release", Path(__file__).with_name("manage.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
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
            self.assertEqual(calls[-1], ('start','api','runtime','nats'))
            self.assertEqual(list((root/'private').glob('checkpoint-*')), [])


if __name__ == "__main__":
    unittest.main()
