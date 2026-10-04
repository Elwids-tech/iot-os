#!/usr/bin/env python3
"""Opt-in physical USB checks. Stop the MQTT bridge before running this test."""
import argparse
import json
import time
from uuid import uuid4

import serial

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--port", required=True)
args = parser.parse_args()

with serial.Serial(args.port, 115200, timeout=0.1, write_timeout=1, exclusive=True) as usb:
    usb.reset_input_buffer()
    last_ping = 0

    def write(value):
        usb.write((json.dumps(value) + "\n").encode())

    def wait_for(predicate, timeout=4, heartbeat=True):
        global last_ping
        deadline = time.monotonic() + timeout
        recent = []
        while time.monotonic() < deadline:
            if heartbeat and time.monotonic() - last_ping > 0.5:
                write({"ping": True})
                last_ping = time.monotonic()
            try:
                state = json.loads(usb.readline())
            except (ValueError, UnicodeDecodeError):
                continue
            recent = (recent + [state])[-3:]
            if state.get("protocol") == "waveshare-audio.v1" and state.get("hardware_ok") is True and predicate(state):
                return state
        raise AssertionError(f"Hardware did not report the expected state: {recent}")

    def command(changes):
        identifier = str(uuid4())
        write({"id": identifier, "set": changes})
        return wait_for(lambda s: s.get("ack") == identifier and all(s["values"][k] == v for k, v in changes.items()))

    try:
        wait_for(lambda s: True)
        command({"power": False, "alarm_active": False})
        write({"id": "invalid-mixed-command", "set": {"power": True, "brightness": 101}})
        report = wait_for(lambda s: True)
        assert report["values"]["power"] is False and report.get("ack") != "invalid-mixed-command"
        print("PASS invalid mixed command leaves outputs unchanged")
        command({"color": "#FF0000", "brightness": 40, "mode": "solid", "power": True})
        print("PASS firmware reports solid red at 40% brightness")
        command({"volume": 0, "alarm_duration": 2, "alarm_active": True})
        wait_for(lambda s: s["values"]["alarm_active"] is False)
        print("PASS silent alarm stops at its two-second deadline")
        command({"power": True, "alarm_duration": 60, "alarm_active": True})
        wait_for(lambda s: not s["values"]["power"] and not s["values"]["alarm_active"], timeout=8, heartbeat=False)
        print("PASS missing heartbeat stops both light and alarm within eight seconds")
    finally:
        command({"power": False, "alarm_active": False, "volume": 15, "alarm_duration": 5})
        print("Outputs off; volume and alarm duration restored")
