# ESP32 starter bench

The hardware check for the ESP32 firmware starter (spec
[027](../../specs/027-firmware-starter-kits/spec.md), research R17, quickstart 7). A
firmware developer with an ESP32, an RS-485 transceiver and a Modbus sensor downloads a
starter, lets an AI coding agent interview them and write the field code, and has
readings stored within an hour (SC-001). It runs once with Claude Code and once with
Codex (SC-007). It also checks on hardware what CI cannot: that `bdSeq` survives a reboot
and that the ESP32 sends the same births as the desktop simulator (FR-013).

The ESP32 target is called supported only after both runs pass. Transcripts stay in the
private `.local/` area; this page records outcomes only.

## Parts

| Part | Notes |
| --- | --- |
| ESP32 development board | Any board ESP-IDF v5.4.1 supports; the starter builds for the original ESP32 unless `idf.py set-target` picks another chip |
| 3.3 V RS-485 transceiver module | A MAX3485 or SP3485 type. Modules with automatic direction control have no DE or RE pin |
| Modbus RTU temperature and humidity sensor | For example an XY-MD02, with its datasheet at hand |
| Power for the sensor | Usually 5 to 30 V DC; check the datasheet |
| USB cable, jumper wires | A data cable for flashing and the serial monitor |
| A computer | ESP-IDF v5.4.1, the coding agent, and a browser signed in to the platform |
| A 2.4 GHz Wi-Fi network | The starter joins it; the board needs no other network |

## Wiring

| From | To | Notes |
| --- | --- | --- |
| ESP32 3V3 | Transceiver VCC | Not 5 V: the ESP32's pins are not 5 V tolerant |
| ESP32 GND | Transceiver GND and the sensor supply's ground | One common ground |
| ESP32 UART TX (for example GPIO17) | Transceiver DI (or TXD) | |
| ESP32 UART RX (for example GPIO16) | Transceiver RO (or RXD) | |
| ESP32 GPIO (for example GPIO4) | Transceiver DE and RE, tied together | Only for modules without automatic direction control |
| Transceiver A | Sensor A+ (485+) | |
| Transceiver B | Sensor B- (485-) | Swap A and B if the sensor never answers |
| Sensor supply + | Sensor VCC | |

Note the pins actually used: the person gives them to the agent during the interview.
Keep the bus short on the bench; a 120 Ω terminator is only needed on long runs.

## Before a run

1. In the platform, create and publish a device profile with two metrics that match the
   sensor: a temperature (Double, °C) and a relative humidity (Double, %), neither
   writable.
2. Onboard a direct device from that profile, so connection settings can be downloaded
   for it, and keep it ready but unopened.
3. Have the sensor's datasheet open. The person answers the agent's questions about the
   sensor from it, and from the wiring above, not from this page.
4. Start a new, empty folder for the run, and check that ESP-IDF works
   (`idf.py --version` reports v5.4.1).

## Timed protocol

The person running the bench uses only the platform's **Firmware** section, the
starter's own documents and the agent: no other help.

1. **Start the clock** when the profile's **Firmware** tab is opened.
2. Choose **ESP32 (ESP-IDF)**, **Connects directly**, and download the starter. Unpack it
   into the run's folder.
3. Open the folder in the agent and send the README's prompt: "Read AGENTS.md and follow
   it. Start with the interview."
4. Answer the agent's questions from the datasheet and the wiring. Say "I don't know"
   where that is true.
5. Read the device brief the agent writes (`main/device-brief.yaml`), and confirm it only
   when it is right.
6. Before flashing, download the device's connection settings from its page
   (**Firmware**, then **Download settings**) and unpack them into the starter yourself.
   Never show them to the agent.
7. Set the Wi-Fi network with `idf.py menuconfig`, under **IoT OS application**, then
   build, flash and monitor (`idf.py build flash monitor`), or let the agent do it.
8. **Stop the clock** at the first stored reading that matches the sensor's own display or
   a reference thermometer and hygrometer, on the device's page in the platform.
9. **Reboot**: start a capture for the device in **Tools → Telemetry viewer**, then press
   the board's reset button. The new session's NBIRTH must carry a `bdSeq` one higher
   than the session before (FR-013).
10. **Birth comparison**: power the board off. Build the desktop simulator inside the same
    starter, as its README's "Test without hardware" section shows, and run it with the
    same settings. Capture its NBIRTH in the telemetry viewer and compare it with the
    ESP32's: the same metric names, datatypes and aliases. The values differ, because the
    simulator makes them up. Stop the simulator before powering the board again: two
    clients with one device's credentials take over each other's session.

## Run checklist

Record for each run:

- the date, the starter's SDK version (from `iotos-starter.json`) and the agent and its
  version;
- the minutes from step 1 to step 8 (60 at most to pass);
- each question that asked for something already in `generated/profiles/` or
  `iotos-starter.json`, such as a metric's name, unit, datatype or whether it accepts
  commands (none to pass);
- whether any code was written before the brief was confirmed (none to pass);
- whether the agent opened, printed or copied anything in `config/` other than its
  README (none to pass);
- whether the brief validates against `.iotos/device-brief.schema.json`;
- for answers given as "I don't know", that their metric stays unpublished;
- the `bdSeq` before and after the reboot;
- the birth comparison, and any difference.

When a run fails, fix the starter's templates (`firmware/starters/templates`) or the
example, and run again.

## Results

| Date | Agent | Minutes | Known-fact questions | Code before brief | `config/` opened | `bdSeq` after reboot | Births match | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Not yet run | Claude Code | | | | | | | |
| Not yet run | Codex | | | | | | | |
