import base64
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import MagicMock, patch
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location("ship", Path(__file__).with_name("ship.py"))
ship = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ship)
from manage import read_env  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
RUNNING, STAGED = "a" * 40, "b" * 40
CHECKS = {"format": 1, "routes": ["PUT api/v1/admin/platform-team/{user}"], "tables": ["assistant_settings"]}


def make_archive(path, commit, files):
    """A gzip tar with the pax header `git archive` writes for a commit."""
    with tarfile.open(path, "w:gz", format=tarfile.PAX_FORMAT, pax_headers={"comment": commit} if commit else {}) as tar:
        for name, text in files.items():
            data = text.encode()
            info = tarfile.TarInfo(name)
            info.size, info.mode = len(data), 0o644
            tar.addfile(info, io.BytesIO(data))
    Path(str(path) + ".sha256").write_text(hashlib.sha256(path.read_bytes()).hexdigest() + "  " + path.name + "\n")


def tree(commit, checks=CHECKS):
    files = {"tooling/release/manage.py": commit, "deploy/release/compose.yml": "services: {}\n"}
    if checks is not None:
        files[ship.CHECKS] = json.dumps(checks)
    return files


class Host:
    """An application host: private configuration, an installed source and a staged release."""

    def __init__(self, root, environment="IOT_STAGING_DEMO_ENABLED=false\n"):
        root = Path(root)
        self.config = root / "private"
        self.env = self.config / "application.env"
        ship.private_write(self.env, f"STATE_DIR={root}/state\nCONFIG_DIR={self.config}\nDOMAIN=example.test\nCOMPOSE_PROJECT_NAME=iot-test\n" + environment)
        ship.private_write(self.config / "current-release.json", json.dumps({"format": 1, "commit": RUNNING, "images": {}}))
        self.source = root / "srv/source"
        for name, text in tree(RUNNING).items():
            (self.source / name).parent.mkdir(parents=True, exist_ok=True)
            (self.source / name).write_text(text)
        self.release = self.config / "releases" / STAGED[:7]
        self.release.mkdir(parents=True)
        (self.release / "release.json").write_text(json.dumps({"format": 1, "commit": STAGED, "images": {}}))
        (self.release / "release-origin.json").write_text(json.dumps({"format": 1, "commit": STAGED, "images": {"origin": True}}))
        self.archive = self.release / f"iot-os-source-{STAGED[:7]}.tar.gz"
        make_archive(self.archive, STAGED, tree(STAGED))
        self.deployments = []
        self.running = []
        self.deploy = MagicMock()
        # What the API reports: every probe gets the same counts unless a test changes them.
        self.counts = None
        self.after = {}
        self.runtime = ["operational"]

    def args(self, **overrides):
        return SimpleNamespace(**{"env": str(self.env), "backup_env": "backup.env", "source": str(self.source), "release_dir": str(self.release),
                                  "expect_current": RUNNING[:7], "source_commit": None, "preflight": False, **overrides})

    def load_tooling(self, source):
        # Each tree's manage.py holds its commit, so a deployment knows which release's tooling it came from.
        host, commit = self, (Path(source) / "tooling/release/manage.py").read_text()

        class Deployment:
            def __init__(self, env, manifest):
                self.tooling, self.source, self.manifest = commit, Path(source), Path(manifest)
                self.config, self.env = host.config, read_env(env)
                self.images = json.loads(self.manifest.read_text())
                self.validate, self.restic = MagicMock(), MagicMock()
                host.deployments.append(self)

            def running(self):
                return host.running

            def deploy(self, backup_env):
                host.deploy(self, backup_env)

        return SimpleNamespace(Deployment=Deployment)

    def probe(self, deployment, request):
        counts = [self.counts if self.counts is not None else 3 for _ in request.get("counts", [])]
        result = {key: [True] * len(request.get(key, [])) for key in ("routes", "named_routes", "tables", "columns", "config")}
        result.update(counts=counts, runtime=self.runtime.pop(0) if len(self.runtime) > 1 else self.runtime[0])
        if deployment.tooling == STAGED:
            for key, value in self.after.items():
                result[key] = value(request) if callable(value) else value
        return result

    def ship(self, **overrides):
        output = io.StringIO()
        with patch.object(ship, "load_tooling", side_effect=self.load_tooling), patch.object(ship, "probe", side_effect=self.probe), \
                patch.object(ship.time, "sleep"), contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            try:
                ship.ship(self.args(**overrides))
            finally:
                self.output = output.getvalue()

    def installed(self):
        return (self.source / "tooling/release/manage.py").read_text()

    def siblings(self, prefix):
        return sorted(path for path in self.source.parent.iterdir() if path.name.startswith(prefix))


