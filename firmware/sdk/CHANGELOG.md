# Changelog

The SDK has its own version (`VERSION`), recorded in every kit. Before 1.0, breaking
changes are listed here.

## Unreleased

### Added

- The core: Sparkplug B codec, edge-node session (bdSeq, sequence, will, host state,
  rebirth, back-off, session takeover detection), devices of shared types, paced births,
  writers with datatype and range checks, commands matched by name, and gateway health
  metrics. No heap and no writable static data.
- MQTT over a TLS byte stream with the vendored coreMQTT v2.3.1, and a level for modems
  that run MQTT themselves.
- Desktop ports (`ports/posix`): mbedTLS over sockets, clock, file storage, stderr log,
  pthread lock.
- Annotated templates for the stream, clock, storage, log and lock ports.
- The desktop gateway simulator (`examples/desktop-simulator`) with a 500-device
  self-test.
- Contract fixtures that the runtime replays (`contracts/sparkplug/fixtures/sdk`).
- Starter support (`starter/`): `iotos_starter.h`, `settings_missing.c` and
  `iotos_starter.cmake`, so a firmware starter builds before its connection settings are
  downloaded and stops with a message instead of connecting.
- A Linux and macOS example (`examples/linux-app`), the project of the Linux starter.
- ESP-IDF ports (`ports/esp-idf`, ESP-IDF v5.4): esp-tls with the kit's CA and the broker
  host checked, SNTP for UTC and esp_timer for intervals, NVS for `bdSeq`, and ESP_LOG.
  `ports/esp-idf/component.cmake` builds the SDK as an ESP-IDF component.
- A FreeRTOS lock and log (`ports/freertos`): a statically created, non-recursive mutex,
  and a log through `IOTOS_FREERTOS_PRINTF` (the MCUXpresso debug console by default).
- An ESP32 example (`examples/esp32-wifi`), the project of the ESP32 starter: Wi-Fi set
  with `idf.py menuconfig`, the same program as the Linux example.
- MCUXpresso SDK ports (`ports/mcuxpresso-lwip`, SDK 26.x): mbedTLS 3.6 over lwIP sockets
  with the kit's CA and the broker host checked, entropy from the TRNG, lwIP SNTP for UTC
  and the FreeRTOS tick for intervals. `iotos_mcux.cmake` adds them and the core to a
  project.
- An MIMXRT1050-EVKB example (`examples/rt1050-evkb-ethernet`), the project of the NXP
  starter: Ethernet with DHCP, and for a gateway a Modbus RTU poller on RS-485.
- A modem MQTT port template (`ports/templates/modem-at-mqtt-template.c`), annotated for
  the Quectel BG95 command family. Untested on a modem.

### Changed

- The node's device type moved from `iotos_settings.c` to `iotos_types.c`
  (`iotos_kit_node_type`); `iotos_kit_settings` leaves `node_type` NULL and programs set
  it on a copy. Settings declare `IOTOS_KIT_SETTINGS_FORMAT 1`, and examples refuse other
  formats. The desktop simulator reads a starter's `generated/` and `config/`.
- `cmake/iotos_sources.cmake` lists the core's sources once; the desktop library and the
  ESP-IDF component both build from it. `iotos_starter_sources` takes an optional
  `PUBLIC`, which hands the generated and settings include folders and
  `IOTOS_KIT_HAVE_SETTINGS` to whatever links the target.
