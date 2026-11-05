# RT1050 gateway bench

The hardware check for the NXP i.MX RT1050 firmware starter (spec
[026](../../specs/026-embedded-gateway-sdk/spec.md) quickstart 8, task T089; spec
[027](../../specs/027-firmware-starter-kits/spec.md) research R11). A gateway on a
MIMXRT1050-EVKB joins the network over Ethernet and polls Modbus RTU devices over
RS-485. The bench checks on hardware what CI cannot: the clock syncs, TLS verifies the
broker, the births arrive, and after the Ethernet cable is unplugged and plugged back in
every device is announced again within five minutes (SC-004). It also records the
firmware's RAM and flash use and the time from kit download to the first readings
(SC-001).

The board port is called supported only after this bench passes, and the modem template
only after the [phase-2 modem](#phase-2-modem) check.

## Parts

| Part | Notes |
| --- | --- |
| MIMXRT1050-EVKB | The B revision: the project is for its HyperFlash and 32 MB SDRAM |
| Arduino click shield with an RS-485 click | A 3.3 V RS-485 click in one of the shield's two mikroBUS sockets |
| USB-RS485 adapter | The PC's end of the bus, for the Modbus simulator |
| Modbus RTU sensor (optional) | A real device on the bus beside the simulator, at an address the simulator leaves free |
| Ethernet cable | To a network with DHCP and internet access: the board needs the broker and `pool.ntp.org` |
| USB cable | To the board's OpenSDA debug port (J28), for flashing and the console |
| A computer | The MCUXpresso SDK 26.09.00 and the Arm GNU Toolchain 14.2.rel1 (the starter's README fetches both), CMake 3.30 or later, Ninja, NXP LinkServer, and Python for the simulator |

## Wiring

| From | To | Notes |
| --- | --- | --- |
| Click shield | The EVKB's Arduino headers | The shield gives both mikroBUS sockets the Arduino UART, D0 and D1: J22-1 (RX, `GPIO_AD_B1_07`) and J22-2 (TX, `GPIO_AD_B1_06`), which is LPUART3 |
| RS-485 click DE and RE | J23-4 (`GPIO_AD_B1_05`, LPUART3 RTS) | The UART drives the direction pin while it sends. Find which mikroBUS pin the click uses for DE and RE in its schematic, and where the shield routes it; join that to J23-4 with a jumper wire if it lands elsewhere. A click with automatic direction control needs nothing here |
| Click A and B | The adapter's A (D+) and B (D-), and the sensor's | Swap A and B if nothing answers |
| Board GND | The adapter's GND | One common ground |
| Ethernet cable | The board's Ethernet jack | |

Leave the camera connector (J35) empty: the three UART pads are shared with it. Keep the
bus short on the bench; a 120 Ω terminator is only needed on long runs. Leave SW7 at the
HyperFlash boot setting (1 off, 2 on, 3 on, 4 off).

**One UART:** the shield routes the same Arduino UART to both sockets, so only one UART
click works at a time. The RS-485 click and a cellular modem click cannot share it.

## Modbus simulator

[`tooling/hardware/modbus_simulator.py`](../../tooling/hardware/modbus_simulator.py)
answers every address from `--first` to `--last` on the adapter's serial port, at 9600
baud, 8 data bits, no parity, one stop bit, with the register map the board example
polls (`app/modbus_rtu.h`):

| Holding register | Holds |
| --- | --- |
| 0 | Status, 1 when healthy |
| 1 | Reading, high word: a 32-bit counter that grows by the address every second |
| 2 | Reading, low word |
| 3 | Temperature in tenths of a degree Celsius: 20.0 plus a tenth per address |

```sh
python3 -m venv .local/hardware-venv
.local/hardware-venv/bin/pip install -r tooling/hardware/requirements.txt
.local/hardware-venv/bin/python tooling/hardware/modbus_simulator.py --port /dev/ttyUSB0 --baud 9600
```

On macOS the adapter is a `/dev/cu.usbserial-*` port. With a real sensor on the bus,
leave its address out, for example `--first 2` for a sensor at address 1. The example
polls addresses 1 to 247 in turn; each address that does not answer costs about 100 ms,
so a pass over a mostly empty bus takes about half a minute. On a real bus, narrow
`APP_MODBUS_FIRST_ADDRESS` and `APP_MODBUS_LAST_ADDRESS` in `app/modbus_rtu.h`.

## Before a run

1. In the platform, create and publish a device profile whose metrics match the
   register map: for example a reading (Int64 or Double) and a temperature (Double, °C),
   neither writable.
2. Onboard a gateway, and add the devices behind it from that profile (bulk onboarding
   adds up to 247 at once).
3. Rebuild the local `api` container with the stack's env files and overlays (the
   AGENTS.md command), because the image bundles `firmware/`.
4. Start the simulator, and open a serial terminal on the board's OpenSDA port at
   115200 baud.

## Protocol

1. **Start the clock** when the gateway's **Firmware** tab is opened.
2. Choose **NXP i.MX RT1050 (MCUXpresso SDK)** and download the full kit. Check its
   layout: `CMakeLists.txt`, `prj.conf`, `lwipopts.h` and `board/` at the root, the
   developer's code in `app/`, `app/modbus_rtu.c` present, and no vendor SDK.
3. Fetch the SDK as the README's Build section shows, then write `app/field.c`: each
   device's metrics come from `modbus_rtu_register(address, index, &value)`, and a
   device whose registers are stale is `FIELD_OFFLINE`. The README's prompt lets a coding
   agent write it with you.
4. Build and flash:
   `cmake -S . -B build -G Ninja && cmake --build build`, then
   `LinkServer flash MIMXRT1052xxxxB:EVKB-IMXRT1050 load build/iotos_app.elf`. Reset the
   board.
5. The console shows the Ethernet link and address, the Modbus polling, `event:
   connected` (the clock synced and TLS verified the broker) and the births.
6. **Stop the clock** at the first stored reading that matches the simulator, on a
   device's page in the platform.
7. **Reconnect**: unplug the Ethernet cable. The gateway and its devices go offline.
   Plug it back in: every device is announced again within five minutes (SC-004).
8. Note the memory regions the build printed.

The example keeps `bdSeq` in RAM, so it starts again after a reset. A product adds a
storage port over the board's flash (`storage-template.c`) to keep it.

## Run checklist

Record for each run, in the PR:

- the date, the starter's SDK version (from `iotos-starter.json`), and the MCUXpresso SDK
  and toolchain versions;
- the flash (`m_text`) and RAM (`m_data`, `m_heap`) use the build printed;
- the minutes from step 1 to step 6;
- the minutes from plugging the cable back in to the last device's birth (5 at most to
  pass);
- any console message that names an error.

## Phase-2 modem

The SDK's `ports/templates/modem-at-mqtt-template.c` is an MQTT port (level 2) annotated
for the Quectel BG95 command family. It is marked untested until a BG95 on this bench
connects, publishes and receives a command with binary payloads intact. Because of the
shield's single UART, that check either replaces the RS-485 click with the modem click or
wires the modem by hand to another LPUART. A modem that cannot send and receive payloads
by length uses its transparent TLS socket and the stream port (level 1) instead.

## Results

| Date | Flash | RAM | Minutes to first reading | Re-announced within 5 minutes | Result |
| --- | --- | --- | --- | --- | --- |
| Not yet run | | | | | |
