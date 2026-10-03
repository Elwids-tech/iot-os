#!/usr/bin/env python3
"""Opt-in local monitoring; no cloud accounts, resets or external email."""
import argparse
import os
from pathlib import Path
import secrets
import subprocess

ROOT = Path(__file__).resolve().parents[2]
PRIVATE = ROOT / '.local/monitoring'
MONITORS = ['prometheus', 'alertmanager', 'grafana', 'loki', 'alloy', 'node-exporter', 'blackbox', 'container-metrics']
APPS = ['api', 'portal', 'alerts-worker', 'assistant-worker', 'webhooks-worker', 'automation-worker']


def initialize():
    PRIVATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    PRIVATE.chmod(0o700)
    path = PRIVATE / 'monitoring.env'
    if not path.exists():
        text = f'IOT_MONITORING_PRIVATE_DIR={PRIVATE}\nIOT_METRICS_TOKEN={secrets.token_hex(32)}\nIOT_GRAFANA_PASSWORD={secrets.token_hex(24)}\n'
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as stream:
            stream.write(text)
    path.chmod(0o600)
    values = dict(line.split('=', 1) for line in path.read_text().splitlines() if '=' in line)
    token = values['IOT_METRICS_TOKEN']
    if len(token) != 64 or any(c not in '0123456789abcdef' for c in token):
        raise ValueError('Invalid local metrics token')
    # Directory is 0700; this one file is readable by the unprivileged Prometheus
    # container through its explicit read-only bind mount. Never print it.
    (PRIVATE / 'metrics-token').write_text(token)
    (PRIVATE / 'metrics-token').chmod(0o644)
    return values


def compose(*args, **kwargs):
    command = ['rtk', 'proxy', 'docker', 'compose']
    for path in ['.env', '.local/devices/devices.env', '.local/monitoring/monitoring.env']:
        command += ['--env-file', str(ROOT / path)]
    for name in ['dev', 'app', 'devices', 'monitoring']:
        command += ['-f', str(ROOT / f'deploy/compose/compose.{name}.yml')]
    # Keep private-file values authoritative over accidental shell overrides.
    env = {**os.environ, **initialize()}
    return subprocess.run(command + list(args), cwd=ROOT, env=env, check=True, **kwargs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['init', 'up', 'status', 'config', 'stop'])
    args = parser.parse_args()
    initialize()
    if args.command == 'init':
        print('Private monitoring configuration ready; existing credentials preserved.')
    elif args.command == 'config':
        compose('config', '--quiet')
    elif args.command == 'up':
        compose('config', '--quiet')
        compose('up', '-d', '--build', '--no-deps', *APPS, *MONITORS)
        print('Grafana http://localhost:3000/d/iot-local/local-operations (local Viewer access)')
        print('Mailpit: use IOT_MAILPIT_UI_PORT in .env (8026 on this workstation).')
    elif args.command == 'status':
        compose('ps', *APPS, *MONITORS)
    elif args.command == 'stop':
        compose('stop', *MONITORS)


if __name__ == '__main__':
    main()