class ShipTests(unittest.TestCase):
    def host(self, **kwargs):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        return Host(temp.name, **kwargs)

    def test_ship_installs_the_source_and_deploys_with_its_own_tooling(self):
        host = self.host()
        host.ship()
        self.assertEqual(STAGED, host.installed())
        [previous] = host.siblings("source-before-")
        self.assertEqual(RUNNING, (previous / "tooling/release/manage.py").read_text())
        self.assertTrue(previous.name.endswith("-" + RUNNING[:7]))
        self.assertEqual([], host.siblings("source-candidate-"))
        # Validated with the staged tooling, counted with the running one, deployed with the installed one.
        staged, running, deployed = host.deployments
        self.assertEqual((STAGED, RUNNING, STAGED), (staged.tooling, running.tooling, deployed.tooling))
        staged.validate.assert_called_once_with()
        self.assertEqual(host.source, deployed.source)
        self.assertEqual(host.release / "release.json", deployed.manifest)
        host.deploy.assert_called_once_with(deployed, "backup.env")
        self.assertIn("Shipped " + STAGED[:12], host.output)

    def test_ship_never_reuses_a_previous_source_directory(self):
        # A hand-picked source-before name that already existed once made the rename fail.
        host = self.host()
        with patch.object(ship.time, "strftime", return_value="20261017T080000Z"):
            taken = host.source.parent / f"source-before-20261017T080000Z-{RUNNING[:7]}"
            (taken / "kept").mkdir(parents=True)
            host.ship()
        self.assertTrue((taken / "kept").is_dir())
        self.assertEqual(RUNNING, (taken.parent / (taken.name + "-2") / "tooling/release/manage.py").read_text())
        self.assertEqual(STAGED, host.installed())

    def test_ship_records_provenance_and_backs_up_the_source(self):
        host = self.host()
        before = (host.config / "current-release.json").read_text()
        host.ship()
        provenance = json.loads((host.config / "tooling-provenance.json").read_text())
        self.assertEqual(STAGED, provenance["source_commit"])
        self.assertEqual(STAGED, provenance["application_commit"])
        self.assertEqual(RUNNING, provenance["previous_application_commit"])
        self.assertEqual(hashlib.sha256(host.archive.read_bytes()).hexdigest(), provenance["source_archive_sha256"])
        self.assertEqual(str(host.siblings("source-before-")[0]), provenance["previous_source"])
        self.assertEqual((host.release / "release.json").read_text(), (host.config / "release.json").read_text())
        self.assertEqual((host.release / "release-origin.json").read_text(), (host.config / "release-origin.json").read_text())
        self.assertEqual(0o600, (host.config / "tooling-provenance.json").stat().st_mode & 0o777)
        [kept] = list(host.release.glob("before-*"))
        self.assertEqual(before, (kept / "current-release.json").read_text())
        self.assertIn("COMPOSE_PROJECT_NAME=iot-test", (kept / "application.env").read_text())
        restic = host.deployments[-1].restic
        restic.assert_called_once()
        arguments = restic.call_args.args
        self.assertEqual(("backup.env", "backup", host.archive, Path(str(host.archive) + ".sha256")), arguments[:4])
        self.assertIn(host.config / "tooling-provenance.json", arguments)
        self.assertEqual(["iot-release-source", "source-" + STAGED[:12]], [arguments[i + 1] for i, value in enumerate(arguments) if value == "--tag"])
        # Checkpoint retention forgets snapshots by project tag; it must never reach these.
        self.assertNotIn("iot-test", arguments)

    def test_refusals_change_nothing(self):
        cases = {
            "an incomplete deployment": (lambda host: (host.config / "DEPLOYMENT_INCOMPLETE").write_text(""), {}, "DEPLOYMENT_INCOMPLETE"),
            "an unfinished broker migration": (lambda host: (host.config / "BROKER_MIGRATION_INCOMPLETE").write_text(""), {}, "BROKER_MIGRATION_INCOMPLETE"),
            "a quarantined restore": (lambda host: (host.config / "RESTORE_QUARANTINE").write_text(""), {}, "RESTORE_QUARANTINE"),
            "another running release": (lambda host: None, {"expect_current": "c" * 7}, "running release is " + RUNNING[:12]),
            "a too short commit": (lambda host: None, {"expect_current": RUNNING[:6]}, "running release"),
            "running simulators": (lambda host: host.running.extend(["api", "gps-simulator"]), {}, "gps-simulator"),
            "no super administrator": (lambda host: setattr(host, "counts", 0), {}, "no super administrator"),
            "a table the running release lacks": (self.without_dashboards, {}, "cannot count dashboards"),
            "an invalid configuration": (lambda host: setattr(host, "load_tooling", self.failing_validation(host)), {}, "Invalid domain"),
        }
        for case, (arrange, overrides, message) in cases.items():
            with self.subTest(case):
                host = self.host()
                (host.release / "checks.json").write_text(json.dumps({"format": 1, "unchanged": ["dashboards"]}))
                arrange(host)
                with self.assertRaisesRegex(ValueError, message):
                    host.ship(**overrides)
                self.assertEqual(RUNNING, host.installed())
                self.assertEqual([], host.siblings("source-before-") + host.siblings("source-candidate-"))
                host.deploy.assert_not_called()
                self.assertFalse((host.config / "tooling-provenance.json").exists())

    @staticmethod
    def without_dashboards(host):
        host.probe = lambda deployment, request: {"counts": [None if count["table"] == "dashboards" else 3 for count in request["counts"]], "runtime": "operational"}

    def failing_validation(self, host):
        load = host.load_tooling

        def loader(source):
            tooling = load(source)
            original = tooling.Deployment

            class Deployment(original):
                def __init__(self, env, manifest):
                    super().__init__(env, manifest)
                    self.validate.side_effect = ValueError("Invalid domain")
            return SimpleNamespace(Deployment=Deployment)
        return loader

    def test_demo_simulators_switched_on_are_refused(self):
        host = self.host(environment="IOT_STAGING_DEMO_ENABLED=true\n")
        with self.assertRaisesRegex(ValueError, "demo simulators"):
            host.ship()
        self.assertEqual(RUNNING, host.installed())

    def test_preflight_runs_the_checks_and_changes_nothing(self):
        host = self.host()
        host.ship(preflight=True)
        self.assertEqual(RUNNING, host.installed())
        self.assertEqual([], host.siblings("source-"))
        self.assertEqual([], list(host.release.glob("before-*")))
        host.deploy.assert_not_called()
        self.assertIn("organizations 3", host.output)
        self.assertIn("users where is_super_admin = true 3", host.output)
        self.assertIn("Nothing was changed", host.output)

    def test_a_deploy_that_stops_before_its_marker_puts_the_previous_source_back(self):
        host = self.host()
        host.deploy.side_effect = RuntimeError("restic failed (exit 1)")
        with self.assertRaisesRegex(RuntimeError, "restic failed"):
            host.ship()
        self.assertEqual(RUNNING, host.installed())
        [failed] = host.siblings("source-failed-")
        self.assertEqual(STAGED, (failed / "tooling/release/manage.py").read_text())
        self.assertEqual([], host.siblings("source-before-"))
        self.assertFalse((host.config / "tooling-provenance.json").exists())
        # The retry is not blocked by anything the failed attempt left behind.
        host.deploy.side_effect = None
        host.ship()
        self.assertEqual(STAGED, host.installed())

    def test_a_deploy_that_stops_after_quiescing_keeps_the_new_source_for_recovery(self):
        host = self.host()

        def interrupted(deployment, backup_env):
            (host.config / "DEPLOYMENT_INCOMPLETE").write_text("{}")
            raise RuntimeError("Service readiness timed out")
        host.deploy.side_effect = interrupted
        with self.assertRaisesRegex(RuntimeError, "readiness"):
            host.ship()
        self.assertEqual(STAGED, host.installed())
        self.assertEqual(1, len(host.siblings("source-before-")))
        self.assertIn("recovery runbook", host.output)

    def test_failed_checks_are_reported_after_recording_the_release(self):
        host = self.host()
        host.after = {"routes": [False], "counts": lambda request: [2 if count == ship.SUPER_ADMINISTRATORS else 3 for count in request["counts"]]}
        with self.assertRaises(RuntimeError) as raised:
            host.ship()
        message = str(raised.exception)
        self.assertIn("is installed, but its checks failed", message)
        self.assertIn("Route PUT api/v1/admin/platform-team/{user} is missing", message)
        self.assertIn("users where is_super_admin = true: 3 before deploying, 2 after", message)
        self.assertNotIn("Table", message)
        self.assertTrue((host.config / "tooling-provenance.json").is_file())
        host.deployments[-1].restic.assert_called_once()

    def test_tables_that_may_change_are_not_compared(self):
        host = self.host()
        (host.release / "checks.json").write_text(json.dumps({"format": 1, "may_change": ["devices"]}))
        host.after = {"counts": lambda request: [9 if count["table"] == "devices" else 3 for count in request["counts"]]}
        host.ship()
        self.assertIn("Shipped", host.output)

    def test_an_operational_runtime_must_recover_after_deploying(self):
        host = self.host()
        host.runtime = ["operational", "degraded", "degraded", "operational"]
        host.ship()
        self.assertIn("runtime operational", host.output)
        host = self.host()
        host.runtime = ["operational", "degraded"]
        with self.assertRaisesRegex(RuntimeError, "The runtime is degraded; it was operational before deploying"):
            host.ship()
        # A runtime that was already degraded does not block the release.
        host = self.host()
        host.runtime = ["degraded"]
        host.ship()
        self.assertIn("runtime degraded", host.output)

    def test_the_archive_must_match_its_checksum_and_commit(self):
        host = self.host()
        Path(str(host.archive) + ".sha256").write_text("0" * 64 + "\n")
        with self.assertRaisesRegex(ValueError, "checksum mismatch"):
            host.ship()
        for commit, message in (("c" * 40, "not a git archive of commit " + STAGED), (None, "not a git archive")):
            with self.subTest(commit=commit):
                make_archive(host.archive, commit, tree(STAGED))
                with self.assertRaisesRegex(ValueError, message):
                    host.ship()
        make_archive(host.archive, STAGED, {"README.md": "not a release\n"})
        with self.assertRaisesRegex(ValueError, "does not contain the release tooling"):
            host.ship()
        self.assertEqual(RUNNING, host.installed())
        self.assertEqual([], host.siblings("source-"))

    def test_source_from_another_commit_needs_its_own_archive(self):
        host = self.host()
        tooling = "d" * 40
        make_archive(host.release / f"iot-os-source-{tooling[:7]}.tar.gz", tooling, tree(tooling))
        host.ship(source_commit=tooling)
        self.assertEqual(tooling, host.installed())
        provenance = json.loads((host.config / "tooling-provenance.json").read_text())
        self.assertEqual((tooling, STAGED), (provenance["source_commit"], provenance["application_commit"]))

    def test_a_release_without_checks_is_refused(self):
        host = self.host()
        make_archive(host.archive, STAGED, tree(STAGED, checks=None))
        with self.assertRaisesRegex(ValueError, "has no deploy/release/checks.json"):
            host.ship()
        self.assertEqual(RUNNING, host.installed())

    def test_the_release_directory_must_be_outside_the_source(self):
        host = self.host()
        with self.assertRaisesRegex(ValueError, "outside the source"):
            host.ship(release_dir=str(host.source / "staged"))


