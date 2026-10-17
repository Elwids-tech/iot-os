#!/usr/bin/env python3
"""Ship a staged release onto a running single-node deployment in one locked operation.

The release directory holds what the operator staged for one release:

    release.json                          image manifest naming the commit it was built from
    release-origin.json                   optional: the manifest before its images were imported
    iot-os-source-<short>.tar.gz          `git archive` of the source commit
    iot-os-source-<short>.tar.gz.sha256   its checksum
    checks.json                           optional: checks for this deployment only

Holding the operation lock, it refuses open operation markers, an unexpected
running release and demo simulators, counts key tables in the running release,
moves the installed source aside to a new `source-before-...` directory, installs
the archive in its place and deploys with that release's own manage.py. It then
records provenance, checks the release against its `deploy/release/checks.json`
(docs/ops/release.md#release-checks) and backs the source up with Restic.
"""
import argparse
import base64
import hashlib
import importlib
import importlib.util
import itertools
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import time

from manage import Deployment, private_write

CHECKS = "deploy/release/checks.json"
LOCK_WAIT = 1800
MARKERS = ("DEPLOYMENT_INCOMPLETE", "BROKER_MIGRATION_INCOMPLETE", "RESTORE_QUARANTINE")
SIMULATORS = ("simulator", "gps-simulator")
# Copied aside before anything changes, next to the staged release.
PRIVATE_FILES = ("current-release.json", "previous-release.json", "release.json", "release-origin.json", "tooling-provenance.json")
# Never the Compose project name: checkpoint retention (`restic forget --tag <project>`) must not prune source backups.
SOURCE_TAG = "iot-release-source"
# Rows a deploy must neither add nor remove, counted before deploying and compared after.
SUPER_ADMINISTRATORS = {"table": "users", "where": {"is_super_admin": True}}
KEY_COUNTS = (
    {"table": "organizations", "where": {}},
    {"table": "users", "where": {}},
    SUPER_ADMINISTRATORS,
    {"table": "organization_user", "where": {}},
    {"table": "organization_invitations", "where": {}},
    {"table": "platform_role_user", "where": {}},
    {"table": "sites", "where": {}},
    {"table": "devices", "where": {}},
)
RUNTIME_ATTEMPTS = 12
RUNTIME_DELAY = 5

COMMIT = re.compile(r"[0-9a-f]{40}")
IDENTIFIER = re.compile(r"[a-z_][a-z0-9_]*")
NAME = re.compile(r"[A-Za-z0-9_.:-]+")
ROUTE = re.compile(r"(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS) /?([^\s/]\S*)")
SECTIONS = ("routes", "named_routes", "tables", "columns", "config", "unchanged", "may_change")

PROBE_PREFIX = "IOT-RELEASE-PROBE "
# Runs in the API container and only reads. Python decides what passes.
PROBE = r"""<?php
require 'vendor/autoload.php';
$app = require 'bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$request = json_decode(base64_decode('REQUEST'), true);
$router = app('router')->getRoutes();
$routes = collect($router->getRoutes());
$result = [
    'routes' => array_map(fn ($route) => $routes->contains(fn ($candidate) => $candidate->uri() === $route[1] && in_array($route[0], $candidate->methods(), true)), $request['routes']),
    'named_routes' => array_map(fn ($name) => $router->hasNamedRoute($name), $request['named_routes']),
    'tables' => array_map(fn ($table) => Illuminate\Support\Facades\Schema::hasTable($table), $request['tables']),
    'columns' => array_map(fn ($column) => Illuminate\Support\Facades\Schema::hasColumn($column[0], $column[1]), $request['columns']),
    // Only whether each value matches leaves the container, so no setting is ever printed.
    'config' => array_map(fn ($setting) => config($setting[0]) === $setting[1], $request['config']),
    'counts' => array_map(function ($count) {
        try {
            $query = Illuminate\Support\Facades\DB::table($count['table']);
            if ($count['where']) {
                $query->where($count['where']);
            }
            return $query->count();
        } catch (Throwable) {
            return null;
        }
    }, $request['counts']),
    'runtime' => null,
];
if ($request['runtime']) {
    try {
        Illuminate\Support\Facades\Cache::forget('devices.runtime-status');
        $result['runtime'] = app(App\Domain\Devices\Services\RuntimeStatus::class)->current()['state'];
    } catch (Throwable) {
        $result['runtime'] = 'unknown';
    }
}
echo PHP_EOL.'IOT-RELEASE-PROBE '.json_encode($result).PHP_EOL;
"""


