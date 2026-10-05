#!/usr/bin/env python3
"""Exercise release images in an isolated, disposable local Docker project.

Build iot-release-api:check, iot-release-api-web:check and
iot-release-simulator:check first. Portal/admin/runtime use the rebuilt local
development images. This is a packaging/fixture test, not cloud/TLS/soak evidence.
"""
import argparse
import base64
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import time

import yaml
from manage import ROOT, RELEASE, SECRET_KEYS, private_write


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--keep', action='store_true', help='Keep isolated containers/evidence for diagnosis')
    parser.add_argument('--broker', choices=['emqx', 'mosquitto'], default='emqx')
    args = parser.parse_args()
    broker = 'mqtt' if args.broker == 'mosquitto' else 'emqx'
    for port in [18091, 18092, 18093, 18896]:
        with socket.socket() as check:
            check.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            check.bind(('127.0.0.1', port))
    directory = Path(tempfile.mkdtemp(prefix='release-', dir=ROOT/'.local'))
    os.chmod(directory, 0o700)
    project = 'iot-release-check-'+secrets.token_hex(3)
    env = {key: secrets.token_hex(32) for key in SECRET_KEYS}
    env.update({'DOMAIN': 'release.test', 'DEPLOY_ENVIRONMENT': 'staging', 'COMPOSE_PROJECT_NAME': project,
                'STATE_DIR': str(directory/'state'), 'CONFIG_DIR': str(directory/'private'),
                'APP_KEY': 'base64:'+base64.b64encode(secrets.token_bytes(32)).decode(),
                'DEVICE_EMQX_API_KEY': secrets.token_hex(12), 'IOT_STAGING_DEMO_ENABLED': 'true',
                'MAIL_USERNAME': 'unused', 'MAIL_PASSWORD': 'unused', 'MAIL_FROM_ADDRESS': 'no-reply@example.test',
                'ALERT_EMAIL': 'operator@example.test', 'ACME_EMAIL': 'operator@example.test', 'VPN_CIDR': '100.64.0.0/10',
                'API_IMAGE': 'iot-release-api:check', 'API_WEB_IMAGE': 'iot-release-api-web:check',
                'SIMULATOR_IMAGE': 'iot-release-simulator:check', 'RUNTIME_IMAGE': 'iot-os-dev-runtime',
                'PORTAL_IMAGE': 'iot-os-dev-portal', 'ADMIN_IMAGE': 'iot-os-dev-admin'})
    if broker == 'mqtt':
        env.update(DEVICE_BROKER_PROVIDER='mosquitto', DEVICE_BROKER_ADMIN_TOKEN=secrets.token_hex(32), MOSQUITTO_ADMIN_PASSWORD=secrets.token_hex(32), RUNTIME_IMAGE='elwids-mosquitto-runtime:check')
    envfile = directory/'environment'
    private_write(envfile, ''.join(key+'='+json.dumps(value)+'\n' for key, value in env.items()))
    config = directory/'private'
    config.mkdir()
    private_write(config/'nats.conf', 'jetstream { store_dir: "/data", max_file_store: 25769803776, max_memory_store: 67108864 }\nhttp_port: 8222\nauthorization { users: [{user: "runtime", password: "'+env['NATS_PASSWORD']+'"}] }\n', 0o644)
    private_write(config/'emqx-api-keys', env['DEVICE_EMQX_API_KEY']+':'+env['DEVICE_EMQX_API_SECRET']+':administrator\n', 0o644)
    sql = (RELEASE/'init-db.sql').read_text()
    for key in ('API_DB_PASSWORD', 'RUNTIME_DB_PASSWORD'):
        sql = sql.replace('__'+key+'__', env[key])
    private_write(config/'init-db.sql', sql, 0o644)
    certs = directory/'certs'
    certs.mkdir()
    subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=mqtt.release.test', '-addext', 'subjectAltName=DNS:mqtt.release.test', '-keyout', str(certs/'privkey.pem'), '-out', str(certs/'fullchain.pem')], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    os.chmod(certs/'privkey.pem', 0o644)
    compose = yaml.safe_load((RELEASE/'compose.yml').read_text())
    if broker == 'mqtt':
        overlay = yaml.safe_load((RELEASE/'compose.mosquitto.yml').read_text())['services']
        compose['services'].update({name:overlay[name] for name in ('mqtt', 'broker-admin')})
    selected = ['api','api-web','portal','admin','migrate','default-worker','alerts-worker','assistant-worker','webhooks-worker','automation-worker','scheduler','timescaledb','nats','emqx','runtime','runtime-migrate','simulator','gps-simulator']
    if broker == 'mqtt':
        selected.remove('emqx')
        selected += ['mqtt','broker-admin']
    compose['services'] = {key:value for key,value in compose['services'].items() if key in selected}
    compose['volumes'] = {}
    for name, service in compose['services'].items():
        service.pop('ports', None)
        service.pop('mem_limit', None)
        if 'APP_ENV' in service.get('environment', {}):
            service['environment'].update({'APP_URL': 'http://localhost:18091', 'FRONTEND_URL': 'http://localhost:18092',
                'SESSION_DOMAIN': '', 'SESSION_SECURE_COOKIE': 'false', 'SANCTUM_STATEFUL_DOMAINS': 'localhost:18092,localhost:18093',
                'CORS_ALLOWED_ORIGINS': 'http://localhost:18092,http://localhost:18093'})
        if name in ('portal', 'admin'):
            service['environment'].update({'PUBLIC_API_URL': 'http://localhost:18091', 'PUBLIC_PORTAL_URL': 'http://localhost:18092', 'PUBLIC_ADMIN_URL': 'http://localhost:18093'})
        volumes = []
        for volume in service.get('volumes', []):
            source, target, *flags = volume.replace(':?}', '}').split(':')
            if source.startswith('${STATE_DIR'):
                suffix = source.split('/')[-1]
                if suffix == 'mqtt-certs': source = str(certs)
                elif suffix == 'simulator-config':
                    source = str(directory/'simulator-config')
                    Path(source).mkdir(exist_ok=True)
                else:
                    source = 'test-'+suffix
                    compose['volumes'][source] = {}
            elif source.startswith('./'):
                source = str(RELEASE/source[2:])
            volumes.append(':'.join([source,target,*flags]))
        service['volumes'] = volumes
        if name in ['runtime','runtime-migrate','simulator','gps-simulator','broker-admin']:
            service['volumes'].append(str(certs/'fullchain.pem')+':/certs/ca.pem:ro')
        if name == 'runtime': service['environment']['DEVICE_MQTT_CA_FILE'] = '/certs/ca.pem'
        if name == 'broker-admin': service['environment']['BROKER_CA_FILE'] = '/certs/ca.pem'
    for name, port, target in [('api-web',18091,80),('portal',18092,80),('admin',18093,80),(broker,18896,8883)]:
        compose['services'][name]['ports'] = [f'127.0.0.1:{port}:{target}']
    compose['networks'] = {'private': {}}
    # Independent restore target: never restore over the active verification DB.
    import copy
    restore_db = copy.deepcopy(compose['services']['timescaledb'])
    restore_db['profiles'] = ['tools']
    restore_db['volumes'] = [value.replace('test-postgres:', 'restore-postgres:') for value in restore_db['volumes']]
    compose['services']['restore-db'] = restore_db
    compose['volumes']['restore-postgres'] = {}
    composefile = directory/'compose.yml'
    composefile.write_text(yaml.safe_dump(compose))
    command = ['docker','compose','--profile','demo','--profile','tools','--env-file',str(envfile),'-p',project,'-f',str(composefile)]

    def call(*items, capture=False):
        result = subprocess.run(command+list(items), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if result.returncode:
            # stderr may contain credentials. Store it privately, never print it.
            private_write(directory/'failure.log', result.stdout+'\n'+result.stderr)
            raise RuntimeError('Release verification command failed; private evidence: '+str(directory/'failure.log'))
        return result.stdout if capture else None

    def wait(url):
        deadline=time.time()+120
        while time.time()<deadline:
            try:
                call('exec','-T','api','curl','--fail','--silent','--max-time','3',url)
                return
            except RuntimeError:
                time.sleep(2)
        raise RuntimeError('Release readiness timed out; inspect private Docker project '+project)

    try:
        if broker == 'mqtt':
            call('run','--rm','--no-deps','--user','0','mqtt','mosquitto_ctrl','dynsec','init','/mosquitto/data/dynamic-security.json','elwids-admin',env['MOSQUITTO_ADMIN_PASSWORD'])
        call('up','-d','--wait','timescaledb','nats',broker)
        if broker == 'mqtt':
            call('up','-d','broker-admin')
        call('run','--rm','migrate')
        call('run','--rm','runtime-migrate')
        call('run','--rm','migrate','php','artisan','db:seed','--class=PermissionSeeder','--force')
        call('up','-d','api','api-web','portal','admin','default-worker','alerts-worker','assistant-worker','webhooks-worker','automation-worker','scheduler','runtime')
        wait('http://api-web/health/ready')
        if broker == 'mqtt':
            wait('http://broker-admin:8082/health/ready')
        print('Release API/PHP-FPM/runtime readiness passed.', flush=True)
        call('exec','-T','api','php','artisan','deployment:staging','--output=/var/www/html/storage/app/private/accounts.json')
        for name, flag in [('meter',[]),('gps',['--gps'])]:
            call('exec','-T','api','php','artisan','devices:prepare-simulator',*flag,'--broker=ssl://mqtt.release.test:8883','--ca=/certs/ca.pem','--output=/var/www/html/storage/app/private/'+name+'.json')
            call('cp','api:/var/www/html/storage/app/private/'+name+'.json',str(directory/'simulator-config'/f'{name}.json'))
        call('--profile','demo','up','-d','simulator','gps-simulator')
        time.sleep(12)
        call('exec','-T','api','php','artisan','deployment:activate-staging')
        print('Five simulator devices and initial geofence activated with runtime acknowledgements.', flush=True)
        call('exec','-T','api','php','artisan','deployment:staging','--output=/var/www/html/storage/app/private/repeated.json')
        call('exec','-T','api','php','artisan','deployment:activate-staging')
        response = call('exec','-T','api','curl','--fail','--silent','-H','Authorization: Bearer '+env['IOT_METRICS_TOKEN'],'http://api-web/internal/ops/metrics',capture=True)
        assert 'iot_simulator_active_devices 5' in response
        private_write(directory/'metrics.txt',response)
        print('Bootstrap rerun and protected metrics passed.', flush=True)
        # Exercise the same Timescale pre/post restore sequence as manage.py.
        call('stop', 'simulator', 'gps-simulator', broker, 'runtime', 'api', 'default-worker', 'alerts-worker', 'assistant-worker', 'webhooks-worker', 'automation-worker', 'scheduler', 'nats')
        with (directory/'database.dump').open('wb') as stream:
            result = subprocess.run(command+['exec','-T','timescaledb','pg_dump','-U','postgres','-d','iot','-Fc'], stdout=stream, stderr=subprocess.PIPE)
            if result.returncode: raise RuntimeError('Isolated backup dump failed')
        call('up','-d','--wait','restore-db')
        for sql in ['DROP DATABASE iot WITH (FORCE)', 'CREATE DATABASE iot']:
            call('exec','-T','restore-db','psql','-U','postgres','-v','ON_ERROR_STOP=1','-c',sql)
        call('exec','-T','restore-db','psql','-U','postgres','-d','iot','-v','ON_ERROR_STOP=1','-c','CREATE EXTENSION IF NOT EXISTS timescaledb; SELECT timescaledb_pre_restore();')
        with (directory/'database.dump').open('rb') as stream:
            result = subprocess.run(command+['exec','-T','restore-db','pg_restore','--exit-on-error','-U','postgres','-d','iot'], stdin=stream, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if result.returncode:
                private_write(directory/'restore-failure.log', result.stderr.decode())
                raise RuntimeError('Isolated restore failed; see private evidence')
        call('exec','-T','restore-db','psql','-U','postgres','-d','iot','-v','ON_ERROR_STOP=1','-c','SELECT timescaledb_post_restore();')
        call('run','--rm','-e','DB_HOST=restore-db','-e','DB_USERNAME=postgres','-e','DB_PASSWORD='+env['POSTGRES_PASSWORD'],'-e','IOT_RECOVERY_MODE=true','migrate','php','artisan','deployment:quarantine-restore')
        counts = call('exec','-T','restore-db','psql','-U','postgres','-d','iot','-At','-c','SELECT (SELECT count(*) FROM users), (SELECT count(*) FROM devices), (SELECT count(*) FROM device_runtime.observations), (SELECT count(*) FROM jobs)',capture=True).strip().split('|')
        assert counts[0] == '7' and counts[1] == '5' and int(counts[2]) > 0 and counts[3] == '0', counts
        print('Independent Timescale restore and side-effect quarantine passed; accounts/devices/history preserved.', flush=True)
        call('stop','restore-db')
        call('start','nats',broker,'api','runtime','default-worker','alerts-worker','assistant-worker','webhooks-worker','automation-worker','scheduler','simulator','gps-simulator')
        wait('http://api-web/health/ready')
        time.sleep(12)
        call('exec','-T','api','php','artisan','deployment:activate-staging')
        print('Sparkplug reconnect after broker/runtime restart passed with runtime acknowledgements.', flush=True)
        private_write(directory/'result.json',json.dumps({'passed':True,'project':project,'at':time.time()}))
    finally:
        if args.keep:
            print('Isolated evidence kept: '+str(directory), flush=True)
        else:
            # Exact generated project only. Never targets the normal development stack.
            call('down','--volumes','--remove-orphans')
            shutil.rmtree(directory)


if __name__ == '__main__':
    main()
