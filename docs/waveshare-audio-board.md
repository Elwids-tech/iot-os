# Waveshare RGB and audio alarm

This local test uses the **Waveshare ESP32-S3-AUDIO-Board**, connected by USB to
the Mac running the platform. The existing **RGB LED · Controls demo** device
keeps its identity, RGB parameter UUIDs, and history. Its profile receives four
additional audio parameters and a new published revision. A separate
**Waveshare RGB and audio alarm** dashboard contains all eight controls.

The path is portal → audited device command → local TLS MQTT/Sparkplug gateway
→ USB → board. Board reports travel back through the same gateway. The Mac and
bridge must remain running; this firmware does not connect over Wi-Fi.

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

Both outputs boot off. An alarm automatically stops after its duration; repeated
`true` commands while it is active do not extend it. Stop then start to retrigger.
The BOOT button stops both outputs. Losing the gateway heartbeat for five seconds
also stops both, including on broker loss or Mac sleep. Reconnection never restores
an old on-state. Changing color or mode does not turn power on.

The firmware reports applied driver state, not an optical or acoustic measurement.
Confirm visible colors and audible sound at the physical board.

## Hardware and firmware

Pins follow the [manufacturer documentation](https://www.waveshare.com/wiki/ESP32-S3-AUDIO-Board)
and [board demo](https://files.waveshare.com/wiki/ESP32-S3-AUDIO-Board/ESP32-S3-AUDIO-Board-Demo.zip):
RGB GPIO38 (seven WS2812 LEDs, RGB wire order); I²C SDA11/SCL10; I²S MCLK12/BCLK13/WS14/DOUT16;
ES8311 codec; TCA9555 address 0x20, EXIO8 amplifier enable. No SD card is required:
the three alarm patterns are synthesized on the board.

Build with ESP-IDF 5.4.1 (tested locally). Activate the installed IDF environment
first. `CODEC_I2C_BACKWARD_COMPATIBLE=n` is required because the board uses the new
I²C driver. Component versions and their lock file are included in the project.

```sh
rtk proxy idf.py -C firmware/waveshare-audio -B "$PWD/.local/devices/waveshare-build" build
rtk proxy idf.py -C firmware/waveshare-audio -B "$PWD/.local/devices/waveshare-build" -p /dev/cu.usbmodem83201 flash
```

Confirm the serial port against the attached ESP32-S3 before flashing. The initial
16 MiB flash backup and its SHA-256 are private files under
`.local/devices/waveshare-backup/`. The initial build for this workstation is under
`~/.local/devices/waveshare-build/`; the commands above use a repository-local build
directory for subsequent builds. Flashing replaces the board application.

## Run the USB gateway

The gateway reuses the dedicated RGB simulator's private broker configuration and
birth-sequence file. **Only one publisher may use this gateway identity.** Stop
the RGB simulator before starting this bridge; do not run the old RGB acceptance
script while the hardware gateway is active.

```sh
rtk proxy .local/devices/python/bin/pip install -r tooling/hardware/requirements.txt
rtk proxy .local/devices/python/bin/python tooling/hardware/waveshare_bridge.py \
  --config "$PWD/.local/devices/rgb-v2-simulator.json" \
  --state-file "$PWD/.local/devices/rgb-v2-state" \
  --port /dev/cu.usbmodem83201
```

The current background process records its PID in `.local/devices/waveshare-bridge.pid`
and logs in `.local/devices/waveshare-bridge.log`. Verify that PID still belongs to
`waveshare_bridge.py` before sending SIGTERM. Graceful shutdown turns both outputs
off; the board watchdog covers unexpected loss. No login credentials live in the
firmware. USB control is intended for a trusted local bench connection.

The gateway sends telemetry only from valid, fresh board reports. Missing, malformed,
replayed, or faulted reports cannot synthesize a successful command result. Disconnects
publish device death. Commands are never retried after uncertain delivery, and old
commands/reports are discarded after a long process suspension.

## Apply the profile and test

With the hardware bridge running:

```sh
rtk proxy node tooling/hardware/setup-waveshare.mjs
rtk proxy node tooling/hardware/setup-waveshare.mjs --test
```

The setup uses the seeded local super-admin (or `RGB_EMAIL`/`RGB_PASSWORD`), refuses
non-local URLs, and only targets `rgb-controls-demo` and `simulator-rgb-light-v2`.
It backs up their prior API representations, adds missing audio parameters, publishes
the profile, validates/applies the mapping, waits for runtime confirmation, and creates
the dashboard. It leaves existing RGB metadata unchanged. `--test` operates the real
lights and runs each alarm for two seconds at 15% volume, then leaves both outputs off.
Links and verification timestamps are in `.local/devices/waveshare-evidence.json`.

```sh
rtk proxy .local/devices/python/bin/python -m unittest discover -s tooling/hardware -p 'test_*.py'
rtk proxy php artisan test --compact --filter=DashboardTest
```

Run Laravel tests from `apps/api` if your environment relies on its working directory.
For direct firmware checks, stop the bridge and run
`rtk proxy .local/devices/python/bin/python tooling/hardware/verify-waveshare-usb.py --port /dev/cu.usbmodem83201`.
This tests atomic rejection, a silent timed alarm, and the heartbeat watchdog, leaving
both outputs off. Restart the bridge afterward.
An API correction allows writable enum parameters in dashboard controls while still
rejecting parameters without an applied command mapping. After changing that API code,
rebuild `api` using the currently active Devices and monitoring overlays before testing.

To return to simulation, stop the hardware bridge, start the original simulator using
the command saved in `.local/devices/waveshare-original-simulator-command.txt`, and
select the previous profile revision in the device Configuration tab. Review its four
RGB mappings against the fresh simulator birth certificate, then validate and activate.
The prior device/profile API snapshots are in `.local/devices/waveshare-before-setup.json`.
The added audio profile revision and dashboard can remain available for the next test.

## Verification on 2026-10-03

- ESP-IDF 5.4.1 build and flash passed; the original 16 MiB flash is backed up.
- All eight controls reported through the real API → MQTT → USB → board path.
- Solid/Blink/Strobe and Beep/Siren/Steady commands passed; every two-second alarm
  stopped through the board's own timer.
- Direct USB checks passed for atomic rejection of invalid commands, the alarm timer,
  and both outputs turning off after a missing gateway heartbeat.
- The user confirmed physical LED and speaker operation. The initial GRB ordering was
  corrected to the manufacturer's RGB ordering, and the user confirmed solid red.
- The API was rebuilt with the active Devices and monitoring overlays. The new
  dashboard rendered all eight controls, and its Power switch completed a real command.
- Five gateway tests and 24 dashboard API tests (373 assertions) passed.

The USB gateway remains a local bench adapter. Automatic startup on Mac reboot and
standalone Wi-Fi firmware are not part of this setup.

## Staging onboarding

The USB gateway can also connect to `mqtt.staging.elwids.xyz:8883` with the explicit
`--allow-staging` option. Other remote endpoints remain rejected. TLS certificate
and hostname verification stay enabled; use the Mac's trusted CA bundle in the
private gateway configuration. No MQTT credentials are written to the board.

Staging uses a separate physical device, profile, connection, and gateway. Do not
reuse a simulator identity or replace the local RGB device. The physical profile
is `physical-waveshare-audio`; its eight writable states retain the Waveshare
contract, including the LED-mode and alarm-mode enums. Controls panels accept
these enums only when they have an applied writable state mapping.

Run from the checkout containing the staging gateway update, replacing private
paths with the operator's actual files:

```sh
rtk proxy /path/to/python tooling/hardware/waveshare_bridge.py \
  --config /private/waveshare-staging/gateway.json \
  --state-file /private/waveshare-staging/sequence \
  --port /dev/cu.usbmodem83201 --allow-staging
```

The Mac must stay awake, connected to the board, and online. Stop the gateway with
Ctrl-C after a bench test: it turns both outputs off and publishes device death;
the firmware watchdog covers an unexpected disconnect. Device configuration,
dashboard, and recorded hardware state remain in staging for the next session.
The physical dashboard is labeled separately from the GPS, energy, and RGB
simulations. Driver-reported command completion does not measure visible light or
audible sound; confirm those at the board during the walkthrough.

## GPS entry automation

The local demo `GPS enters boundary → Waveshare alarm` connects GPS Demo Tracker
latitude and longitude through **Correlate inputs** (`latest`) to a **Geofence**
node with condition `inside`, then **Device control** targeting the board's
`Alarm active = On (true)`. The geometry is a snapshot of GPS Demo Boundary
revision 7. The demo uses a 3-second beep at 20% volume, a 60-second command
cooldown, a 15-second command deadline, and a seven-day activation grant.
Renew the grant through activation when it expires.

The action runs when the known condition changes to true, including the first
known inside reading after activation. Staying inside does not repeat the alarm.
Leaving and entering again can trigger it after the cooldown. Missing/stale GPS
readings and uncertain positions near the boundary produce unknown, not entry.
The board's timer stops sound independently of later GPS updates.

To reuse a boundary, open the automation Geofence settings and choose **Import
existing geofence**. This copies the saved geometry only; assignments and the
legacy outside-duration policy are not imported. Later map changes require
another import and workflow activation. Alternatively use **Copy geometry JSON**
in the geofence editor (includes unsaved map edits) or automation node, then paste
into **Geometry JSON**. Polygon geometry, a GeoJSON Feature, and a configuration
with a `geometry` member are accepted. Open rings, holes, malformed coordinates,
and invalid polygons are rejected; normal workflow validation still runs before
save/activation.
