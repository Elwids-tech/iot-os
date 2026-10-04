#!/usr/bin/env python3
"""Local USB hardware gateway. Only board reports become Sparkplug telemetry."""
import argparse
import fcntl
import json
import logging
from pathlib import Path
import queue
import re
import signal
import ssl
import sys
import threading
import time
from urllib.parse import urlparse
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "simulators"))
import paho.mqtt.client as mqtt
import serial
import sparkplug_b_pb2 as sp
from sparkplug_simulator import metric

METRICS = [
    ("power", "Power", sp.Boolean), ("color", "Color", sp.String),
    ("mode", "Mode", sp.String), ("brightness", "Brightness", sp.Int32),
    ("alarm_active", "Alarm active", sp.Boolean), ("alarm_mode", "Alarm mode", sp.String),
    ("volume", "Volume", sp.Int32), ("alarm_duration", "Alarm duration", sp.Int32),
]
KEYS = {key for key, _, _ in METRICS}


def validate(values, complete=False):
    if not isinstance(values, dict) or not values or set(values) - KEYS or (complete and set(values) != KEYS):
        raise ValueError("Invalid hardware state fields")
    for key, value in values.items():
        valid = ((key in ("power", "alarm_active") and type(value) is bool)
                 or (key == "color" and isinstance(value, str) and re.fullmatch(r"#[0-9A-F]{6}", value))
                 or (key == "mode" and value in ("solid", "blink", "strobe"))
                 or (key == "alarm_mode" and value in ("beep", "siren", "steady"))
                 or (key in ("volume", "brightness", "alarm_duration") and type(value) is int
                     and (1 <= value <= 60 if key == "alarm_duration" else 0 <= value <= 100)))
        if not valid:
            raise ValueError(f"Invalid {key}")
    return dict(values)


def decode_command(payload):
    changes = {}
    if not payload.metrics:
        raise ValueError("Empty command")
    for item in payload.metrics:
        matching = [(key, datatype) for alias, (key, name, datatype) in enumerate(METRICS, 1)
                    if (item.name == name if item.HasField("name") else item.HasField("alias") and item.alias == alias)]
        if len(matching) != 1:
            raise ValueError("Unknown metric")
        key, datatype = matching[0]
        if key in changes or not item.HasField("datatype") or item.datatype != datatype:
            raise ValueError("Duplicate metric or wrong datatype")
        field = {sp.Boolean: "boolean_value", sp.String: "string_value", sp.Int32: "int_value"}[datatype]
        if not item.HasField(field) or item.is_null:
            raise ValueError("Missing command value")
        changes[key] = getattr(item, field)
    return validate(changes)