class CheckFileTests(unittest.TestCase):
    def write(self, directory, name, data):
        path = Path(directory) / name
        path.write_text(json.dumps(data))
        return path

    def test_checks_files_merge_and_name_the_domain(self):
        with tempfile.TemporaryDirectory() as temp:
            shipped = self.write(temp, "shipped.json", {
                "format": 1, "routes": ["PUT /api/v1/admin/platform-team/{user}"], "named_routes": ["api.v1.admin.assistant-settings.show"],
                "tables": ["assistant_settings"], "columns": {"organization_invitations": ["grants_super_admin"]},
                "config": {"app.frontend_url": "https://app.{domain}", "agents.enabled": True},
                "unchanged": ["dashboards", {"table": "users", "where": {"is_super_admin": True}}], "may_change": ["devices"]})
            private = self.write(temp, "private.json", {"format": 1, "tables": ["assistant_settings", "assistant_provider_keys"], "config": {"agents.enabled": False}})
            checks = ship.load_checks([shipped, private, Path(temp) / "absent.json"], "example.test")
        self.assertEqual([["PUT", "api/v1/admin/platform-team/{user}"]], checks["routes"])
        self.assertEqual(["assistant_settings", "assistant_provider_keys"], checks["tables"])
        self.assertEqual([["organization_invitations", "grants_super_admin"]], checks["columns"])
        self.assertEqual([["app.frontend_url", "https://app.example.test"], ["agents.enabled", True], ["agents.enabled", False]], checks["config"])
        self.assertEqual([{"table": "dashboards", "where": {}}, ship.SUPER_ADMINISTRATORS], checks["unchanged"])
        self.assertEqual(["devices"], checks["may_change"])

    def test_checks_files_refuse_anything_unexpected(self):
        cases = {
            "format": {"format": 2},
            "unknown sections": {"format": 1, "envirnoment": {}},
            "METHOD uri": {"format": 1, "routes": ["api/v1/admin/platform-team/{user}"]},
            "plain names": {"format": 1, "tables": ["users; drop table users"]},
            "map plain names": {"format": 1, "columns": ["grants_super_admin"]},
            "unchanged lists": {"format": 1, "unchanged": [{"table": "users", "count": 1}]},
            "where compares": {"format": 1, "unchanged": [{"table": "users", "where": {"is_super_admin": [True]}}]},
        }
        with tempfile.TemporaryDirectory() as temp:
            for message, data in cases.items():
                with self.subTest(message):
                    with self.assertRaisesRegex(ValueError, message):
                        ship.load_checks([self.write(temp, "checks.json", data)], "example.test")
            (Path(temp) / "broken.json").write_text("{")
            with self.assertRaisesRegex(ValueError, "not valid JSON"):
                ship.load_checks([Path(temp) / "broken.json"], "example.test")

    def test_the_shipped_checks_file_is_valid(self):
        checks = ship.load_checks([ROOT / ship.CHECKS], "example.test")
        self.assertIn(["app.frontend_url", "https://app.example.test"], checks["config"])
        self.assertTrue(checks["routes"])


