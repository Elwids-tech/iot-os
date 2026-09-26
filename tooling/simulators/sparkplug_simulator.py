#!/usr/bin/env python3
"""Independent Sparkplug meter, light, or GPS simulator; credentials stay private."""
import argparse
import json
import pathlib
import ssl
import threading
import time
from urllib.parse import urlparse

import paho.mqtt.client as mqtt
import sparkplug_b_pb2 as sp
from rgb_controls import load_state, save_state, validate_changes, serve_controls
from gps_route import gps_position


def metric(name, datatype, value, alias=None):
    result = sp.Payload.Metric(name=name, datatype=datatype, timestamp=int(time.time() * 1000))
    if alias is not None:
        result.alias = alias
    if datatype == sp.Boolean:
        result.boolean_value = value
    elif datatype in (sp.Int8, sp.Int16, sp.Int32, sp.UInt8, sp.UInt16, sp.UInt32):
        result.int_value = value & 0xFFFFFFFF
    elif datatype in (sp.Int64, sp.UInt64, sp.DateTime):
        result.long_value = value & 0xFFFFFFFFFFFFFFFF
    elif datatype == sp.Float:
        result.float_value = value
    elif datatype == sp.Double:
        result.double_value = value
    elif datatype in (sp.String, sp.Text, sp.UUID):
        result.string_value = value
    elif datatype == sp.Bytes:
        result.bytes_value = value
    return result


