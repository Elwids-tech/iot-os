#!/usr/bin/env python3
"""A simulated thermal fire-watch box: a direct Sparkplug B edge node.

It stands in for an edge-AI camera kit (colour and thermal cameras, on-board
detection, battery) that reports its detections over Sparkplug B. Incidents are
started from a loopback-only control page, so a presenter decides when the box
"sees" a hot spot, smoke or a person. Use the portal's connection kit config.
"""
import argparse
import json
import pathlib
import random
import signal
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from urllib.parse import urlparse

from sparkplug_simulator import Simulator, metric, sp

INCIDENTS = ('hot_spot', 'smoke', 'intrusion', 'camera_blocked', 'power_cut')
# (metric name, Sparkplug type, reading key); the alias is the position + 1.
METRICS = [
    ('Thermal/Max temperature', sp.Float, 'thermal_max'),
    ('Thermal/Scene temperature', sp.Float, 'thermal_scene'),
    ('Detection/Flame', sp.Boolean, 'flame'),
    ('Detection/Flame confidence', sp.Float, 'flame_confidence'),
    ('Detection/Smoke', sp.Boolean, 'smoke'),
    ('Detection/Person in zone', sp.Boolean, 'person'),
    ('Camera/View blocked', sp.Boolean, 'camera_blocked'),
    ('Power/Battery', sp.Float, 'battery'),
    ('Power/On battery', sp.Boolean, 'on_battery'),
    ('Detection/Count', sp.Int64, 'detections'),
]
LABELS = {'flame': 'Flame detected', 'smoke': 'Smoke detected', 'person': 'Person in exclusion zone',
          'camera_blocked': 'Camera view blocked; detections unknown', 'on_battery': 'Running on battery'}


class FireWatchBox(Simulator):
    def __init__(self, config, state_file):
        super().__init__(config, state_file)
        self.box_file = pathlib.Path(str(state_file) + '.box.json')
        saved = json.loads(self.box_file.read_text()) if self.box_file.exists() else {}
        self.battery = float(saved.get('battery', 100.0))
        self.detections = int(saved.get('detections', 0))
        self.active = {}  # incident -> monotonic start time
        self.thermal_max = 36.0
        self.thermal_scene = 23.5
        self.flame_confidence = 0.0
        self.powered = True
        self.log = []
        self.save_error = None
        self.last = self.readings_now()
        self.known = dict(self.last)

    def on_connect(self, client, userdata, flags, reason, properties):
        print(f'MQTT connection: {reason}', flush=True)
        super().on_connect(client, userdata, flags, reason, properties)

    def on_disconnect(self, client, userdata, flags, reason, properties):
        print(f'MQTT disconnected: {reason}', flush=True)
        super().on_disconnect(client, userdata, flags, reason, properties)

    def held(self, incident, seconds=0.0):
        return incident in self.active and time.monotonic() - self.active[incident] >= seconds

    def readings_now(self):
        flame = self.flame_confidence >= 60
        seen = {
            'thermal_max': round(self.thermal_max, 1), 'thermal_scene': round(self.thermal_scene, 1),
            'flame': flame, 'flame_confidence': round(self.flame_confidence, 1),
            # A fire that keeps burning makes smoke on its own.
            'smoke': self.held('smoke', 3) or (flame and self.held('hot_spot', 15)),
            'person': self.held('intrusion', 1),
        }
        # A blocked view reports what the cameras see as Sparkplug nulls, never as "clear".
        blind = self.held('camera_blocked', 2)
        return {**(dict.fromkeys(seen) if blind else seen), 'camera_blocked': blind,
                'battery': round(self.battery, 1), 'on_battery': self.held('power_cut'), 'detections': self.detections}

    def advance(self, elapsed):
        # The site keeps changing behind a covered lens; uncovering it shows the truth again.
        scene_target = 29.0 if self.held('hot_spot', 10) else 23.5
        self.thermal_scene += (scene_target - self.thermal_scene) * min(1, elapsed / 20) + random.uniform(-0.05, 0.05)
        hot_target = 142.0 if self.held('hot_spot') else 36.0
        self.thermal_max += (hot_target - self.thermal_max) * min(1, elapsed / 5) + random.uniform(-0.3, 0.3)
        confidence_target = 94.0 if self.held('hot_spot') and self.thermal_max > 90 else 0.0
        self.flame_confidence += (confidence_target - self.flame_confidence) * min(1, elapsed / 2)
        if self.held('power_cut'):
            self.battery = max(0.0, self.battery - 0.1 * elapsed)
        else:
            self.battery = min(100.0, self.battery + 0.5 * elapsed)
        current = self.readings_now()
        for key, label in LABELS.items():
            if current[key] is not None and current[key] != self.known[key]:
                if key in ('flame', 'smoke', 'person') and current[key]:
                    self.detections += 1
                    current['detections'] = self.detections
                self.note(label + (' (started)' if current[key] else ' (cleared)'))
                self.known[key] = current[key]
        self.last = current
        # A full disk must not take the box offline; it only loses battery and counter across restarts.
        try:
            temporary = self.box_file.with_suffix('.tmp')
            temporary.write_text(json.dumps({'battery': self.battery, 'detections': self.detections}))
            temporary.replace(self.box_file)
            self.save_error = None
        except OSError as error:
            if self.save_error is None:
                self.note(f'Could not save box state ({error.strerror}); still publishing')
            self.save_error = error

    def note(self, text):
        line = time.strftime('%H:%M:%S ') + text
        self.log = [line, *self.log][:12]
        print(line, flush=True)

    def change(self, body):
        with self.lock:
            if body.get('clear') is True:
                self.active.clear()
                self.note('All clear: every incident stopped')
            elif body.get('incident') in INCIDENTS and type(body.get('active')) is bool:
                incident = body['incident']
                if body['active'] and incident not in self.active:
                    self.active[incident] = time.monotonic()
                elif not body['active']:
                    self.active.pop(incident, None)
            elif type(body.get('battery')) in (int, float) and 0 <= body['battery'] <= 100:
                self.battery = float(body['battery'])
            else:
                raise ValueError('Send {"incident", "active"}, {"battery": 0-100} or {"clear": true}.')
            return self.view()

    def view(self):
        return {'online': self.online, 'powered': self.powered, 'incidents': sorted(self.active), 'readings': self.last, 'log': self.log}

    def readings(self, aliases_only=False):
        result = []
        for alias, (name, datatype, key) in enumerate(METRICS, 1):
            value = self.last[key]
            if value is None:
                item = sp.Payload.Metric(name=name, datatype=datatype, alias=alias, timestamp=int(time.time() * 1000), is_null=True)
            else:
                item = metric(name, datatype, value, alias)
            if aliases_only:
                item.ClearField('name')
                item.ClearField('datatype')
            result.append(item)
        return result

    def birth(self):
        with self.lock:
            if not self.powered:
                return
            self.seq = 0
            self.send('NBIRTH', [metric('bdSeq', sp.Int64, self.bd_seq), metric('Node Control/Rebirth', sp.Boolean, False), *self.readings()])
            self.online = True
            print('Published fire-watch NBIRTH with', len(METRICS), 'metrics.', flush=True)

    def shut_down(self):
        self.online = False
        if self.client.is_connected():
            death = sp.Payload(timestamp=int(time.time() * 1000))
            death.metrics.append(metric('bdSeq', sp.Int64, self.bd_seq))
            self.client.publish(self.topic('NDEATH'), death.SerializeToString(), qos=1).wait_for_publish(timeout=2)
        self.client.disconnect()

    def run(self):
        parsed = urlparse(self.config['broker_url'])
        if parsed.scheme != 'ssl':
            raise ValueError('A verified TLS ssl:// endpoint is required')
        self.client.connect_async(parsed.hostname, parsed.port or 8883, keepalive=10)
        self.client.loop_start()
        print('Fire-watch box simulator started; awaiting Sparkplug host state. No credentials are logged.', flush=True)
        tick = time.monotonic()
        try:
            while self.running:
                time.sleep(1)
                restart = False
                with self.lock:
                    current = time.monotonic()
                    self.advance(current - tick)
                    tick = current
                    # An empty battery powers the box off; mains power brings it back with a new session.
                    if self.powered and self.battery <= 0 and self.held('power_cut'):
                        self.powered = False
                        self.note('Battery empty: the box shut down')
                        self.shut_down()
                    elif not self.powered and not self.held('power_cut'):
                        self.powered = restart = True
                        self.note('Mains power restored: the box is starting')
                    if self.online:
                        self.send('NDATA', self.readings(aliases_only=True))
                if restart:
                    # A deliberate disconnect ends paho's network thread, so start a new one.
                    self.client.loop_stop()
                    self.client.connect_async(parsed.hostname, parsed.port or 8883, keepalive=10)
                    self.client.loop_start()
        finally:
            with self.lock:
                self.shut_down()
            self.client.loop_stop()


