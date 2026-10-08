#!/usr/bin/env python3
"""A direct Sparkplug B water meter using the portal's downloaded connection kit.

No provisioning shortcut: extract the kit, then pass device-config.json here.
Flow is L/min. Total volume is litres, persisted across process restarts.
"""
import argparse
import json
import math
import pathlib
import signal
import time
from urllib.parse import urlparse

from sparkplug_simulator import Simulator, metric, sp


class WaterMeter(Simulator):
    def on_connect(self, client, userdata, flags, reason, properties):
        print(f'MQTT connection: {reason}', flush=True)
        super().on_connect(client, userdata, flags, reason, properties)

    def on_disconnect(self, client, userdata, flags, reason, properties):
        print(f'MQTT disconnected: {reason}', flush=True)
        super().on_disconnect(client, userdata, flags, reason, properties)

    def __init__(self, config, state_file, flow_rate=12.0):
        super().__init__(config, state_file)
        self.flow_rate = flow_rate
        self.volume_file = pathlib.Path(str(state_file) + '.volume.json')
        self.total_volume = json.loads(self.volume_file.read_text())['total_volume'] if self.volume_file.exists() else 1000.0
        self.last_tick = time.monotonic()

    def readings(self, aliases_only=False):
        result = [metric('flow_rate', sp.Double, self.flow_rate, 1), metric('total_volume', sp.Double, self.total_volume, 2)]
        if aliases_only:
            for item in result:
                item.ClearField('name')
                item.ClearField('datatype')
        return result

    def birth(self):
        with self.lock:
            self.seq = 0
            self.send('NBIRTH', [metric('bdSeq', sp.Int64, self.bd_seq), metric('Node Control/Rebirth', sp.Boolean, False), *self.readings()])
            self.online = True
            print('Published water-meter NBIRTH; sending flow_rate and total_volume.', flush=True)

    def advance(self, elapsed):
        self.total_volume += self.flow_rate * elapsed / 60.0
        temporary = self.volume_file.with_suffix('.tmp')
        temporary.write_text(json.dumps({'total_volume': self.total_volume}))
        temporary.replace(self.volume_file)

    def run(self):
        parsed = urlparse(self.config['broker_url'])
        if parsed.scheme != 'ssl':
            raise ValueError('A verified TLS ssl:// endpoint is required')
        self.client.connect_async(parsed.hostname, parsed.port or 8883, keepalive=10)
        self.client.loop_start()
        print('Water-meter simulator started; awaiting Sparkplug host state. No credentials are logged.', flush=True)
        try:
            while self.running:
                time.sleep(1)
                with self.lock:
                    current = time.monotonic()
                    self.advance(current - self.last_tick)
                    self.last_tick = current
                    if self.online:
                        self.send('NDATA', self.readings(aliases_only=True))
        finally:
            with self.lock:
                self.online = False
                if self.client.is_connected():
                    death = sp.Payload(timestamp=int(time.time() * 1000))
                    death.metrics.append(metric('bdSeq', sp.Int64, self.bd_seq))
                    self.client.publish(self.topic('NDEATH'), death.SerializeToString(), qos=1).wait_for_publish(timeout=2)
                self.client.disconnect()
                self.client.loop_stop()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    parser.add_argument('--state-file', required=True)
    parser.add_argument('--flow-rate', type=float, default=12.0, help='Litres per minute, non-negative')
    args = parser.parse_args()
    if not math.isfinite(args.flow_rate) or args.flow_rate < 0:
        parser.error('--flow-rate must be finite and non-negative')
    path = pathlib.Path(args.config).resolve()
    config = json.loads(path.read_text())
    config['ca_file'] = str((path.parent / config['ca_file']).resolve())
    pathlib.Path(args.state_file).parent.mkdir(parents=True, exist_ok=True)
    meter = WaterMeter(config, args.state_file, args.flow_rate)
    def stop(*_):
        meter.running = False
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    meter.run()
