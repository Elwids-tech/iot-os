#!/usr/bin/env python3
"""Verify split database config/authentication/checkpoint restore in isolated Docker.

This does not verify a cloud host, WireGuard, public firewalls, or WAL recovery.
Only the unique disposable project created here is removed on completion.
"""

import base64
import copy
import ipaddress
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
import uuid

import yaml
from manage import ROOT, RELEASE, SECRET_KEYS, IMAGES, read_env, private_write


def execute(args, *, check=True, **kwargs):
    result = subprocess.run([str(v) for v in args], stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs)
    if check and result.returncode:
        error = result.stderr if isinstance(result.stderr, str) else result.stderr.decode(errors='replace')
        private_write(ROOT/'.local/pilot-database-checks/last-error.log', error)
        raise RuntimeError(f"Database verification command failed with exit {result.returncode}; see private .local/pilot-database-checks/last-error.log")
    return result


def main():
    os.umask(0o077)
    name = 'iot-db-check-'+uuid.uuid4().hex[:10]
    ids = execute(['docker', 'network', 'ls', '-q'], text=True).stdout.split()
    existing = json.loads(execute(['docker', 'network', 'inspect', *ids], text=True).stdout) if ids else []
    occupied = [ipaddress.ip_network(c['Subnet']) for n in existing for c in (n['IPAM'].get('Config') or []) if c.get('Subnet')]
    subnet = next(ipaddress.ip_network(f'172.29.{n}.0/24') for n in range(196, 240)
                  if not any(ipaddress.ip_network(f'172.29.{n}.0/24').overlaps(o) for o in occupied if o.version == 4))
    address, client_address = str(subnet[10]), str(subnet[20])
    evidence = ROOT/'.local'/'pilot-database-checks'
    evidence.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=name+'-', dir=evidence) as temp:
        root = Path(temp)
        env = read_env(RELEASE/'environment.example')
        env.update({key: secrets.token_hex(32) for key in SECRET_KEYS})
        env.update({key: 'unused-local-fixture:check' for key in IMAGES})
        env.update(DATABASE_HOST=address, STATE_DIR=str(root/'state'), CONFIG_DIR=str(root/'private'),
                   APP_KEY='base64:'+base64.b64encode(secrets.token_bytes(32)).decode(),
                   DEVICE_EMQX_API_KEY=secrets.token_hex(12), MAIL_USERNAME='fixture', MAIL_PASSWORD='fixture',
                   MAIL_FROM_ADDRESS='fixture@example.test', ALERT_EMAIL='fixture@example.test',
                   ACME_EMAIL='fixture@example.test', COMPOSE_PROJECT_NAME=name)
        private_write(root/'environment', ''.join(f'{k}={json.dumps(v)}\n' for k,v in env.items()))
        config = root/'private'
        config.mkdir()
        sql = (RELEASE/'init-db.sql').read_text()
        for key in ('API_DB_PASSWORD', 'RUNTIME_DB_PASSWORD'):
            sql = sql.replace('__'+key+'__', env[key])
        private_write(config/'init-db.sql', sql, 0o644)
        private_write(config/'pg_hba.conf', (RELEASE/'pg_hba.pilot.conf').read_text().replace('__APP_TUNNEL_ADDRESS__', client_address), 0o644)
        def render(*files):
            command = ['docker', 'compose', '--profile', '*', '--env-file', root/'environment']
            for file in files:
                command += ['-f', RELEASE/file]
            return json.loads(execute([*command, 'config', '--format', 'json'], text=True, env={**os.environ, **env}).stdout)
        database = render('compose.database.yml')
        app = render('compose.yml', 'compose.external-db.yml')
        for service in ('api', 'migrate', 'default-worker', 'alerts-worker', 'assistant-worker', 'webhooks-worker', 'automation-worker', 'scheduler'):
            assert app['services'][service]['environment']['DB_HOST'] == address, service
        for service in ('runtime', 'runtime-migrate'):
            assert '@'+address+':5432/' in app['services'][service]['environment']['DEVICE_DATABASE_URL'], service
        assert app['services']['timescaledb']['profiles'] == ['local-database']
        assert 'timescaledb' not in app['services']['container-metrics']['environment']['EXPECTED_SERVICES'].split(',')
        server = copy.deepcopy(database['services']['timescaledb'])
        assert server['ports'][0]['host_ip'] == address
        server['ports'] = []  # Fixture publishes no host ports.
        server['volumes'][0] = {'type': 'volume', 'source': 'postgres', 'target': '/var/lib/postgresql/data'}
        server['networks'] = {'private': {'ipv4_address': address}}
        client = copy.deepcopy(app['services']['db-client'])
        client['networks'] = {'private': {'ipv4_address': client_address}}
        model = {'name': name, 'services': {'database': server, 'db-client': client},
                 'volumes': {'postgres': {}}, 'networks': {'private': {'ipam': {'config': [{'subnet': str(subnet)}]}}}}
        private_write(root/'compose.yml', yaml.safe_dump(model))
        command = ['docker', 'compose', '-f', root/'compose.yml']
        def compose(*args, **kwargs):
            return execute([*command, *args], **kwargs)
        def client_run(*args, **kwargs):
            return compose('run', '--rm', '--no-deps', '-T', 'db-client', *args, **kwargs)
        try:
            compose('up', '-d', '--build', '--wait', 'database')
            client_run('psql', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE TABLE public.recovery_fixture (id integer primary key, payload text); INSERT INTO public.recovery_fixture VALUES (1, $$pilot-data$$)')
            compose('run', '--rm', '--no-deps', '-T', '-e', 'PGPASSWORD='+env['API_DB_PASSWORD'], 'db-client', 'psql', '-U', 'iot_api', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE TABLE public.api_fixture (id integer)')
            compose('run', '--rm', '--no-deps', '-T', '-e', 'PGPASSWORD='+env['RUNTIME_DB_PASSWORD'], 'db-client', 'psql', '-U', 'iot_runtime', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE TABLE device_runtime.runtime_fixture (id integer)')
            rejected = compose('run', '--rm', '--no-deps', '-T', '-e', 'PGPASSWORD=wrong-password', 'db-client', 'psql', '-U', 'iot_api', '-c', 'SELECT 1', check=False)
            assert rejected.returncode != 0, 'Invalid password accepted'
            dump = client_run('pg_dump', '-Fc').stdout
            client_run('psql', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE DATABASE iot_restore')
            client_run('psql', '-d', 'iot_restore', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE EXTENSION IF NOT EXISTS timescaledb; SELECT timescaledb_pre_restore()')
            client_run('pg_restore', '--exit-on-error', '-d', 'iot_restore', input=dump)
            client_run('psql', '-d', 'iot_restore', '-v', 'ON_ERROR_STOP=1', '-c', 'SELECT timescaledb_post_restore()')
            result = client_run('psql', '-d', 'iot_restore', '-At', '-c', 'SELECT payload FROM public.recovery_fixture').stdout.decode().strip()
            assert result == 'pilot-data', 'Restored fixture differs'
            print('PASS: external app/runtime configuration, private database binding, role authentication, invalid-password rejection, Timescale checkpoint dump/restore. Isolated containers recreated; no cloud/tunnel verification claimed.')
        finally:
            compose('--profile', 'tools', 'down', '-v', '--remove-orphans')


if __name__ == '__main__':
    main()