def serve_controls(box, port):
    page = pathlib.Path(__file__).with_name('fire_watch_controls.html').read_text()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def respond(self, status, body, content_type='application/json'):
            data = body.encode() if isinstance(body, str) else json.dumps(body).encode()
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def trusted_request(self):
            hosts = {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}
            return self.headers.get('Host') in hosts and self.headers.get('Origin') in (None, *['http://' + host for host in hosts])

        def do_GET(self):
            if not self.trusted_request():
                return self.respond(403, {'error': 'Local requests only.'})
            if self.path == '/':
                return self.respond(200, page, 'text/html; charset=utf-8')
            if self.path == '/state':
                with box.lock:
                    return self.respond(200, box.view())
            self.respond(404, {'error': 'Not found.'})

        def do_POST(self):
            if not self.trusted_request():
                return self.respond(403, {'error': 'Local requests only.'})
            if self.path != '/state':
                return self.respond(404, {'error': 'Not found.'})
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 < size <= 1024 or self.headers.get('Content-Type') != 'application/json':
                    raise ValueError('Send a small JSON change.')
                self.respond(200, box.change(json.loads(self.rfile.read(size))))
            except (ValueError, TypeError, UnicodeDecodeError) as error:
                self.respond(422, {'error': str(error)})

    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    Thread(target=server.serve_forever, daemon=True).start()
    print(f'Fire-watch box controls: http://127.0.0.1:{server.server_port}', flush=True)
    return server


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True, help="The connection kit's device-config.json")
    parser.add_argument('--state-file', required=True)
    parser.add_argument('--control-port', type=int, default=8767, help='Loopback port for the incident controls')
    args = parser.parse_args()
    path = pathlib.Path(args.config).resolve()
    config = json.loads(path.read_text())
    config['ca_file'] = str((path.parent / config['ca_file']).resolve())
    pathlib.Path(args.state_file).parent.mkdir(parents=True, exist_ok=True)
    box = FireWatchBox(config, args.state_file)
    server = serve_controls(box, args.control_port)

    def stop(*_):
        box.running = False
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        box.run()
    finally:
        server.shutdown()
        server.server_close()
