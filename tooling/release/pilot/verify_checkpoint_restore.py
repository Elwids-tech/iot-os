import sys
import json
import subprocess
import time
import shutil
from pathlib import Path

sys.path.insert(0, "/srv/elwids/source/tooling/release")
from manage import Deployment, read_env, private_write

d = Deployment(
    "/srv/elwids/private/application.env", "/srv/elwids/private/current-release.json"
)
be = "/srv/elwids/private/backup.env"
snaps = json.loads(
    d.restic(
        be, "snapshots", "--tag", "iot-checkpoint-v1", "--json", capture_output=True
    ).stdout
)
assert snaps
snapshot = max(snaps, key=lambda s: s["time"])
root = Path("/srv/elwids/private/restore-test")
assert not root.exists()
root.mkdir(mode=0o700)
base = snapshot["paths"][0]
for name in ["database.dump", "environment", "release.json"]:
    with (root / name).open("wb") as f:
        d.restic(be, "dump", snapshot["id"], base + "/" + name, stdout=f)
images = json.loads((root / "release.json").read_text())["images"]
image = json.loads(
    subprocess.check_output(
        ["docker", "image", "inspect", "timescale/timescaledb:2.29.2-pg17"]
    )
)[0]["RepoDigests"][0]
network = "elwids-restore-test"
container = "elwids-restore-database"
subprocess.run(
    ["docker", "network", "create", "--internal", network],
    check=True,
    stdout=subprocess.DEVNULL,
)
try:
    subprocess.run(
        [
            "docker",
            "run",
            "-d",
            "--name",
            container,
            "--network",
            network,
            "--memory",
            "1g",
            "-e",
            "POSTGRES_HOST_AUTH_METHOD=trust",
            image,
        ],
        check=True,
        stdout=subprocess.DEVNULL,
    )
    for attempt in range(60):
        r = subprocess.run(
            ["docker", "exec", container, "pg_isready", "-U", "postgres"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        if r.returncode == 0:
            break
        time.sleep(1)
    else:
        raise RuntimeError("Restore test database did not become ready")

    def sql(q):
        return subprocess.check_output(
            [
                "docker",
                "exec",
                container,
                "psql",
                "-U",
                "postgres",
                "-d",
                "iot",
                "-v",
                "ON_ERROR_STOP=1",
                "-Atc",
                q,
            ],
            text=True,
        )

    subprocess.run(
        [
            "docker",
            "exec",
            container,
            "psql",
            "-U",
            "postgres",
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            "CREATE ROLE iot_api; CREATE ROLE iot_runtime;",
        ],
        check=True,
        stdout=subprocess.DEVNULL,
    )
    subprocess.run(
        ["docker", "exec", container, "createdb", "-U", "postgres", "iot"], check=True
    )
    sql("CREATE EXTENSION IF NOT EXISTS timescaledb; SELECT timescaledb_pre_restore();")
    with (root / "database.dump").open("rb") as stream:
        subprocess.run(
            [
                "docker",
                "exec",
                "-i",
                container,
                "pg_restore",
                "--exit-on-error",
                "--no-owner",
                "-U",
                "postgres",
                "-d",
                "iot",
            ],
            stdin=stream,
            check=True,
            stdout=subprocess.DEVNULL,
        )
    sql("SELECT timescaledb_post_restore();")
    env = read_env(root / "environment")
    env.update(
        DB_CONNECTION="pgsql",
        APP_ENV="staging",
        DB_HOST=container,
        DB_PORT="5432",
        DB_DATABASE="iot",
        DB_USERNAME="postgres",
        DATABASE_HOST="timescaledb",
        IOT_RECOVERY_MODE="true",
        LOG_CHANNEL="stderr",
    )
    private_write(
        root / "recovery.env",
        "\n".join(k + '="' + v + '"' for k, v in env.items()) + "\n",
    )
    subprocess.run(
        [
            "docker",
            "run",
            "--rm",
            "--network",
            network,
            "--memory",
            "384m",
            "--env-file",
            str(root / "recovery.env"),
            images["API_IMAGE"],
            "php",
            "artisan",
            "deployment:quarantine-restore",
        ],
        check=True,
        stdout=subprocess.DEVNULL,
    )
    tables = int(
        sql(
            "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"
        )
    )
    migrations = int(sql("SELECT count(*) FROM migrations"))
    assert tables > 20 and migrations > 0
    report = {
        "snapshot": snapshot["id"],
        "restored_public_tables": tables,
        "migrations": migrations,
        "side_effects_quarantined": True,
        "external_network_access": False,
        "verified_at": int(time.time()),
    }
    private_write(
        Path("/srv/elwids/private/restore-test-result.json"),
        json.dumps(report, indent=2) + "\n",
    )
    private_write(
        d.state / "metrics/restore.prom",
        "iot_restore_verified_timestamp_seconds " + str(int(time.time())) + "\n",
        0o644,
    )
    print(
        "Off-site PostgreSQL checkpoint restored and quarantined;",
        tables,
        "public tables verified.",
    )
finally:
    subprocess.run(
        ["docker", "rm", "-f", container],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    subprocess.run(
        ["docker", "network", "rm", network],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    shutil.rmtree(root)