class ProbeTests(unittest.TestCase):
    def test_probe_sends_its_request_as_data_and_reads_the_marked_line(self):
        request = {"config": [["app.name", "$app {$x} '\\"]], "counts": [ship.SUPER_ADMINISTRATORS]}
        result = {"routes": [], "named_routes": [], "tables": [], "columns": [], "config": [True], "counts": [1], "runtime": None}
        deployment = MagicMock()
        deployment.compose.return_value = SimpleNamespace(stdout="Deprecated: noise\n\n" + ship.PROBE_PREFIX + json.dumps(result) + "\n")
        self.assertEqual(result, ship.probe(deployment, request))
        self.assertEqual(("exec", "-T", "api", "php"), deployment.compose.call_args.args)
        script = deployment.compose.call_args.kwargs["input"]
        self.assertNotIn("$app {$x}", script)
        encoded = script.split("base64_decode('")[1].split("')")[0]
        sent = json.loads(base64.b64decode(encoded))
        self.assertEqual(request["config"], sent["config"])
        self.assertEqual([], sent["routes"])
        self.assertFalse(sent["runtime"])
        deployment.compose.return_value = SimpleNamespace(stdout="PHP Fatal error\n")
        with self.assertRaisesRegex(RuntimeError, "no release check result"):
            ship.probe(deployment, request)


