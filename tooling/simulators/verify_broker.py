#!/usr/bin/env python3
import argparse
import json
import ssl
import threading
import uuid
from urllib.parse import urlparse
import paho.mqtt.client as mqtt

parser = argparse.ArgumentParser()
parser.add_argument("--config", required=True)
args = parser.parse_args()
config = json.load(open(args.config))
address = urlparse(config["broker_url"])
def client(trusted=True):
    value = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="isolation-check-" + uuid.uuid4().hex, protocol=mqtt.MQTTv5)
    value.username_pw_set(config["username"], config["password"])
    value.tls_set(ca_certs=config["ca_file"] if trusted else None)
    return value

untrusted = client(False)
try:
    untrusted.connect(address.hostname, address.port or 8883)
except ssl.SSLCertVerificationError:
    pass
else:
    raise AssertionError("Broker accepted an untrusted TLS connection")

connection = client()
connected = threading.Event()
allowed = threading.Event()
denied = threading.Event()
stage = {"foreign": False}
def on_connect(c, userdata, flags, reason, properties):
    assert not reason.is_failure
    connected.set()
def on_subscribe(c, userdata, mid, reasons, properties):
    if stage["foreign"]:
        if any(reason.is_failure for reason in reasons): denied.set()
    elif all(not reason.is_failure for reason in reasons): allowed.set()
def on_disconnect(c, userdata, flags, reason, properties):
    if stage["foreign"]: denied.set()
connection.on_connect = on_connect
connection.on_subscribe = on_subscribe
connection.on_disconnect = on_disconnect
connection.connect(address.hostname, address.port or 8883)
connection.loop_start()
assert connected.wait(5), "Scoped credentials failed"
connection.subscribe(f'spBv1.0/{config["group_id"]}/DCMD/{config["edge_node_id"]}/+', qos=0)
assert allowed.wait(5), "The scoped command subscription was denied"
stage["foreign"] = True
connection.subscribe("spBv1.0/another-organization/#", qos=0)
assert denied.wait(5), "The broker granted access outside the organization namespace"
connection.disconnect()
connection.loop_stop()
print("PASS trusted TLS, rejected untrusted certificate, scoped subscription, and forbidden cross-namespace subscription")
