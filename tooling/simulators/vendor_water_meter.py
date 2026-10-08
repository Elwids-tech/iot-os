#!/usr/bin/env python3
"""Publish unchanged manufacturer JSON using a downloaded tenant connection kit.

Requires paho-mqtt. No platform provisioning or Sparkplug code is used here.
"""
import argparse
import json
import math
import os
from pathlib import Path
import signal
import ssl
import tempfile
import time
from urllib.parse import urlparse

import paho.mqtt.client as mqtt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--kit', required=True)
    parser.add_argument('--serial', default='WM-1042')
    parser.add_argument('--topic', default='meters/WM-1042/telemetry')
    parser.add_argument('--state-file', required=True)
    parser.add_argument('--interval', type=float, default=2)
    parser.add_argument('--count', type=int, default=0, help='Zero keeps publishing until stopped')
    args = parser.parse_args()
    if not math.isfinite(args.interval) or args.interval < 0.1 or args.count < 0:
        parser.error('Use a positive interval and nonnegative count')
    kit = json.loads(Path(args.kit).read_text())
    url = urlparse(kit['broker_url'])
    if url.scheme not in ('mqtts', 'ssl'):
        parser.error('The connection kit must use TLS')
    state = Path(args.state_file).resolve()
    state.parent.mkdir(parents=True, exist_ok=True)
    total = json.loads(state.read_text())['total_ml'] if state.exists() else 8400000
    running = True

    def stop(*_):
        nonlocal running
        running = False

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    with tempfile.TemporaryDirectory(prefix='vendor-meter-') as directory:
        ca = Path(directory) / 'ca.crt'
        ca.write_text(kit['ca_certificate'])
        os.chmod(ca, 0o600)
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f'vendor-meter-{args.serial}')
        client.username_pw_set(kit['username'], kit['password'])
        client.tls_set(ca_certs=str(ca), tls_version=ssl.PROTOCOL_TLS_CLIENT)
        client.connect(url.hostname, url.port or 8883)
        client.loop_start()
        sent = 0
        try:
            while running and (args.count == 0 or sent < args.count):
                payload = {'serial': args.serial, 'flow_ml_min': 12000, 'total_ml': round(total)}
                info = client.publish(args.topic, json.dumps(payload), qos=1, retain=False)
                info.wait_for_publish(timeout=10)
                if not info.is_published():
                    raise RuntimeError('Broker did not acknowledge the sample')
                print(f'Published vendor sample {sent + 1}: {payload}', flush=True)
                sent += 1
                total += 12000 * args.interval / 60
                temporary = state.with_suffix('.tmp')
                temporary.write_text(json.dumps({'total_ml': total}))
                os.chmod(temporary, 0o600)
                os.replace(temporary, state)
                if running and (args.count == 0 or sent < args.count):
                    time.sleep(args.interval)
        finally:
            client.disconnect()
            client.loop_stop()


if __name__ == '__main__':
    main()
