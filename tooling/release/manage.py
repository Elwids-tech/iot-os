#!/usr/bin/env python3
"""Single-node operations. Secrets are read from private files, never logged.

All commands use argument arrays (no shell sourcing/eval). Backup, deployment,
certificate reload and bootstrap share one host lock. Restore remains quarantined.
"""
import argparse
import contextlib
import fcntl
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
import urllib.parse

import yaml

ROOT = Path(__file__).resolve().parents[2]
RELEASE = ROOT / "deploy/release"
IMAGES = ("API_IMAGE", "API_WEB_IMAGE", "PORTAL_IMAGE", "ADMIN_IMAGE", "RUNTIME_IMAGE", "SIMULATOR_IMAGE")
WRITERS = ("api", "default-worker", "alerts-worker", "assistant-worker", "webhooks-worker", "automation-worker", "scheduler", "runtime")
SECRET_KEYS = ("API_DB_PASSWORD", "RUNTIME_DB_PASSWORD", "POSTGRES_PASSWORD", "DEVICE_RUNTIME_TOKEN", "DEVICE_EMQX_API_SECRET", "NATS_PASSWORD", "EMQX_COOKIE", "EMQX_DASHBOARD_PASSWORD", "GRAFANA_PASSWORD", "IOT_METRICS_TOKEN")


def read_env(path):
    values = {}
    for line in Path(path).read_text().splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, sep, value = line.partition("=")
        if not sep or not re.fullmatch(r"[A-Z][A-Z0-9_]*", key):
            raise ValueError("Invalid environment file entry")
        # Values are literal; quote with JSON syntax when whitespace is needed.
        values[key] = json.loads(value) if value.startswith('"') else value
    return values


def private_write(path, value, mode=0o600):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=path.parent)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, "w") as stream:
            stream.write(value)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def run(args, **kwargs):
    # Never echo commands: some tool errors can include credentials.
    if kwargs.pop("capture_output", False):
        kwargs["stdout"] = subprocess.PIPE
    result = subprocess.run([str(x) for x in args], stderr=subprocess.PIPE, **kwargs)
    if result.returncode:
        raise RuntimeError(f"{Path(str(args[0])).name} failed (exit {result.returncode}); inspect private service logs locally")
    return result