class Simulator:
    def __init__(self, config, state_file, ignore_commands=False, rgb_v2=False, gps=False):
        self.config = config
        self.state_file = pathlib.Path(state_file)
        self.ignore_commands = ignore_commands
        self.lock = threading.RLock()
        self.seq = 0
        self.bd_seq = 0
        self.online = False
        self.running = True
        self.started = time.monotonic()
        self.values = {"power": False, "color": "#ff0000", "mode": "blink", "brightness": 5}
        self.rgb_v2 = rgb_v2
        self.gps = gps
        self.rgb_state_file = pathlib.Path(str(state_file) + ".rgb.json")
        if rgb_v2:
            self.values = load_state(self.rgb_state_file)
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=config["username"], protocol=mqtt.MQTTv311)
        self.client.username_pw_set(config["username"], config["password"])
        self.client.tls_set(ca_certs=config["ca_file"], tls_version=ssl.PROTOCOL_TLS_CLIENT)
        self.client.on_pre_connect = self.before_connect
        self.client.on_connect = self.on_connect
        self.client.on_disconnect = self.on_disconnect
        self.client.on_message = self.on_message

    def topic(self, kind, device=""):
        root = f'spBv1.0/{self.config["group_id"]}/{kind}/{self.config["edge_node_id"]}'
        return root + ("/" + device if device else "")

    def before_connect(self, client, _):
        with self.lock:
            previous = int(self.state_file.read_text()) if self.state_file.exists() else -1
            self.bd_seq = (previous + 1) % 256
            self.state_file.write_text(str(self.bd_seq))
            death = sp.Payload(timestamp=int(time.time() * 1000))
            death.metrics.append(metric("bdSeq", sp.Int64, self.bd_seq))
            client.will_set(self.topic("NDEATH"), death.SerializeToString(), qos=1, retain=False)

    def on_connect(self, client, _, flags, reason, properties):
        if reason.is_failure:
            return
        client.subscribe([(self.topic("NCMD"), 0), (self.topic("DCMD", "+"), 0), (f'spBv1.0/STATE/{self.config["host_id"]}', 1)])

    def on_disconnect(self, client, userdata, flags, reason, properties):
        self.online = False

    def send(self, kind, metrics, device=""):
        with self.lock:
            payload = sp.Payload(timestamp=int(time.time() * 1000), seq=self.seq)
            payload.metrics.extend(metrics)
            self.seq = (self.seq + 1) % 256
            self.client.publish(self.topic(kind, device), payload.SerializeToString(), qos=0, retain=False)

    def meter(self, aliases_only=False):
        elapsed = time.monotonic() - self.started
        values = [("Voltage L1", 230.0, sp.Double), ("Voltage L2", 231.0, sp.Double), ("Voltage L3", 229.0, sp.Double),
                  ("Imported energy", 100.0 + elapsed / 3600, sp.Double), ("Exported energy", 5.0 + elapsed / 72000, sp.Double)]
        result = []
        for alias, (name, value, datatype) in enumerate(values, 1):
            m = metric(name, datatype, value, alias)
            if aliases_only:
                m.ClearField("name")
                m.ClearField("datatype")
            result.append(m)
        return result

    def light(self):
        return [metric("Power", sp.Boolean, self.values["power"], 1), metric("Color", sp.String, self.values["color"], 2),
                metric("Mode", sp.String, self.values["mode"], 3), metric("Brightness", sp.Int32, self.values["brightness"], 4)]

    def location(self, aliases_only=False):
        latitude, longitude, accuracy = gps_position(time.monotonic() - self.started)
        values = [("Latitude", latitude), ("Longitude", longitude), ("Accuracy", accuracy)]
        result = []
        for alias, (name, value) in enumerate(values, 1):
            item = metric(name, sp.Double, value, alias)
            if aliases_only:
                item.ClearField("name")
                item.ClearField("datatype")
            result.append(item)
        return result

    def birth(self):
        with self.lock:
            self.seq = 0
            self.send("NBIRTH", [metric("bdSeq", sp.Int64, self.bd_seq), metric("Node Control/Rebirth", sp.Boolean, False), metric("Uptime", sp.Double, time.monotonic() - self.started, 1)])
            if self.gps:
                self.send("DBIRTH", self.location(), "gps-tracker")
            else:
                self.send("DBIRTH", self.meter(), "meter")
                self.send("DBIRTH", self.light(), "rgb-light")
            self.online = True

    def on_message(self, client, userdata, message):
        with self.lock:
            if "/STATE/" in message.topic:
                try:
                    state = json.loads(message.payload)
                    if state.get("online"):
                        self.birth()
                    else:
                        self.online = False
                except (ValueError, TypeError):
                    pass
                return
            payload = sp.Payload()
            payload.ParseFromString(message.payload)
            if "/NCMD/" in message.topic:
                if any(m.name == "Node Control/Rebirth" and m.boolean_value for m in payload.metrics):
                    self.birth()
                return
            if not message.topic.endswith("/rgb-light"):
                return
            print("State command received", flush=True)
            if self.ignore_commands:
                return
            if self.rgb_v2:
                changes = {}
                for m in payload.metrics:
                    if m.name == "Power" and m.datatype == sp.Boolean:
                        changes["power"] = m.boolean_value
                    elif m.name == "Color" and m.datatype == sp.String:
                        changes["color"] = m.string_value
                    elif m.name == "Mode" and m.datatype == sp.String:
                        changes["mode"] = m.string_value
                    elif m.name == "Brightness" and m.datatype == sp.Int32:
                        changes["brightness"] = m.int_value
                try:
                    self.apply_rgb_changes(changes)
                except ValueError as error:
                    print(f"RGB command rejected: {error}", flush=True)
                return
            for m in payload.metrics:
                if m.name == "Power" and m.datatype == sp.Boolean:
                    self.values["power"] = m.boolean_value
                elif m.name == "Color" and m.datatype == sp.String:
                    self.values["color"] = m.string_value
                elif m.name == "Mode" and m.datatype == sp.String and m.string_value in ("blink", "strobe", "rainbow"):
                    self.values["mode"] = m.string_value
                elif m.name == "Brightness" and m.datatype == sp.Int32 and 1 <= m.int_value <= 10:
                    self.values["brightness"] = m.int_value
            self.send("DDATA", self.light(), "rgb-light")

    def apply_rgb_changes(self, changes):
        with self.lock:
            next_values = {**self.values, **validate_changes(changes)}
            save_state(self.rgb_state_file, next_values)
            self.values = next_values
            if self.online:
                self.send("DDATA", self.light(), "rgb-light")

    def run(self):
        parsed = urlparse(self.config["broker_url"])
        if parsed.scheme != "ssl":
            raise ValueError("The simulator requires ssl:// and verified TLS")
        self.client.connect_async(parsed.hostname, parsed.port or 8883, keepalive=10)
        self.client.loop_start()
        print("Sparkplug GPS simulator started." if self.gps else "Sparkplug meter and RGB-light simulator started.", flush=True)
        try:
            while True:
                time.sleep(1)
                with self.lock:
                    if self.online:
                        if self.gps:
                            self.send("DDATA", self.location(aliases_only=True), "gps-tracker")
                        else:
                            self.send("DDATA", self.meter(aliases_only=True), "meter")
                            if int(time.monotonic() - self.started) % 5 == 0:
                                self.send("DDATA", self.light(), "rgb-light")
        except KeyboardInterrupt:
            with self.lock:
                self.online = False
                death = sp.Payload(timestamp=int(time.time() * 1000))
                death.metrics.append(metric("bdSeq", sp.Int64, self.bd_seq))
                self.client.publish(self.topic("NDEATH"), death.SerializeToString(), qos=1).wait_for_publish(timeout=2)
            self.client.disconnect()
            self.client.loop_stop()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--state-file", required=True)
    parser.add_argument("--ignore-commands", action="store_true")
    parser.add_argument("--rgb-v2", action="store_true", help="Use Solid/Blink/Strobe and 0–100% brightness; persist RGB state.")
    parser.add_argument("--gps", action="store_true", help="Publish a GPS route that crosses the demo geofence.")
    parser.add_argument("--control-port", type=int, help="Serve optional local RGB controls on this loopback port (requires --rgb-v2).")
    args = parser.parse_args()
    if args.control_port is not None and not args.rgb_v2:
        parser.error("--control-port requires --rgb-v2")
    if args.gps and (args.rgb_v2 or args.control_port is not None):
        parser.error("--gps cannot be combined with RGB controls")
    simulator = Simulator(json.loads(pathlib.Path(args.config).read_text()), args.state_file, args.ignore_commands, args.rgb_v2, args.gps)
    server = serve_controls(simulator, args.control_port) if args.control_port is not None else None
    try:
        simulator.run()
    finally:
        if server:
            server.shutdown()
            server.server_close()
