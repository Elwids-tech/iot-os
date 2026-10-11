# Waveshare RGB and audio alarm board

A **Waveshare ESP32-S3-AUDIO-Board** used as a real actuator: seven RGB LEDs and
a speaker, exposed to the platform as one Sparkplug B device with eight writable
states. It is the hardware counterpart of the RGB light simulator
([simulators](../dev/simulators-and-fixtures.md#rgb-light-v2)).

Two ways to connect it:

- **USB bench gateway.** The board is plugged into a computer that runs
  [`tooling/hardware/waveshare_bridge.py`](../../tooling/hardware/waveshare_bridge.py).
  The bridge is the Sparkplug edge node; the board only talks USB serial.
- **Standalone Wi-Fi.** Optional firmware connects the board straight to the MQTT
  broker over verified TLS, with no computer in the path.

Firmware: [`firmware/waveshare-audio`](../../firmware/waveshare-audio). Wire codec:
[`main/sparkplug_wire.c`](../../firmware/waveshare-audio/main/sparkplug_wire.c).

## Controls

| Control | Values |
| --- | --- |
| Power | RGB LEDs on/off; independent of audio |
| Color | `#RRGGBB`, applied to all seven LEDs |
| Mode | `solid`, `blink` (500 ms on/off), `strobe` (100 ms on/900 ms off) |
| Brightness | 0–100% |
| Alarm active | Starts/stops audio |
| Alarm mode | `beep`, `siren`, `steady` |
| Volume | 0–100%; start at 15% |
| Alarm duration | 1–60 seconds; captured when an alarm starts |

Both outputs boot off. An alarm stops by itself after its duration; repeated
`true` commands while it is active do not extend it, so stop then start to
retrigger. The BOOT button stops both outputs. Losing the gateway heartbeat for
five seconds also stops both (broker loss, computer sleep). Reconnecting never
restores an old on-state. Changing color or mode does not turn power on.

The firmware reports applied driver state, not an optical or acoustic
measurement. A confirmed command means the driver changed state; confirm light
and sound at the board.

## Hardware and firmware

Pins follow the [manufacturer documentation](https://www.waveshare.com/wiki/ESP32-S3-AUDIO-Board)
and [board demo](https://files.waveshare.com/wiki/ESP32-S3-AUDIO-Board/ESP32-S3-AUDIO-Board-Demo.zip):
RGB GPIO38 (seven WS2812 LEDs, RGB wire order); I²C SDA11/SCL10; I²S
MCLK12/BCLK13/WS14/DOUT16; ES8311 codec; TCA9555 at 0x20, EXIO8 amplifier
enable. No SD card: the three alarm patterns are synthesized on the board.

Build with ESP-IDF 5.4.1. `CODEC_I2C_BACKWARD_COMPATIBLE=n` is required because
the board uses the new I²C driver. Component versions are pinned in
`dependencies.lock`. Keep build output out of the repository:

```sh
rtk proxy idf.py -C firmware/waveshare-audio -B "$PWD/.local/devices/waveshare-build" build
rtk proxy idf.py -C firmware/waveshare-audio -B "$PWD/.local/devices/waveshare-build" -p <port> flash
```

Before the first flash, confirm the serial port and MAC belong to the board, and
take a full 16 MiB flash backup with its SHA-256. Flashing replaces the board
application. Do not erase flash.

## USB bench gateway

The bridge reuses the RGB v2 simulator's private gateway configuration and
birth-sequence file, so the board takes over the `rgb-controls-demo` device.
**Only one publisher may use a gateway identity**: stop the RGB simulator first.

```sh
rtk proxy .local/devices/python/bin/pip install -r tooling/hardware/requirements.txt
rtk proxy .local/devices/python/bin/python tooling/hardware/waveshare_bridge.py \
  --config "$PWD/.local/devices/rgb-v2-simulator.json" \
  --state-file "$PWD/.local/devices/rgb-v2-state" \
  --port <port>
```

The bridge publishes telemetry only from valid, fresh board reports. Missing,
malformed, replayed or faulted reports never produce a successful command result.
Disconnects publish device death. Commands are never retried after uncertain
delivery, and stale commands and reports are dropped after a long suspension.
Graceful shutdown turns both outputs off; the board watchdog covers a crash. USB
control assumes a trusted bench connection.

### Apply the profile and test

With the bridge running against the local stack:

```sh
rtk proxy node tooling/hardware/setup-waveshare.mjs
rtk proxy node tooling/hardware/setup-waveshare.mjs --test
```

The script signs in as the seeded local super-admin (override with
`RGB_EMAIL`/`RGB_PASSWORD`), refuses non-local URLs and only touches
`rgb-controls-demo` and `simulator-rgb-light-v2`. It saves the previous API
representations to `.local/devices/waveshare-before-setup.json`, adds the four
audio parameters, publishes a new profile revision, applies the mapping, waits for
runtime confirmation and creates a "Waveshare RGB and audio alarm" dashboard.
`--test` drives the real lights and plays each alarm for two seconds at 15% volume.

Checks:

```sh
rtk proxy .local/devices/python/bin/python -m unittest discover -s tooling/hardware -p 'test_*.py'
rtk proxy .local/devices/python/bin/python tooling/hardware/test_waveshare_wire.py
```

For direct firmware checks, stop the bridge and run
`tooling/hardware/verify-waveshare-usb.py --port <port>`. It checks atomic
rejection of invalid commands, a silent timed alarm and the heartbeat watchdog,
and leaves both outputs off.

To go back to simulation: stop the bridge, start the RGB simulator again, select
the previous profile revision in the device's Configuration tab, review the four
RGB mappings against the fresh birth certificate, then validate and activate.

## Standalone Wi-Fi

The Wi-Fi firmware connects to the platform broker with verified TLS, keeps the
same group, edge-node, host and `rgb-light` device identities, and publishes the
eight driver states. Stop any USB bridge that uses the same identity. Wi-Fi and
broker reconnects are automatic; each connection publishes fresh births and
advances the persistent `bdSeq`. Commands are rejected if retained, stale,
duplicated, malformed, or received while the Sparkplug host is offline. The alarm
duration limit, BOOT-button stop and connection-loss stop still apply.

The ESP32-S3 needs a 2.4 GHz WPA2 network. For an iPhone hotspot, enable **Allow
Others to Join** and **Maximize Compatibility**, keep the hotspot screen open
during the first join, and match the SSID exactly (including apostrophe style).

Put `{"ssid":"…","password":"…"}` in a private Wi-Fi JSON file and use the
gateway JSON exported for the device's scoped MQTT credentials. Neither file, nor
the built firmware (which embeds the credentials), belongs in Git.

```sh
rtk proxy python3 tooling/hardware/prepare-waveshare-wifi.py \
  --wifi <private>/wifi.json \
  --gateway <private>/gateway.json \
  --previous-sequence <private>/sequence \
  --output <private>/wave_credentials.h

rtk proxy env WAVE_CONFIG_DIR="<private>" \
  idf.py -C firmware/waveshare-audio -B "<private>/build" \
  -DSDKCONFIG="<private>/sdkconfig" build
```

Replace `build` with `flash -p <port>` to flash. The custom partition table
reserves a 4 MiB application partition for Wi-Fi, TLS and Sparkplug and keeps the
original NVS offset. For USB-only builds, omit `WAVE_CONFIG_DIR` and use a separate
build directory.

Serial reports expose `network` (`wifi_connecting`, `clock_sync`,
`mqtt_connecting`, `waiting_for_host`, `birth_pending`, `online`) and
`wifi_disconnect_reason`, never passwords. Reason 201 means the SSID was not
found. Done means a healthy board report, fresh telemetry in the platform and a
platform command reflected in the driver state, not a successful flash.

## Pilot broker

`waveshare_bridge.py --allow-staging` lets the USB bridge connect to the pilot
broker. The script only accepts the hostname `mqtt.staging.elwids.xyz` on port
8883 (constant `STAGING_BROKER`), which the pilot keeps as a legacy name on the
broker certificate ([pilot](../ops/pilot.md#domains)). TLS certificate and
hostname checks stay on.

The pilot uses its own physical device, connection, gateway and the
`physical-waveshare-audio` profile; never reuse a simulator identity. Controls
panels accept the LED-mode and alarm-mode enums only when they have an applied
writable state mapping. Keep `IOT_OPS_EXPECTED_SIMULATORS=0` for on-demand bench
demos so the `TelemetryStalled` alert does not expect a continuous publisher.

## Demo automation: GPS enters boundary

A DAG automation can sound the alarm when a GPS tracker enters a fence: latitude
and longitude go through **Correlate inputs** (`latest`) into a **Geofence** node
(condition `inside`), then **Device control** sets `Alarm active = On`. It fires
when the known condition changes to true, including the first known inside
reading after activation. Staying inside does not repeat it; leaving and
re-entering can trigger it again after the command cooldown. Missing or stale GPS
and positions inside the uncertainty band are unknown, not an entry. See
[automation](../features/automation.md).

To reuse a saved geofence in a DAG, open the Geofence node settings and choose
**Import existing geofence**. This copies the geometry only (not assignments or
the outside-duration policy); later boundary edits need another import and
activation. **Copy geometry JSON** in the geofence editor or a node, pasted into
**Geometry JSON**, also works.