class Deployment:
    def __init__(self, env_path, manifest):
        self.env_path = Path(env_path).resolve()
        self.env = read_env(self.env_path)
        self.manifest = Path(manifest).resolve() if manifest else None
        if self.manifest:
            self.release_text = self.manifest.read_text()
            self.images = json.loads(self.release_text)
            self.env.update(self.images["images"])
        self.state = Path(self.env["STATE_DIR"])
        self.config = Path(self.env["CONFIG_DIR"])

    def compose(self, *args, **kwargs):
        # Clear accidental shell overrides; compose interpolation uses the exact private configuration.
        env = {**os.environ, **self.env}
        profiles = ["--profile", "demo", "--profile", "tools"] if args and args[0] in ("stop", "start", "restart", "ps", "down") else []
        overlays = ["-f", RELEASE / "compose.external-db.yml"] if self.external_database else []
        if self.broker == "mqtt":
            overlays += ["-f", RELEASE / "compose.mosquitto.yml"]
            inventory = yaml.safe_load((RELEASE / "compose.yml").read_text())["services"]
            names = [name for name, service in inventory.items() if not service.get("profiles") and name != "emqx" and (not self.external_database or name != "timescaledb")]
            env["BROKER_EXPECTED_SERVICES"] = ",".join([*names, "mqtt", "broker-admin"])
        return run(["docker", "compose", "--project-directory", RELEASE, "--env-file", self.env_path,
                    "-f", RELEASE / "compose.yml", *overlays, *profiles, *args], env=env, **kwargs)

    @property
    def broker(self):
        provider = self.env.get("DEVICE_BROKER_PROVIDER", "emqx")
        if provider not in ("emqx", "mosquitto"):
            raise ValueError("Unsupported broker provider")
        return "mqtt" if provider == "mosquitto" else "emqx"

    @property
    def broker_uid(self):
        return 1883 if self.broker == "mqtt" else 1000

    @property
    def external_database(self):
        return self.env.get("DATABASE_HOST", "timescaledb") != "timescaledb"

    def validate_database_host(self):
        if self.external_database:
            try:
                address = ipaddress.IPv4Address(self.env["DATABASE_HOST"])
            except ipaddress.AddressValueError:
                raise ValueError("DATABASE_HOST must be timescaledb or a private WireGuard IPv4 address") from None
            if not any(address in ipaddress.ip_network(cidr) for cidr in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")):
                raise ValueError("External database must use a private WireGuard IPv4 address")

    def database_command(self, *args, **kwargs):
        self.validate_database_host()
        if self.external_database:
            route = run(["ip", "-j", "route", "get", self.env["DATABASE_HOST"]], stdout=subprocess.PIPE, text=True)
            if not any(item.get("dev") == "wg-elwids" for item in json.loads(route.stdout)):
                raise ValueError("External database traffic must use the wg-elwids WireGuard interface")
            return self.compose("run", "--rm", "--no-deps", "-T", "db-client", *args, **kwargs)
        return self.compose("exec", "-T", "timescaledb", *args, **kwargs)

    def database_ready(self):
        if self.external_database:
            self.database_command("psql", "-v", "ON_ERROR_STOP=1", "-c", "SELECT 1", stdout=subprocess.DEVNULL)
        else:
            self.compose("up", "-d", "--wait", "timescaledb", stdout=subprocess.DEVNULL)

    @contextlib.contextmanager
    def lock(self):
        self.config.mkdir(parents=True, exist_ok=True, mode=0o700)
        with (self.config / "operation.lock").open("w") as stream:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            yield

    def validate(self):
        self.validate_database_host()
        if self.broker == "mqtt":
            for key in ("DEVICE_BROKER_ADMIN_TOKEN", "MOSQUITTO_ADMIN_PASSWORD"):
                if not re.fullmatch(r"[a-f0-9]{64}", self.env.get(key, "")):
                    raise ValueError(key+" must be a generated 256-bit secret")
        if self.env_path.stat().st_mode & 0o077:
            raise ValueError("Environment file must have mode 0600")
        if self.env.get("DEPLOY_ENVIRONMENT") not in ("staging", "production"):
            raise ValueError("Environment must be staging or production")
        if self.env["DEPLOY_ENVIRONMENT"] == "production" and self.env.get("IOT_STAGING_DEMO_ENABLED") != "false":
            raise ValueError("Production must disable demo data")
        if not re.fullmatch(r"[a-z0-9]+(?:[.-][a-z0-9]+)+", self.env["DOMAIN"]):
            raise ValueError("Invalid domain")
        if not re.fullmatch(r"[a-z][a-z0-9-]+", self.env["COMPOSE_PROJECT_NAME"]):
            raise ValueError("Invalid Compose project name")
        for path in (self.state, self.config):
            if not path.is_absolute() or str(path) in ("/", "/srv", "/var", "/home"):
                raise ValueError("State/config must be dedicated absolute directories")
        for key in (*SECRET_KEYS, "APP_KEY", "DEVICE_EMQX_API_KEY", "MAIL_USERNAME", "MAIL_PASSWORD", "MAIL_FROM_ADDRESS", "ACME_EMAIL", "ALERT_EMAIL"):
            if not self.env.get(key):
                raise ValueError(f"Missing private input: {key}")
        for key in SECRET_KEYS:
            if not re.fullmatch(r"[a-f0-9]{64}", self.env[key]):
                raise ValueError(f"{key} must be generated, URL-safe 256-bit secret")
        if self.env.get("IOT_ASSISTANT_ENABLED") == "true" and not self.env.get("OPENAI_API_KEY"):
            raise ValueError("Assistant enabled without provider credentials")
        self.nats_capacity()
        if bool(self.env.get("ALERT_SMTP_USERNAME")) != bool(self.env.get("ALERT_SMTP_PASSWORD")):
            raise ValueError("Separate alert SMTP username and password must both be set")
        if not self.manifest:
            raise ValueError("A release manifest is required")
        if set(self.images["images"]) != set(IMAGES):
            raise ValueError("Release manifest must contain exactly the six application images")
        for key in IMAGES:
            if not re.fullmatch(r"[a-z0-9./_-]+@sha256:[a-f0-9]{64}", self.env[key]):
                raise ValueError(f"{key} is not an immutable image digest")
        self.compose("config", "--quiet", stdout=subprocess.DEVNULL)

    def render(self):
        from monitoring import render as render_monitoring
        self.config.mkdir(parents=True, exist_ok=True, mode=0o700)
        render_monitoring(ROOT, self.config, self.env['DEPLOY_ENVIRONMENT'], self.env['DOMAIN'], private_write)
        capacity = self.nats_capacity()
        private_write(self.config / "nats.conf", 'jetstream { store_dir: "/data", max_file_store: '+str(capacity)+', max_memory_store: 64MB }\nhttp_port: 8222\nauthorization { users: [{user: "runtime", password: "'+self.env['NATS_PASSWORD']+'"}] }\n', 0o644)
        private_write(self.config / "emqx-api-keys", self.env["DEVICE_EMQX_API_KEY"]+":"+self.env["DEVICE_EMQX_API_SECRET"]+":administrator\n", 0o644)
        sql = (RELEASE / "init-db.sql").read_text()
        for key in ("API_DB_PASSWORD", "RUNTIME_DB_PASSWORD"):
            if not re.fullmatch(r"[a-f0-9]{64}", self.env[key]): raise ValueError("Unsafe generated database credential")
            sql = sql.replace("__"+key+"__", self.env[key])
        private_write(self.config / "init-db.sql", sql, 0o644)
        domain = self.env["DOMAIN"]
        scrape = [
            {"job_name": "api", "metrics_path": "/internal/ops/metrics", "authorization": {"credentials": self.env["IOT_METRICS_TOKEN"]}, "static_configs": [{"targets": ["api-web:80"]}]},
            {"job_name": "host", "static_configs": [{"targets": ["node-exporter:9100"]}]},
            {"job_name": "prometheus", "static_configs": [{"targets": ["localhost:9090"]}]},
        ]
        if self.external_database:
            self.validate_database_host()
            scrape[1]['static_configs'].append({'targets': [self.env['DATABASE_HOST']+':9100'], 'labels': {'role': 'database'}})
        for job, target in [('containers', 'container-metrics:9101'), ('alertmanager', 'alertmanager:9093'), ('loki', 'loki:3100'), ('alloy', 'alloy:12345'), ('blackbox', 'blackbox:9115')]:
            scrape.append({'job_name': job, 'static_configs': [{'targets': [target]}]})
        for name, module, targets in [("health", "http_ok", ["http://api-web/health/ready", "http://runtime:8081/health/ready", "https://app."+domain, "https://api."+domain+"/up"]), ("mqtt", "mqtt_tls", ["mqtt."+domain+":8883"])]:
            if name == "health" and self.broker == "mqtt":
                targets.append("http://broker-admin:8082/health/ready")
            scrape.append({"job_name": name, "metrics_path": "/probe", "params": {"module": [module]}, "static_configs": [{"targets": targets}], "relabel_configs": [{"source_labels": ["__address__"], "target_label": "__param_target"}, {"source_labels": ["__param_target"], "target_label": "instance"}, {"target_label": "__address__", "replacement": "blackbox:9115"}]})
        private_write(self.config / "prometheus.yml", yaml.safe_dump({"global": {"scrape_interval": "30s", "evaluation_interval": "30s"}, "rule_files": ["/etc/prometheus/alerts.yml"], "alerting": {"alertmanagers": [{"static_configs": [{"targets": ["alertmanager:9093"]}]}]}, "scrape_configs": scrape}), 0o644)
        from notification_monitoring import alertmanager_config
        private_write(self.config / "alertmanager.yml", yaml.safe_dump(alertmanager_config(self.env)), 0o644)

    def nats_capacity(self):
        defaults = {"STORE": 24<<30, "CONTROL": 64<<20, "EVENTS": 4<<30, "TELEMETRY": 12<<30, "COMMITTED": 4<<30}
        limits = {}
        for name, default in defaults.items():
            key = "IOT_NATS_"+name+"_MAX_BYTES"
            raw = str(self.env.get(key) or default)
            if not raw.isdecimal() or not 1<<20 <= int(raw) <= 1<<40:
                raise ValueError(key+" must be bytes between 1 MiB and 1 TiB")
            limits[name] = int(raw)
        if sum(v for k, v in limits.items() if k != "STORE") > limits["STORE"] * 0.9:
            raise ValueError("JetStream store requires at least 10% capacity outside configured streams")
        return limits["STORE"]

    def layout(self):
        owners = {"app": (33, 33), "emqx": (1000, 1000), "mosquitto": (1883, 1883), "prometheus": (65534, 65534), "alertmanager": (65534, 65534), "grafana": (472, 0), "loki": (10001, 10001)}
        for name in ("postgres", "app", "nats", "emqx", "mosquitto", "mqtt-certs", "caddy", "prometheus", "alertmanager", "grafana", "loki", "alloy", "metrics", "simulators", "simulator-config"):
            path = self.state / name
            path.mkdir(parents=True, exist_ok=True)
            path.chmod(0o755)
            if name in owners:
                os.chown(path, *owners[name])
        for path in (self.state / "mqtt-certs").glob("*.pem"):
            os.chown(path, self.broker_uid, self.broker_uid)
        for name in ("app", "framework", "app/private", "app/public", "framework/cache", "framework/sessions", "framework/views", "logs"):
            path = self.state / "app" / name
            path.mkdir(parents=True, exist_ok=True)
            os.chown(path, 33, 33)
            path.chmod(0o755)

    def running(self):
        return self.compose("ps", "--services", "--status", "running", stdout=subprocess.PIPE, text=True).stdout.split()

    def broker_init(self):
        if self.broker != "mqtt":
            return
        target = self.state / "mosquitto/dynamic-security.json"
        if target.exists():
            return # Never reset existing credentials/ACLs.
        run(["docker", "run", "--rm", "--user", "0", "-v", str(target.parent)+":/data", "eclipse-mosquitto:2.0.22@sha256:199ea8ef2e35ec2b1b37e59cfd1dbae538ed4dfa4a2251a121a52215a6248a21", "mosquitto_ctrl", "dynsec", "init", "/data/dynamic-security.json", "elwids-admin", self.env["MOSQUITTO_ADMIN_PASSWORD"]], stdout=subprocess.DEVNULL)
        config = json.loads(target.read_text())
        config["defaultACLAccess"] = {"publishClientSend": False, "publishClientReceive": False, "subscribe": False, "unsubscribe": True}
        private_write(target, json.dumps(config), 0o600)
        os.chown(target, 1883, 1883)

    def wait(self, url, timeout=120):
        deadline = time.monotonic()+timeout
        while time.monotonic() < deadline:
            try:
                # In-container requests work before public DNS/certificates are ready.
                self.compose("exec", "-T", "api", "curl", "--fail", "--silent", "--max-time", "5", url, stdout=subprocess.DEVNULL)
                return
            except RuntimeError:
                time.sleep(2)
        raise RuntimeError("Service readiness timed out")

    def deploy(self, backup_env, checkpoint_current=True):
        self.validate()
        if (self.config / "DEPLOYMENT_INCOMPLETE").exists():
            raise ValueError("Previous deployment did not complete; follow the recovery runbook before retrying")
        self.render()
        self.layout()
        if not (self.state / "mqtt-certs/fullchain.pem").is_file():
            raise ValueError("Issue MQTT certificates before deployment")
        if backup_env:
            self.restic(backup_env, "snapshots", "--json", stdout=subprocess.DEVNULL)
        else:
            raise ValueError("Configure off-host backup access before deployment")
        self.compose("pull", stdout=subprocess.DEVNULL)
        self.broker_init()
        old_manifest = self.config / "current-release.json"
        if old_manifest.exists():
            # Back up with the currently running release, not new images.
            current = Deployment(self.env_path, old_manifest)
            if checkpoint_current:
                current.backup(backup_env)
            shutil.copy2(old_manifest, self.config / "previous-release.json")
        private_write(self.config / "DEPLOYMENT_INCOMPLETE", self.release_text)
        # Quiesce before migrations and guarantee one runtime across release changes.
        self.compose("stop", "caddy", "simulator", "gps-simulator", *WRITERS, stdout=subprocess.DEVNULL)
        self.database_ready()
        # Generated files are atomically replaced. Recreate their bind mounts so
        # Docker cannot retain the previous config inode after a release.
        self.compose("up", "-d", "--force-recreate", "--wait", "nats", self.broker, stdout=subprocess.DEVNULL)
        if self.broker == "mqtt":
            self.compose("up", "-d", "--force-recreate", "broker-admin", stdout=subprocess.DEVNULL)
            self.compose("run", "--rm", "--no-deps", "migrate", "curl", "--fail", "--silent", "--retry", "20", "--retry-connrefused", "--retry-delay", "1", "--max-time", "3", "http://broker-admin:8082/health/ready", stdout=subprocess.DEVNULL)
        self.compose("run", "--rm", "migrate", stdout=subprocess.DEVNULL)
        self.compose("run", "--rm", "runtime-migrate", stdout=subprocess.DEVNULL)
        self.compose("run", "--rm", "migrate", "php", "artisan", "db:seed", "--class=PermissionSeeder", "--force", stdout=subprocess.DEVNULL)
        if self.broker == "mqtt":
            self.compose("run", "--rm", "migrate", "php", "artisan", "devices:reprovision-broker", stdout=subprocess.DEVNULL)
        services = yaml.safe_load((RELEASE / "compose.yml").read_text())["services"]
        applications = [name for name, service in services.items() if not service.get("profiles") and name not in ("timescaledb", "nats", "emqx")]
        self.compose("up", "-d", "--force-recreate", "--no-deps", *applications, stdout=subprocess.DEVNULL)
        self.wait("http://api-web/health/ready")
        if self.env.get("DEPLOY_ENVIRONMENT") == "staging" and self.env.get("IOT_STAGING_DEMO_ENABLED") == "true" and all((self.state / "simulator-config" / (name+".json")).is_file() for name in ("meter", "gps")):
            self.compose("--profile", "demo", "up", "-d", "simulator", "gps-simulator", stdout=subprocess.DEVNULL)
        self.smoke()
        private_write(old_manifest, self.release_text)
        (self.config / "DEPLOYMENT_INCOMPLETE").unlink()

    def restic(self, backup_env, *args, **kwargs):
        if not backup_env:
            raise ValueError("--backup-env is required")
        path = Path(backup_env)
        if path.stat().st_mode & 0o077:
            raise ValueError("Backup environment must have mode 0600")
        env = read_env(path)
        repository = env.get("RESTIC_REPOSITORY", "")
        if not repository.startswith(("s3:https://", "sftp:")):
            raise ValueError("Use an off-host encrypted S3 or SFTP repository")
        return run(["restic", *args], env={**os.environ, **env}, **kwargs)

    def backup(self, backup_env):
        if (self.config / "DEPLOYMENT_INCOMPLETE").exists():
            raise ValueError("An incomplete deployment must be reconciled before creating a recovery checkpoint")
        # Preflight remote access before any downtime; do not initialize repositories implicitly.
        self.restic(backup_env, "snapshots", "--json", stdout=subprocess.DEVNULL)
        running = self.running()
        checkpoint = Path(tempfile.mkdtemp(prefix="checkpoint-", dir=self.config))
        try:
            self.compose("stop", "caddy", "simulator", "gps-simulator", self.broker, *(["broker-admin"] if self.broker == "mqtt" else []), stdout=subprocess.DEVNULL)
            # Expire command deadlines while the runtime can still reconcile outcomes.
            time.sleep(45)
            self.compose("stop", *WRITERS, stdout=subprocess.DEVNULL)
            self.compose("stop", "nats", stdout=subprocess.DEVNULL)
            with (checkpoint / "database.dump").open("wb") as stream:
                self.database_command("pg_dump", "-U", "postgres", "-d", "iot", "-Fc", stdout=stream)
            # Broker and JetStream files are copied only while their owners are stopped.
            run(["tar", "-C", self.state, "-czf", checkpoint / "state.tar.gz", "app", "nats", "mosquitto" if self.broker == "mqtt" else "emqx", "simulators", "simulator-config", "mqtt-certs", "caddy"], stdout=subprocess.DEVNULL)
            shutil.copy2(self.env_path, checkpoint / "environment")
            private_write(checkpoint / "release.json", self.release_text)
            private_write(checkpoint / "checkpoint.json", json.dumps({"format": 1, "created_at": time.time(), "project": self.env["COMPOSE_PROJECT_NAME"], "quiesced": True}))
            self.restic(backup_env, "backup", checkpoint, "--tag", self.env["COMPOSE_PROJECT_NAME"], "--tag", "iot-checkpoint-v1", stdout=subprocess.DEVNULL)
            self.restic(backup_env, "forget", "--tag", self.env["COMPOSE_PROJECT_NAME"], "--group-by", "tags", "--keep-daily", "7", "--keep-weekly", "4", "--prune", stdout=subprocess.DEVNULL)
            private_write(self.state / "metrics/backup.prom", f"iot_backup_success_timestamp_seconds {int(time.time())}\n", 0o644)
        finally:
            # Restart only services that were running before the maintenance window.
            if running:
                dependencies = [name for name in ("nats", self.broker) if name in running]
                if dependencies:
                    self.compose("up", "-d", "--no-recreate", "--wait", *dependencies, stdout=subprocess.DEVNULL)
                remaining = [name for name in running if name not in dependencies]
                if remaining:
                    self.compose("start", *remaining, stdout=subprocess.DEVNULL)
            shutil.rmtree(checkpoint)
        self.ping_heartbeat("BACKUP_HEARTBEAT_URL")

    def restore(self, backup_env, snapshot, destination):
        if self.external_database:
            raise ValueError("Remote database restore is disabled: restore the checkpoint on an isolated single-node recovery host, verify quarantine, then migrate to a new database host")
        if self.state.exists() and any(self.state.iterdir()):
            raise ValueError("Restore requires an empty dedicated state directory on an isolated host")
        if not destination or Path(destination).exists():
            raise ValueError("--restore-dir must be a new private absolute directory")
        target = Path(destination)
        if not target.is_absolute():
            raise ValueError("Restore directory must be absolute")
        target.mkdir(mode=0o700, parents=True)
        self.restic(backup_env, "restore", snapshot, "--target", target, stdout=subprocess.DEVNULL)
        checkpoints = list(target.rglob("checkpoint.json"))
        if len(checkpoints) != 1 or not json.loads(checkpoints[0].read_text()).get("quiesced"):
            raise ValueError("Expected exactly one quiesced recovery checkpoint")
        source = checkpoints[0].parent
        backup_images = json.loads((source / "release.json").read_text())["images"]
        if backup_images != self.images["images"]:
            raise ValueError("Restore must use the exact backed-up release manifest")
        original = read_env(source / "environment")
        if original.get("DEVICE_BROKER_PROVIDER", "emqx") != self.env.get("DEVICE_BROKER_PROVIDER", "emqx"):
            raise ValueError("Restore requires the backed-up broker provider")
        if self.broker == "mqtt" and any(original.get(k) != self.env.get(k) for k in ("DEVICE_BROKER_ADMIN_TOKEN", "MOSQUITTO_ADMIN_PASSWORD")):
            raise ValueError("Restore requires backed-up Mosquitto credentials")
        if any(original.get(k) != self.env.get(k) for k in (*SECRET_KEYS, "APP_KEY", "DEVICE_EMQX_API_KEY")):
            raise ValueError("Restore requires the backed-up encryption and service credentials")
        self.validate()
        self.layout()
        self.render()
        # Prevent archive path traversal; archives come from our backup writer.
        import tarfile
        with tarfile.open(source / "state.tar.gz") as archive:
            archive.extractall(self.state, filter="data")
        self.layout()
        self.compose("up", "-d", "--wait", "timescaledb", stdout=subprocess.DEVNULL)
        for sql in ["DROP DATABASE iot WITH (FORCE)", "CREATE DATABASE iot"]:
            self.compose("exec", "-T", "timescaledb", "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-c", sql, stdout=subprocess.DEVNULL)
        self.compose("exec", "-T", "timescaledb", "psql", "-U", "postgres", "-d", "iot", "-v", "ON_ERROR_STOP=1", "-c", "CREATE EXTENSION IF NOT EXISTS timescaledb; SELECT timescaledb_pre_restore();", stdout=subprocess.DEVNULL)
        with (source / "database.dump").open("rb") as stream:
            self.compose("exec", "-T", "timescaledb", "pg_restore", "--exit-on-error", "-U", "postgres", "-d", "iot", stdin=stream, stdout=subprocess.DEVNULL)
        self.compose("exec", "-T", "timescaledb", "psql", "-U", "postgres", "-d", "iot", "-v", "ON_ERROR_STOP=1", "-c", "SELECT timescaledb_post_restore();", stdout=subprocess.DEVNULL)
        self.compose("run", "--rm", "-e", "IOT_RECOVERY_MODE=true", "-e", "DB_USERNAME=postgres", "-e", "DB_PASSWORD="+self.env["POSTGRES_PASSWORD"], "migrate", "php", "artisan", "deployment:quarantine-restore", stdout=subprocess.DEVNULL)
        # Restore archive extraction deliberately discards ownership; restore container UIDs.
        for name, owner in (("app", (33, 33)), ("mosquitto" if self.broker == "mqtt" else "emqx", (self.broker_uid, self.broker_uid)), ("mqtt-certs", (self.broker_uid, self.broker_uid))):
            for path in [self.state/name, *(self.state/name).rglob("*")]:
                if not path.is_symlink(): os.chown(path, *owner)
        # No runtime, broker, workers, scheduler or public ingress starts after restore.
        private_write(self.config / "RESTORE_QUARANTINE", "Review pending commands, queues and webhook deliveries before resuming.\n")
        print("Database and durable state restored in quarantine. No commands or notifications can execute. Follow the restore runbook.")

    def certificates(self, cloudflare_file=None, dry_run=False):
        mode = "cloudflare" if cloudflare_file else self.env.get("MQTT_ACME_CHALLENGE", "webroot")
        if mode not in ("cloudflare", "webroot"):
            raise ValueError("MQTT_ACME_CHALLENGE must be webroot or cloudflare")
        domain = "mqtt."+self.env["DOMAIN"]
        args = ["certbot", "certonly", "--non-interactive", "--agree-tos", "--email", self.env["ACME_EMAIL"], "-d", domain, "--keep-until-expiring"]
        bootstrap = None
        if mode == "cloudflare":
            cloudflare_file = cloudflare_file or self.env.get("CLOUDFLARE_CREDENTIALS_FILE")
            if not cloudflare_file or not Path(cloudflare_file).is_file():
                raise ValueError("Provide a private Certbot Cloudflare credential file")
            if Path(cloudflare_file).stat().st_mode & 0o077:
                raise ValueError("Cloudflare credentials must have mode 0600")
            args += ["--dns-cloudflare", "--dns-cloudflare-credentials", cloudflare_file, "--dns-cloudflare-propagation-seconds", "60"]
        else:
            webroot = self.state / "acme-webroot"
            webroot.mkdir(parents=True, exist_ok=True, mode=0o755)
            webroot.chmod(0o755)
            args += ["--webroot", "--webroot-path", str(webroot)]
        if dry_run:
            args += ["--dry-run"]
        try:
            if mode == "webroot" and "caddy" not in self.running():
                # Initial issuance must work before the broker has certificates.
                bootstrap = self.compose("run", "--rm", "-d", "--no-deps", "--service-ports", "caddy", "caddy", "run", "--config", "/etc/caddy/Acme.Caddyfile", "--adapter", "caddyfile", stdout=subprocess.PIPE, text=True).stdout.strip()
                if not re.fullmatch(r"[a-f0-9]{12,64}", bootstrap):
                    raise RuntimeError("Could not identify temporary ACME container")
            run(args, stdout=subprocess.DEVNULL)
        finally:
            if bootstrap and re.fullmatch(r"[a-f0-9]{12,64}", bootstrap):
                run(["docker", "stop", bootstrap], stdout=subprocess.DEVNULL)
        if dry_run:
            return # Never deploy a staging-CA certificate or restart the broker.
        target = self.state / "mqtt-certs"
        target.mkdir(parents=True, exist_ok=True)
        changed = False
        for filename in ("fullchain.pem", "privkey.pem"):
            content = (Path("/etc/letsencrypt/live") / domain / filename).read_text()
            changed = changed or not (target / filename).exists() or (target / filename).read_text() != content
            private_write(target / filename, content, 0o640)
            os.chown(target / filename, self.broker_uid, self.broker_uid)
        if changed and self.broker in self.running():
            # Restart reopens certificates even if their path did not change.
            self.compose("restart", self.broker, stdout=subprocess.DEVNULL)

    def staging(self):
        if self.env.get("DEPLOY_ENVIRONMENT") != "staging" or self.env.get("IOT_STAGING_DEMO_ENABLED") != "true":
            raise ValueError("Demo bootstrap is staging-only")
        private = self.state / "app/app/private"
        filename = "staging-accounts-"+str(int(time.time()))+".json"
        self.compose("exec", "-T", "api", "php", "artisan", "deployment:staging", "--output=/var/www/html/storage/app/private/"+filename, stdout=subprocess.DEVNULL)
        for name, flag in (("meter", []), ("gps", ["--gps"])):
            self.compose("exec", "-T", "api", "php", "artisan", "devices:prepare-simulator", *flag, "--broker=ssl://mqtt."+self.env["DOMAIN"]+":8883", "--ca=/etc/ssl/certs/ca-certificates.crt", "--output=/var/www/html/storage/app/private/"+name+".json", stdout=subprocess.DEVNULL)
            shutil.copy2(private / (name+".json"), self.state / "simulator-config" / (name+".json"))
        self.compose("--profile", "demo", "up", "-d", "simulator", "gps-simulator", stdout=subprocess.DEVNULL)
        time.sleep(10)
        self.compose("exec", "-T", "api", "php", "artisan", "deployment:activate-staging", stdout=subprocess.DEVNULL)
        print("Staging fixtures prepared; new account credentials: "+str(private / filename))

    def metrics(self):
        lines = [f"iot_collector_timestamp_seconds {int(time.time())}"]
        # Container inventory comes from the continuously scraped collector,
        # including absent expected containers; avoid duplicate host series.
        private_write(self.state / "metrics/containers.prom", "\n".join(lines)+"\n", 0o644)

    def ping_heartbeat(self, key):
        url = self.env.get(key)
        if not url:
            return False
        parts = urllib.parse.urlsplit(url)
        if parts.scheme != "https" or not parts.hostname or parts.username or parts.password or parts.fragment:
            raise ValueError(key+" must be an HTTPS heartbeat URL")
        try:
            with urllib.request.urlopen(url, timeout=10) as response:
                if response.status != 200:
                    raise RuntimeError("Heartbeat delivery failed")
        except Exception:
            raise RuntimeError(key+" delivery failed; inspect provider status") from None
        return True

    def monitoring_heartbeat(self):
        if not self.env.get("MONITORING_HEARTBEAT_URL"):
            raise ValueError("MONITORING_HEARTBEAT_URL is not configured")
        # Probe from the private network. Do not leak the provider URL into Docker
        # commands, logs or metrics; send only after every health check succeeds.
        script = (ROOT/'tooling/release/monitoring_health.py').read_text()
        self.compose("exec", "-T", "container-metrics", "python", "-", input=script, text=True, stdout=subprocess.DEVNULL)
        self.ping_heartbeat("MONITORING_HEARTBEAT_URL")

    def smoke(self):
        for host, path in [("app", "/"), ("admin", "/"), ("api", "/up"), ("api", "/health/ready")]:
            with urllib.request.urlopen("https://"+host+"."+self.env["DOMAIN"]+path, timeout=15) as response:
                if response.status != 200:
                    raise RuntimeError("Public HTTPS smoke check failed")
        print("Public HTTPS and dependency readiness checks passed.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["init", "validate", "render", "deploy", "backup", "restore", "certificates", "staging", "metrics", "monitoring_heartbeat", "smoke"])
    parser.add_argument("--env", required=True)
    parser.add_argument("--manifest")
    parser.add_argument("--backup-env")
    parser.add_argument("--cloudflare-file")
    parser.add_argument("--dry-run", action="store_true", help="Test MQTT ACME renewal without deploying a certificate")
    parser.add_argument("--snapshot")
    parser.add_argument("--restore-dir")
    args = parser.parse_args()
    os.umask(0o077)
    if args.command == "init":
        path = Path(args.env)
        if path.exists():
            raise ValueError("Environment already exists; refusing to replace keys")
        import base64
        values = read_env(RELEASE / "environment.example")
        values.update({key: secrets.token_hex(32) for key in SECRET_KEYS})
        values["APP_KEY"] = "base64:"+base64.b64encode(secrets.token_bytes(32)).decode()
        values["DEVICE_EMQX_API_KEY"] = secrets.token_hex(12)
        private_write(path, "".join(k+"="+json.dumps(v)+"\n" for k, v in values.items()))
        print("Private environment created. Fill provider inputs without changing generated keys.")
        return
    deployment = Deployment(args.env, args.manifest)
    if args.command == "validate":
        deployment.validate()
        print("Release configuration validated.")
        return
    with deployment.lock():
        if args.command in ("deploy", "staging") and (deployment.config / "RESTORE_QUARANTINE").exists():
            raise ValueError("Restored state is quarantined; follow recovery review before activation")
        if args.command == "deploy": deployment.deploy(args.backup_env)
        elif args.command == "backup": deployment.backup(args.backup_env)
        elif args.command == "restore":
            if not args.snapshot: raise ValueError("An explicit snapshot ID is required")
            deployment.restore(args.backup_env, args.snapshot, args.restore_dir)
        elif args.command == "certificates": deployment.certificates(args.cloudflare_file, args.dry_run)
        else: getattr(deployment, args.command)()


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, BlockingIOError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