def unique_path(parent, name):
    """A path in parent that nothing occupies yet. Renaming onto an existing directory fails or replaces it."""
    path = parent / name
    for number in itertools.count(2):
        if not os.path.lexists(path):
            return path
        path = parent / f"{name}-{number}"


def label(count):
    conditions = " and ".join(f"{column} = {json.dumps(value)}" for column, value in count["where"].items())
    return count["table"] + (" where " + conditions if conditions else "")


def names(path, section, values, pattern=IDENTIFIER):
    if not isinstance(values, list) or not all(isinstance(value, str) and pattern.fullmatch(value) for value in values):
        raise ValueError(f"{path}: {section} must be a list of plain names")
    return values


def mapping(path, section, values, pattern=IDENTIFIER):
    if not isinstance(values, dict) or not all(pattern.fullmatch(key) for key in values):
        raise ValueError(f"{path}: {section} must map plain names to values")
    return values


def parse_count(path, entry):
    count = {"table": entry, "where": {}} if isinstance(entry, str) else entry
    if not isinstance(count, dict) or set(count) - {"table", "where"} or not IDENTIFIER.fullmatch(str(count.get("table"))):
        raise ValueError(f'{path}: unchanged lists table names or {{"table": ..., "where": {{...}}}}')
    where = mapping(path, "where", count.get("where", {}))
    if not all(value is None or isinstance(value, (str, int, bool)) for value in where.values()):
        raise ValueError(f"{path}: where compares columns with strings, numbers, booleans or null")
    return {"table": count["table"], "where": where}


def load_checks(paths, domain):
    """Merge checks files. The first ships with the release and must exist; the others are optional."""
    checks = {section: [] for section in SECTIONS}

    def add(section, value):
        if value not in checks[section]:
            checks[section].append(value)

    for index, path in enumerate(paths):
        if not path.is_file():
            if index == 0:
                raise ValueError(f"The staged release has no {CHECKS}; ship needs one")
            continue
        try:
            data = json.loads(path.read_text())
        except json.JSONDecodeError:
            raise ValueError(f"{path} is not valid JSON") from None
        if not isinstance(data, dict) or data.get("format") != 1:
            raise ValueError(f'{path} must be a JSON object with "format": 1')
        unknown = sorted(set(data) - {"format", *SECTIONS})
        if unknown:
            raise ValueError(f"{path} has unknown sections: {', '.join(unknown)}")
        for route in data.get("routes", []):
            match = ROUTE.fullmatch(route) if isinstance(route, str) else None
            if not match:
                raise ValueError(f'{path}: routes are written "METHOD uri", not {route!r}')
            add("routes", [match[1], match[2]])
        for name in names(path, "named_routes", data.get("named_routes", []), NAME):
            add("named_routes", name)
        for section in ("tables", "may_change"):
            for table in names(path, section, data.get(section, [])):
                add(section, table)
        for table, columns in mapping(path, "columns", data.get("columns", {})).items():
            for column in names(path, "columns", columns):
                add("columns", [table, column])
        for key, value in mapping(path, "config", data.get("config", {}), NAME).items():
            add("config", [key, value.replace("{domain}", domain) if isinstance(value, str) else value])
        for entry in data.get("unchanged", []):
            add("unchanged", parse_count(path, entry))
    return checks


