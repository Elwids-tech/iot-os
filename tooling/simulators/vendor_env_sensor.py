#!/usr/bin/env python3
"""Publish a typical vendor environmental sensor's JSON using a tenant connection kit.

Mimics an off-the-shelf MQTT device that is only pointed at a broker: fixed
topic, its own field names, epoch-second timestamps, radio and battery
diagnostics. Requires paho-mqtt. No platform or Sparkplug code is used here.
"""
import argparse
import json
import math
import os
from pathlib import Path
import random
import signal
import ssl
import tempfile
import time
from urllib.parse import urlparse

import paho.mqtt.client as mqtt


def reading(serial: str, started: float, now: float) -> dict:
    hours = (now - started) / 3600
    return {
        'device_id': serial,
        'ts': int(now),
        'temperature': round(21.5 + 2.5 * math.sin(hours * math.tau / 24) + random.uniform(-0.2, 0.2), 2),
        'humidity': round(45 - 8 * math.sin(hours * math.tau / 24) + random.uniform(-0.5, 0.5), 1),
        'rssi': random.randint(-78, -61),
        'snr': round(random.uniform(6, 11), 1),
        'battery_v': round(3.72 - hours * 0.0004, 3),
        'uptime_s': int(now - started),
        'fw': '1.4.2',
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--kit', required=True, help='device-config.json from the downloaded connection kit')
    parser.add_argument('--serial', default='ENV-0042')
    parser.add_argument('--topic', help='Defaults to sensors/<serial>/telemetry')
    parser.add_argument('--interval', type=float, default=5)
    parser.add_argument('--count', type=int, default=0, help='Zero keeps publishing until stopped')
    args = parser.parse_args()
    if not math.isfinite(args.interval) or args.interval < 0.1 or args.count < 0:
        parser.error('Use a positive interval and nonnegative count')
    topic = args.topic or f'sensors/{args.serial}/telemetry'
    kit = json.loads(Path(args.kit).read_text())
    url = urlparse(kit['broker_url'])
    if url.scheme not in ('mqtts', 'ssl'):
        parser.error('The connection kit must use TLS')
    running = True

    def stop(*_):
        nonlocal running
        running = False

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    started = time.time()
    with tempfile.TemporaryDirectory(prefix='vendor-env-') as directory:
        ca = Path(directory) / 'ca.crt'
        ca.write_text(kit['ca_certificate'])
        os.chmod(ca, 0o600)
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f'vendor-env-{args.serial}')
        client.username_pw_set(kit['username'], kit['password'])
        client.tls_set(ca_certs=str(ca), tls_version=ssl.PROTOCOL_TLS_CLIENT)
        client.connect(url.hostname, url.port or 8883)
        client.loop_start()
        sent = 0
        try:
            while running and (args.count == 0 or sent < args.count):
                payload = reading(args.serial, started, time.time())
                client.publish(topic, json.dumps(payload), qos=1, retain=False).wait_for_publish(timeout=10)
                sent += 1
                print(json.dumps({'topic': topic, **payload}), flush=True)
                time.sleep(args.interval)
        finally:
            client.loop_stop()
            client.disconnect()


if __name__ == '__main__':
    main()