class Bridge:
    def __init__(self, config, port, state_file):
        self.config, self.port, self.state_file = config, port, Path(state_file)
        self.lock = threading.RLock()
        self.commands = queue.Queue(maxsize=32)
        self.mqtt_connected = self.host_online = self.born = False
        self.last_report = 0
        self.boot_id = self.report_seq = None
        self.values = None
        self.sequence = self.bd_seq = 0
        self.stopping = threading.Event()
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
        with self.lock:
            self.mqtt_connected = not reason.is_failure
            self.host_online = self.born = False
            if self.mqtt_connected:
                client.subscribe([(self.topic("NCMD"), 0), (self.topic("DCMD", "rgb-light"), 0),
                                  (f'spBv1.0/STATE/{self.config["host_id"]}', 1)])

    def on_disconnect(self, *_):
        with self.lock:
            self.mqtt_connected = self.host_online = self.born = False
            self.clear_commands()

    def clear_commands(self):
        while not self.commands.empty():
            try:
                self.commands.get_nowait()
            except queue.Empty:
                break

    def send(self, kind, metrics, device=""):
        payload = sp.Payload(timestamp=int(time.time() * 1000), seq=self.sequence)
        payload.metrics.extend(metrics)
        self.sequence = (self.sequence + 1) % 256
        self.client.publish(self.topic(kind, device), payload.SerializeToString(), qos=0, retain=False)

    def hardware_metrics(self):
        return [metric(name, datatype, self.values[key], alias)
                for alias, (key, name, datatype) in enumerate(METRICS, 1)]

    def birth(self):
        if not self.mqtt_connected or not self.host_online or time.monotonic() - self.last_report > 3:
            return
        self.sequence = 0
        self.send("NBIRTH", [metric("bdSeq", sp.Int64, self.bd_seq), metric("Node Control/Rebirth", sp.Boolean, False)])
        self.send("DBIRTH", self.hardware_metrics(), "rgb-light")
        self.born = True
        logging.info("Physical board online; published eight hardware metrics")

    def on_message(self, client, _, message):
        with self.lock:
            try:
                if message.topic == f'spBv1.0/STATE/{self.config["host_id"]}':
                    self.host_online = json.loads(message.payload).get("online") is True
                    self.born = False
                    if self.host_online:
                        self.birth()
                    else:
                        self.clear_commands()
                    return
                if message.retain:
                    return
                payload = sp.Payload.FromString(message.payload)
                if message.topic == self.topic("NCMD"):
                    if any(m.name == "Node Control/Rebirth" and m.datatype == sp.Boolean and m.boolean_value for m in payload.metrics):
                        self.birth()
                elif message.topic == self.topic("DCMD", "rgb-light") and self.born and time.monotonic() - self.last_report <= 3:
                    changes = decode_command(payload)
                    self.commands.put_nowait((time.monotonic(), {"id": str(uuid4()), "set": changes}))
                    logging.info("Received command for %s", ", ".join(changes))
            except Exception as error:
                logging.warning("Rejected broker message: %s", type(error).__name__)

    def accept_report(self, report):
        if report.get("protocol") != "waveshare-audio.v1" or report.get("hardware_ok") is not True:
            raise ValueError("Board protocol or hardware check failed")
        values = validate(report.get("values"), complete=True)
        boot, seq = report.get("boot_id"), report.get("seq")
        if type(boot) is not int or type(seq) is not int or not 0 <= boot <= 0xffffffff or not 0 <= seq <= 0xffffffff:
            raise ValueError("Invalid report sequence")
        if boot == self.boot_id and self.report_seq is not None and seq <= self.report_seq:
            raise ValueError("Repeated or out-of-order report")
        if boot != self.boot_id:
            self.born = False
            self.clear_commands()
        self.boot_id, self.report_seq = boot, seq
        self.values, self.last_report = values, time.monotonic()
        if not self.born:
            self.birth()
        elif self.host_online and self.mqtt_connected:
            self.send("DDATA", self.hardware_metrics(), "rgb-light")

    def mark_offline(self):
        if self.born and self.mqtt_connected:
            self.send("DDEATH", [], "rgb-light")
            logging.warning("Physical board offline")
        self.born = False
        self.last_report = 0
        self.clear_commands()

    def run(self):
        url = urlparse(self.config["broker_url"])
        if url.scheme != "ssl" or url.hostname not in ("localhost", "127.0.0.1"):
            raise ValueError("This USB test bridge requires the local TLS broker")
        self.client.connect_async(url.hostname, url.port or 8883, keepalive=10)
        self.client.loop_start()
        try:
            while not self.stopping.is_set():
                try:
                    with serial.Serial(self.port, 115200, timeout=0.1, write_timeout=0.5, exclusive=True) as usb:
                        logging.info("USB port opened: %s", self.port)
                        usb.reset_input_buffer()
                        buffer = bytearray()
                        last_ping = 0
                        last_loop = time.monotonic()
                        while not self.stopping.is_set():
                            if time.monotonic() - last_loop > 3:
                                # After sleep/suspension, discard queued old observations and commands.
                                with self.lock:
                                    self.mark_offline()
                                usb.reset_input_buffer()
                                buffer.clear()
                            last_loop = time.monotonic()
                            chunk = usb.read(min(usb.in_waiting or 1, 4096))
                            buffer.extend(chunk)
                            while b"\n" in buffer:
                                line, _, buffer = buffer.partition(b"\n")
                                if len(line) > 4096:
                                    continue
                                try:
                                    with self.lock:
                                        self.accept_report(json.loads(line))
                                except (ValueError, TypeError, AttributeError, UnicodeDecodeError):
                                    pass  # Boot logs and malformed lines never become telemetry.
                            if len(buffer) > 4096:
                                raise ValueError("Oversized serial frame")
                            with self.lock:
                                now = time.monotonic()
                                if now - self.last_report > 3:
                                    self.mark_offline()
                                if self.mqtt_connected and self.host_online and now-last_ping >= 1:
                                    usb.write(b'{"ping":true}\n')
                                    last_ping = now
                                while not self.commands.empty():
                                    queued, command = self.commands.get_nowait()
                                    if self.born and self.host_online and now-queued < 2:
                                        usb.write((json.dumps(command)+"\n").encode())
                                        # Never publish target values or retry an uncertain serial write.
                        usb.write(b'{"id":"shutdown","set":{"alarm_active":false,"power":false}}\n')
                except (serial.SerialException, OSError, ValueError) as error:
                    logging.warning("USB unavailable: %s", type(error).__name__)
                finally:
                    with self.lock:
                        self.mark_offline()
                self.stopping.wait(1)
        finally:
            death = sp.Payload(timestamp=int(time.time()*1000))
            death.metrics.append(metric("bdSeq", sp.Int64, self.bd_seq))
            if self.mqtt_connected:
                self.client.publish(self.topic("NDEATH"), death.SerializeToString(), qos=1).wait_for_publish(timeout=2)
            self.client.disconnect()
            self.client.loop_stop()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    parser.add_argument("--port", required=True)
    parser.add_argument("--state-file", required=True)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    lockfile = open(args.state_file+".lock", "w")
    fcntl.flock(lockfile, fcntl.LOCK_EX | fcntl.LOCK_NB)
    bridge = Bridge(json.loads(Path(args.config).read_text()), args.port, args.state_file)
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: bridge.stopping.set())
    bridge.run()
