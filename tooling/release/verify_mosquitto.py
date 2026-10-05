#!/usr/bin/env python3
"""Disposable TLS/ACL/recovery acceptance fixture. No existing state or host ports."""
import json
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
IMAGE = 'eclipse-mosquitto:2.0.22@sha256:199ea8ef2e35ec2b1b37e59cfd1dbae538ed4dfa4a2251a121a52215a6248a21'
PASSWORD = 'isolated-fixture-password-48-characters-long'


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime-image', default='elwids-mosquitto-runtime:check', help='Locally rebuilt runtime image containing /broker-admin')
    args = parser.parse_args()
    name = 'elwids-mqtt-test-' + uuid.uuid4().hex[:10]
    with tempfile.TemporaryDirectory(prefix=name) as temp:
        path = Path(temp)
        arch = subprocess.check_output(['docker', 'info', '--format', '{{.Architecture}}'], text=True).strip()
        arch = {'aarch64': 'arm64', 'x86_64': 'amd64'}.get(arch, arch)
        run(['go', 'test', '-c', '-o', str(path/'tests'), './internal/brokeradmin'], cwd=ROOT/'services/runtime', env={**os.environ, 'GOOS': 'linux', 'GOARCH': arch, 'CGO_ENABLED': '0'})
        run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=mqtt.test', '-addext', 'subjectAltName=DNS:mqtt.test', '-keyout', str(path/'privkey.pem'), '-out', str(path/'fullchain.pem')], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        (path/'privkey.pem').chmod(0o644) # disposable one-day fixture only
        shutil.copy2(ROOT/'deploy/release/mosquitto.conf', path/'mosquitto.conf')
        run(['docker', 'run', '--rm', '--user', '0', '-v', str(path)+':/fixture', IMAGE, 'mosquitto_ctrl', 'dynsec', 'init', '/fixture/dynamic-security.json', 'elwids-admin', PASSWORD], stdout=subprocess.DEVNULL)
        config = json.loads((path/'dynamic-security.json').read_text())
        config['defaultACLAccess'] = {'publishClientSend': False, 'publishClientReceive': False, 'subscribe': False, 'unsubscribe': True}
        (path/'dynamic-security.json').write_text(json.dumps(config))
        run(['docker', 'network', 'create', '--internal', name], stdout=subprocess.DEVNULL)
        run(['docker', 'volume', 'create', name], stdout=subprocess.DEVNULL)
        try:
            run(['docker', 'run', '--rm', '--user', '0', '-v', name+':/data', '-v', str(path)+':/fixture', IMAGE, 'sh', '-c', 'cp /fixture/dynamic-security.json /data/; chown -R 1883:1883 /data; chmod 600 /data/dynamic-security.json'])

            def start():
                run(['docker', 'run', '-d', '--name', name, '--network', name, '--network-alias', 'mqtt.test', '-v', name+':/mosquitto/data', '-v', str(path)+':/mosquitto/certs:ro', '-v', str(path/'mosquitto.conf')+':/mosquitto/config/mosquitto.conf:ro', IMAGE], stdout=subprocess.DEVNULL)
                time.sleep(2)

            def verify(pattern):
                run(['docker', 'run', '--rm', '--network', name, '-v', str(path)+':/fixture:ro', '-e', 'BROKER_TEST_ADDRESS=ssl://mqtt.test:8883', '-e', 'BROKER_TEST_CA=/fixture/fullchain.pem', '-e', 'BROKER_TEST_ADMIN_URL=http://broker-admin:8082', '--entrypoint', '/fixture/tests', 'gcr.io/distroless/static-debian12:nonroot', '-test.v', '-test.run', pattern])

            start()
            run(['docker', 'run', '-d', '--name', name+'-admin', '--network', name, '--network-alias', 'broker-admin', '-v', str(path)+':/fixture:ro', '-e', 'BROKER_ADDRESS=ssl://mqtt.test:8883', '-e', 'BROKER_TLS_SERVER_NAME=mqtt.test', '-e', 'BROKER_CA_FILE=/fixture/fullchain.pem', '-e', 'BROKER_ADMIN_USERNAME=elwids-admin', '-e', 'BROKER_ADMIN_PASSWORD='+PASSWORD, '-e', 'DEVICE_BROKER_ADMIN_TOKEN=fixture-private-token-32-characters-long', '--entrypoint', '/broker-admin', args.runtime_image], stdout=subprocess.DEVNULL)
            time.sleep(2)
            verify('TestMosquittoAcceptance$')
            run(['docker', 'rm', '-f', name+'-admin'], stdout=subprocess.DEVNULL)
            # Persistence is periodic (30 seconds). Published data is not assumed
            # crash-durable before that interval; the database/JetStream are the
            # durable application record. Credentials are saved synchronously.
            time.sleep(32)
            run(['docker', 'kill', name], stdout=subprocess.DEVNULL)
            run(['docker', 'rm', name], stdout=subprocess.DEVNULL)
            start()
            verify('TestMosquittoRecovery$')
            run(['docker', 'stop', name], stdout=subprocess.DEVNULL)
            run(['docker', 'rm', name], stdout=subprocess.DEVNULL)
            # Restore broker files into a fresh volume, independently of the
            # original container and data volume.
            run(['docker', 'run', '--rm', '--user', '0', '-v', name+':/data', '-v', str(path)+':/fixture', IMAGE, 'tar', '-czf', '/fixture/broker-state.tar.gz', '-C', '/data', '.'])
            run(['docker', 'volume', 'rm', name], stdout=subprocess.DEVNULL)
            run(['docker', 'volume', 'create', name], stdout=subprocess.DEVNULL)
            run(['docker', 'run', '--rm', '--user', '0', '-v', name+':/data', '-v', str(path)+':/fixture', IMAGE, 'sh', '-c', 'tar -xzf /fixture/broker-state.tar.gz -C /data; chown -R 1883:1883 /data'])
            start()
            verify('TestMosquittoRecovery$')
            print('Mosquitto isolated acceptance, abrupt restart and fresh-volume restore passed.')
        finally:
            subprocess.run(['docker', 'rm', '-f', name+'-admin'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            subprocess.run(['docker', 'rm', '-f', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            subprocess.run(['docker', 'volume', 'rm', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            subprocess.run(['docker', 'network', 'rm', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == '__main__':
    main()
