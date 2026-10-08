#!/usr/bin/env python3
"""Create a private ESP-IDF Wi-Fi header from saved Wi-Fi and gateway JSON files."""
import argparse
import json
import os
from pathlib import Path
from urllib.parse import urlparse


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wifi", required=True, type=Path)
    parser.add_argument("--gateway", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--previous-sequence", type=Path)
    args = parser.parse_args()
    wifi, gateway = json.loads(args.wifi.read_text()), json.loads(args.gateway.read_text())
    if not isinstance(wifi.get("ssid"), str) or not 1 <= len(wifi["ssid"].encode()) <= 32:
        raise ValueError("SSID must contain 1 to 32 UTF-8 bytes")
    if not isinstance(wifi.get("password"), str) or not 8 <= len(wifi["password"].encode()) <= 63:
        raise ValueError("WPA2 password must contain 8 to 63 bytes")
    url = urlparse(gateway["broker_url"])
    if url.scheme not in ("ssl", "mqtts") or not url.hostname or url.username or url.password:
        raise ValueError("Gateway must use verified TLS with separately supplied credentials")
    values = {
        "WAVE_WIFI_SSID": wifi["ssid"], "WAVE_WIFI_PASSWORD": wifi["password"],
        "WAVE_MQTT_URI": gateway["broker_url"].replace("ssl:", "mqtts:", 1),
        "WAVE_MQTT_USERNAME": gateway["username"], "WAVE_MQTT_PASSWORD": gateway["password"],
        "WAVE_SP_GROUP": gateway["group_id"], "WAVE_SP_NODE": gateway["edge_node_id"],
        "WAVE_SP_HOST": gateway["host_id"],
    }
    for key, value in values.items():
        if not isinstance(value, str) or not value or "\x00" in value:
            raise ValueError(f"Invalid configuration field: {key}")
    # MQTT topic identifiers must not change the topic shape or become wildcards.
    for key in ("WAVE_SP_GROUP", "WAVE_SP_NODE", "WAVE_SP_HOST"):
        if any(char in values[key] for char in "/+#") or len(values[key].encode()) > 90:
            raise ValueError(f"Invalid MQTT topic identifier: {key}")
    if len((f"spBv1.0/{values['WAVE_SP_GROUP']}/DBIRTH/{values['WAVE_SP_NODE']}/rgb-light").encode()) >= 256:
        raise ValueError("Sparkplug topic exceeds firmware capacity")
    previous = int(args.previous_sequence.read_text()) if args.previous_sequence else 0
    if not 0 <= previous <= 255:
        raise ValueError("Previous Sparkplug bdSeq must be between 0 and 255")
    content = "#pragma once\n" + "".join(f"#define {key} {json.dumps(value)}\n" for key, value in values.items())
    content += f"#define WAVE_BDSEQ_INITIAL {previous}\n"
    args.output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if args.output.is_symlink():
        raise ValueError("Refusing to write credentials through a symbolic link")
    fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as stream:
        os.fchmod(stream.fileno(), 0o600)
        stream.write(content)
    print("Private Wi-Fi firmware configuration prepared; credential values are not logged.")


if __name__ == "__main__":
    main()