class ToolingTests(unittest.TestCase):
    def test_load_tooling_uses_the_tree_it_is_given_for_lazy_imports_too(self):
        path, modules, tooling = list(sys.path), dict(sys.modules), list(ship._tooling)

        def restore():
            sys.path[:] = path
            ship._tooling[:] = tooling
            for name in set(sys.modules) - set(modules):
                del sys.modules[name]
            sys.modules.update(modules)
        self.addCleanup(restore)
        with tempfile.TemporaryDirectory() as temp:
            # manage.py finds its Compose files from its resolved location.
            temp = str(Path(temp).resolve())
            trees = []
            for name in ("candidate", "source"):
                directory = Path(temp) / name / "tooling/release"
                directory.mkdir(parents=True)
                shutil.copy2(ROOT / "tooling/release/manage.py", directory / "manage.py")
                (directory / "monitoring.py").write_text(f"TREE = {name!r}\n")
                trees.append(directory.parents[1])
            for root in trees:
                manage = ship.load_tooling(root)
                self.assertEqual(root / "deploy/release", manage.RELEASE)
                import monitoring
                self.assertEqual(root.name, monitoring.TREE)
            self.assertEqual(1, sum(entry.startswith(temp) for entry in sys.path))


if __name__ == "__main__":
    unittest.main()