def verify_archive(archive, commit):
    """The archive matches its checksum and is a `git archive` of exactly this commit."""
    checksum = Path(str(archive) + ".sha256")
    if not archive.is_file() or not checksum.is_file():
        raise ValueError(f"Stage {archive.name} and {checksum.name} in the release directory")
    with archive.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    if digest != (checksum.read_text().split() or [""])[0]:
        raise ValueError("Source archive checksum mismatch")
    with tarfile.open(archive) as tar:
        # git archive records the commit it was made from in a pax header.
        embedded = tar.pax_headers.get("comment")
        names = set(tar.getnames())
    if embedded != commit:
        raise ValueError(f"{archive.name} is not a git archive of commit {commit}")
    if not {"tooling/release/manage.py", "deploy/release/compose.yml"} <= names:
        raise ValueError(f"{archive.name} does not contain the release tooling")
    return digest


_tooling = []
_loads = itertools.count()


def load_tooling(source):
    """Import manage.py from one source tree, so that release's own code and Compose files act.

    manage.py imports its sibling modules lazily, so that directory goes first on
    sys.path and any cached copies of those modules are forgotten: the same path can
    hold another release once the source is swapped.
    """
    directory = str(Path(source).absolute() / "tooling/release")
    for name in {path.stem for path in Path(directory).glob("*.py")} & set(sys.modules) - {"__main__"}:
        del sys.modules[name]
    sys.path[:] = [entry for entry in sys.path if entry not in _tooling]
    _tooling[:] = [directory]
    sys.path.insert(0, directory)
    importlib.invalidate_caches()
    spec = importlib.util.spec_from_file_location(f"release_tooling_{next(_loads)}", os.path.join(directory, "manage.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def probe(deployment, request):
    """Ask the running API about routes, schema, settings, row counts and the runtime. Reads only."""
    request = {"routes": [], "named_routes": [], "tables": [], "columns": [], "config": [], "counts": [], "runtime": False, **request}
    # Base64 keeps names and values out of PHP syntax.
    script = PROBE.replace("REQUEST", base64.b64encode(json.dumps(request).encode()).decode())
    output = deployment.compose("exec", "-T", "api", "php", input=script, text=True, stdout=subprocess.PIPE).stdout
    for line in reversed(output.splitlines()):
        if line.startswith(PROBE_PREFIX):
            return json.loads(line[len(PROBE_PREFIX):])
    raise RuntimeError("The API returned no release check result")


def preflight(deployment, expected):
    """Refusals that need nothing changed. Returns the running commit."""
    for marker in MARKERS:
        if (deployment.config / marker).exists():
            raise ValueError(f"{marker} exists: an earlier operation needs review before shipping")
    running = deployment.images.get("commit", "")
    expected = expected.lower()
    if len(expected) < 7 or not running.startswith(expected):
        raise ValueError(f"The running release is {running[:12] or 'unknown'}, not {expected}")
    if deployment.env.get("IOT_STAGING_DEMO_ENABLED") == "true":
        raise ValueError("IOT_STAGING_DEMO_ENABLED is true: deploying would start the demo simulators")
    simulators = [name for name in SIMULATORS if name in deployment.running()]
    if simulators:
        raise ValueError(f"Demo simulators are running ({', '.join(simulators)}); stop them before shipping")
    return running


def capture(deployment, checks):
    """Count key rows and read the runtime state in the running release."""
    counts = list(KEY_COUNTS)
    counts += [count for count in checks["unchanged"] if count not in counts]
    result = probe(deployment, {"counts": counts, "runtime": True})
    missing = [label(count) for count, value in zip(counts, result["counts"]) if value is None]
    if missing:
        raise ValueError("The running release cannot count " + ", ".join(missing) + "; list a table under unchanged only once it exists")
    if result["counts"][counts.index(SUPER_ADMINISTRATORS)] < 1:
        raise ValueError("The running release has no super administrator")
    return {"counts": counts, "values": result["counts"], "runtime": result["runtime"]}


def evaluate(checks, before, after):
    """Failures in a probe of the new release, compared with the counts taken before deploying."""
    failures = [f"Route {method} {uri} is missing" for (method, uri), found in zip(checks["routes"], after["routes"]) if not found]
    failures += [f"Route {name} is missing" for name, found in zip(checks["named_routes"], after["named_routes"]) if not found]
    failures += [f"Table {table} is missing" for table, found in zip(checks["tables"], after["tables"]) if not found]
    failures += [f"Column {table}.{column} is missing" for (table, column), found in zip(checks["columns"], after["columns"]) if not found]
    failures += [f"Setting {key} does not have the expected value" for (key, _), matches in zip(checks["config"], after["config"]) if not matches]
    for count, old, new in zip(before["counts"], before["values"], after["counts"]):
        if new != old and count["table"] not in checks["may_change"]:
            failures.append(f"{label(count)}: {old} before deploying, {'uncountable' if new is None else new} after")
    return failures


def verify(deployment, checks, before):
    """Check the deployed release. Returns failures and the runtime state."""
    after = probe(deployment, {key: checks[key] for key in ("routes", "named_routes", "tables", "columns", "config")} | {"counts": before["counts"], "runtime": True})
    failures = evaluate(checks, before, after)
    state = after["runtime"]
    if before["runtime"] == "operational":
        # The runtime may still be replaying after its restart.
        for _ in range(RUNTIME_ATTEMPTS - 1):
            if state == "operational":
                break
            time.sleep(RUNTIME_DELAY)
            state = probe(deployment, {"runtime": True})["runtime"]
        if state != "operational":
            failures.append(f"The runtime is {state}; it was operational before deploying")
    return failures, state


def keep_private_files(env_path, config, release_dir, stamp):
    directory = unique_path(release_dir, "before-" + stamp)
    directory.mkdir(mode=0o700)
    for path in (env_path, *(config / name for name in PRIVATE_FILES)):
        if path.is_file():
            shutil.copy2(path, directory / path.name)
    return directory


def ship(args):
    env_path = Path(args.env).absolute()
    release_dir = Path(args.release_dir).absolute()
    source = Path(args.source).absolute()
    if not (source / "tooling/release/manage.py").is_file():
        raise ValueError("--source must be the installed source directory")
    if release_dir == source or source in release_dir.parents:
        raise ValueError("Stage the release outside the source directory")
    manifest_path = release_dir / "release.json"
    if not manifest_path.is_file():
        raise ValueError("Stage release.json in the release directory")
    application_commit = json.loads(manifest_path.read_text()).get("commit", "")
    if not COMMIT.fullmatch(application_commit):
        raise ValueError("release.json must name the full commit its images were built from")
    source_commit = (args.source_commit or application_commit).lower()
    if not COMMIT.fullmatch(source_commit):
        raise ValueError("--source-commit must be a full commit hash")
    archive = release_dir / f"iot-os-source-{source_commit[:7]}.tar.gz"
    digest = verify_archive(archive, source_commit)

    operations = Deployment(env_path, None)
    config = operations.config
    current_manifest = config / "current-release.json"
    if not current_manifest.is_file():
        raise ValueError("No release is installed; install the first one with manage.py deploy")
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    candidate = unique_path(source.parent, f"source-candidate-{source_commit[:7]}")
    candidate.mkdir(mode=0o700)
    installed = False
    try:
        with tarfile.open(archive) as tar:
            tar.extractall(candidate, filter="data")
        checks = load_checks([candidate / CHECKS, release_dir / "checks.json"], operations.env.get("DOMAIN", ""))
        # The release's own tooling validates the configuration before anything changes.
        load_tooling(candidate).Deployment(env_path, manifest_path).validate()
        with operations.lock(LOCK_WAIT):
            # The installed tooling matches the running release's Compose files and images.
            running = load_tooling(source).Deployment(env_path, current_manifest)
            running_commit = preflight(running, args.expect_current)
            before = capture(running, checks)
            print("Running release " + running_commit[:12] + ": " + ", ".join(f"{label(count)} {value}" for count, value in zip(before["counts"], before["values"])) + f"; runtime {before['runtime']}.")
            if args.preflight:
                print(f"Preflight passed for {application_commit[:12]}. Nothing was changed.")
                return
            kept = keep_private_files(env_path, config, release_dir, stamp)
            previous = unique_path(source.parent, f"source-before-{stamp}-{running_commit[:7]}")
            source.rename(previous)
            try:
                candidate.rename(source)
            except OSError:
                previous.rename(source)
                raise
            installed = True
            print(f"Installed source {source_commit[:12]}; the previous source is at {previous}. Deploying.")
            deployment = load_tooling(source).Deployment(env_path, manifest_path)
            try:
                deployment.deploy(args.backup_env)
            except BaseException:
                if (config / "DEPLOYMENT_INCOMPLETE").exists():
                    print(f"The deploy stopped after quiescing the platform. Follow the recovery runbook; the previous source is at {previous}.", file=sys.stderr)
                else:
                    # Nothing past the pre-upgrade checkpoint ran, so the previous release is still running.
                    failed = unique_path(source.parent, f"source-failed-{stamp}-{source_commit[:7]}")
                    source.rename(failed)
                    previous.rename(source)
                    print(f"The deploy stopped before changing the running release. The previous source is back; this one is at {failed}.", file=sys.stderr)
                raise
            private_write(config / "release.json", manifest_path.read_text())
            origin = release_dir / "release-origin.json"
            if origin.is_file():
                private_write(config / "release-origin.json", origin.read_text())
            provenance = config / "tooling-provenance.json"
            private_write(provenance, json.dumps({
                "source_commit": source_commit, "tooling_commit": source_commit, "application_commit": application_commit,
                "source_archive_sha256": digest, "installed_at": time.time(),
                "previous_application_commit": running_commit, "previous_source": str(previous), "private_files_before": str(kept),
            }, indent=2) + "\n")
            failures, state = verify(deployment, checks, before)
            files = [archive, Path(str(archive) + ".sha256"), manifest_path, *([origin] if origin.is_file() else []), provenance]
            deployment.restic(args.backup_env, "backup", *files, "--tag", SOURCE_TAG, "--tag", "source-" + source_commit[:12], stdout=subprocess.DEVNULL)
            if failures:
                raise RuntimeError(f"Release {application_commit[:12]} is installed, but its checks failed:\n  " + "\n  ".join(failures))
            checked = sum(len(checks[key]) for key in ("routes", "named_routes", "tables", "columns", "config"))
            print(f"Shipped {application_commit[:12]}: {checked} release checks and {len(before['counts'])} row counts passed, runtime {state}.")
    finally:
        if not installed and candidate.exists():
            shutil.rmtree(candidate)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--env", required=True, help="private environment file")
    parser.add_argument("--backup-env", required=True, help="private Restic environment file")
    parser.add_argument("--source", required=True, help="installed source directory; it is moved aside, never deleted")
    parser.add_argument("--release-dir", required=True, help="directory holding the staged release")
    parser.add_argument("--expect-current", required=True, metavar="COMMIT", help="commit of the running release (at least 7 characters)")
    parser.add_argument("--source-commit", metavar="COMMIT", help="install source from another commit than the images, for tooling or documentation changes")
    parser.add_argument("--preflight", action="store_true", help="run every check that needs no downtime, then stop")
    args = parser.parse_args(argv)
    os.umask(0o077)
    # Progress stays in order with errors when the output is not a terminal.
    sys.stdout.reconfigure(line_buffering=True)
    ship(args)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, BlockingIOError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
