#!/usr/bin/env python3
"""Simulate only D1 (testing-d1), with its published Brightness percentage state.

Credentials and TLS CA location come from a private gateway configuration file.
Run with --config .local/devices/d1.json --state-file .local/devices/d1-state.json.
"""

import argparse
import json
import os
from pathlib import Path
import signal
import ssl
import threading
import time
from urllib.parse import urlparse

import paho.mqtt.client as mqtt
import sparkplug_b_pb2 as sp
from google.protobuf.message import DecodeError

DEVICE_ID = "testing-d1"


def metric(name, datatype, value, alias=None):
    result = sp.Payload.Metric(name=name, datatype=datatype, timestamp=int(time.time() * 1000))
    if alias is not None:
        result.alias = alias
    if datatype == sp.Boolean:
        result.boolean_value = value
    elif datatype == sp.Int64:
        result.long_value = value
    else:
        result.int_value = value
    return result


class D1Simulator:
    def __init__(self, config, state_file, brightness):
        self.config = config
        self.state_file = Path(state_file)
        self.state = json.loads(self.state_file.read_text()) if self.state_file.exists() else {"bd_seq": -1, "brightness": brightness}
        self.lock = threading.RLock()
        self.stop = threading.Event()
        self.online = False
        self.seq = 0
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=config["username"], protocol=mqtt.MQTTv311)
        self.client.username_pw_set(config["username"], config["password"])
        self.client.tls_set(ca_certs=config["ca_file"], cert_reqs=ssl.CERT_REQUIRED)
        self.client.reconnect_delay_set(min_delay=1, max_delay=10)
        self.client.on_pre_connect = self.before_connect
        self.client.on_connect = self.on_connect
        self.client.on_disconnect = self.on_disconnect
        self.client.on_message = self.on_message

    def topic(self, kind, device=""):
        base = f'spBv1.0/{self.config["group_id"]}/{kind}/{self.config["edge_node_id"]}'
        return base + ("/" + device if device else "")

    def save_state(self):
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.state_file.with_suffix(".tmp")
        temporary.write_text(json.dumps(self.state))
        os.chmod(temporary, 0o600)
        temporary.replace(self.state_file)

    def death(self):
        payload = sp.Payload(timestamp=int(time.time() * 1000))
        payload.metrics.append(metric("bdSeq", sp.Int64, self.state["bd_seq"]))
        return payload.SerializeToString()

    def before_connect(self, client, userdata):
        with self.lock:
            self.state["bd_seq"] = (self.state["bd_seq"] + 1) % 256
            self.save_state()
            client.will_set(self.topic("NDEATH"), self.death(), qos=1, retain=False)

    def send(self, kind, metrics, device=""):
        with self.lock:
            payload = sp.Payload(timestamp=int(time.time() * 1000), seq=self.seq)
            payload.metrics.extend(metrics)
            self.seq = (self.seq + 1) % 256
            self.client.publish(self.topic(kind, device), payload.SerializeToString(), qos=0, retain=False)

    def brightness(self):
        return [metric("Brightness", sp.Int32, self.state["brightness"], 1)]

    def birth(self):
        with self.lock:
            self.seq = 0
            self.send("NBIRTH", [metric("bdSeq", sp.Int64, self.state["bd_seq"]), metric("Node Control/Rebirth", sp.Boolean, False)])
            self.send("DBIRTH", self.brightness(), DEVICE_ID)
            self.online = True
            print(f'D1 connected: Brightness = {self.state["brightness"]}%', flush=True)

    def on_connect(self, client, userdata, flags, reason, properties):
        if reason.is_failure:
            print(f"Broker rejected connection: {reason}", flush=True)
            return
        client.subscribe([(self.topic("NCMD"), 1), (self.topic("DCMD", DEVICE_ID), 1), (f'spBv1.0/STATE/{self.config["host_id"]}', 1)])
        self.birth()

    def on_disconnect(self, client, userdata, flags, reason, properties):
        self.online = False
        print("D1 disconnected; reconnecting unless stopped.", flush=True)

    def on_message(self, client, userdata, message):
        with self.lock:
            try:
                if message.topic == f'spBv1.0/STATE/{self.config["host_id"]}':
                    if json.loads(message.payload).get("online"):
                        self.birth()
                    else:
                        self.online = False
                    return
                payload = sp.Payload.FromString(message.payload)
                if message.topic == self.topic("NCMD"):
                    if any(m.name == "Node Control/Rebirth" and m.boolean_value for m in payload.metrics):
                        self.birth()
                    return
                if message.topic != self.topic("DCMD", DEVICE_ID):
                    return
                for m in payload.metrics:
                    if m.name == "Brightness" and m.datatype == sp.Int32 and m.WhichOneof("value") == "int_value" and 0 <= m.int_value <= 100:
                        self.state["brightness"] = m.int_value
                        self.save_state()
                        print(f'Confirmed command received: Brightness = {m.int_value}%', flush=True)
                        self.send("DDATA", self.brightness(), DEVICE_ID)
            except (ValueError, TypeError, DecodeError) as error:
                print(f"Ignored malformed message: {type(error).__name__}", flush=True)

    def run(self):
        broker = urlparse(self.config["broker_url"])
        if broker.scheme != "ssl" or not broker.hostname:
            raise ValueError("A verified ssl:// broker connection is required")
        self.client.connect_async(broker.hostname, broker.port or 8883, keepalive=15)
        self.client.loop_start()
        print("D1 simulator running; reporting Brightness every two seconds. Stop with Ctrl-C.", flush=True)
        try:
            while not self.stop.wait(2):
                if self.online:
                    self.send("DDATA", self.brightness(), DEVICE_ID)
        finally:
            if self.client.is_connected():
                self.send("DDEATH", [], DEVICE_ID)
                self.client.publish(self.topic("NDEATH"), self.death(), qos=1, retain=False).wait_for_publish(timeout=3)
            self.client.disconnect()
            self.client.loop_stop()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    parser.add_argument("--state-file", required=True)
    parser.add_argument("--brightness", type=int, default=50, choices=range(101), metavar="0..100")
    args = parser.parse_args()
    simulator = D1Simulator(json.loads(Path(args.config).read_text()), args.state_file, args.brightness)
    for stop_signal in (signal.SIGINT, signal.SIGTERM):
        signal.signal(stop_signal, lambda *_: simulator.stop.set())
    simulator.run()
