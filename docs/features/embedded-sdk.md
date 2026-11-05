# Embedded SDK

A portable C99 library that gateway and device firmware compile in to talk to the
platform over Sparkplug B on MQTT and TLS. It owns the Sparkplug edge-node session for a
gateway and hundreds of devices behind it; the integrator keeps the hardware behind small
ports. The decision is [ADR-029](../adr/ADR-029-embedded-sdk-and-gateway-kits.md), the
spec [026](../../specs/026-embedded-gateway-sdk/spec.md), and the API contract
[sdk-c-api](../../specs/026-embedded-gateway-sdk/contracts/sdk-c-api.md).

Code: [`firmware/sdk`](../../firmware/sdk/README.md), under the MIT
[licence](../../firmware/sdk/LICENSE) for that folder only. Developers get it as a
[firmware starter](#firmware-starters) for their profile and microcontroller (spec
[027](../../specs/027-firmware-starter-kits/spec.md),
[ADR-030](../adr/ADR-030-firmware-starters.md)). Linux, the ESP32 and the NXP i.MX
RT1050 are built targets.

## Architecture

```text
integrator code ──▶ iotos.h: devices, writers, callbacks
                      │
                      ├─ session: bdSeq, seq, will, host STATE, births, rebirth, back-off
                      ├─ codec: streaming Sparkplug writer and reader, no heap
                      └─ MQTT: coreMQTT over the stream port, or the modem's own MQTT
                             │
ports (integrator) ──▶ stream or mqtt, clock, storage, log, lock
```

- All state lives in one caller-allocated `iotos_gateway`, including the MQTT client's
  context; the receive buffer is also coreMQTT's buffer. The library has no other
  writable static data and never uses the heap, which the arm size check enforces.
  With 512 devices the structure is about 19.8 KB on a Cortex-M7.
- Device types are `const` tables in flash, generated from published device profiles.
  The SDK keeps no metric values: births ask `on_birth` for the current ones, and
  metrics it does not get are sent as nulls.
- The codec writes payload fields in field-number order, as the reference encoders do,
  so it reproduces the runtime's Python fixtures byte for byte.

## Ports and templates

| Port | Required | Notes |
| --- | --- | --- |
| `iotos_stream_port` | one level | A verified TLS byte stream; the SDK runs MQTT 3.1.1 over it with the vendored coreMQTT |
| `iotos_mqtt_port` | one level | For modems that run TLS and MQTT themselves; they hand received messages to `iotos_mqtt_inbound` from their poll |
| `iotos_clock_port` | yes | `now_ms` (UTC, with a valid flag) and `monotonic_ms` (intervals; context-free because coreMQTT calls it directly) |
| `iotos_storage_port` | no | Keeps `bdSeq` across reboots |
| `iotos_log_port` | no | Short sentences |
| `iotos_lock_port` | several tasks | A plain mutex |

`firmware/sdk/ports/templates/` has an annotated template for each port that compiles as
shipped (a CTest keeps them in step with the headers), `ports/posix/` a working desktop
set, `ports/esp-idf/` an ESP-IDF v5.4 set, `ports/freertos/` a lock and a log for any
FreeRTOS build, and `ports/mcuxpresso-lwip/` an MCUXpresso SDK set (below). Port
structures only ever gain members at the end and treat `NULL` as unsupported, so ports
written with designated initialisers keep compiling. That is how
store-and-forward will extend `iotos_storage_port`: new optional calls at the end, used
only when set.

### ESP-IDF and FreeRTOS

`ports/esp-idf/` (`iotos_esp_idf.h`, `iotos_esp_idf_ports_init`) fills every port:

- **stream**: esp-tls with the kit's CA, the broker host as SNI and as the name the
  certificate must carry, within `IOTOS_CONNECT_TIMEOUT_MS`. esp-tls leaves that
  timeout on the socket as its read timeout, so the port sets 20 ms after the handshake;
  ESP-IDF's mbedTLS socket layer reports the expiry as "want read", which `recv` returns
  as 0.
- **clock**: UTC is valid once the SNTP server has answered in this boot (the RTC keeps
  counting through a restart, so a plausible time is not trusted). With no server, the
  application sets the time and UTC is valid once past 2024. `monotonic_ms` is
  `esp_timer_get_time() / 1000`.
- **storage**: one NVS blob per key in the namespace `iotos`; NVS replaces entries
  atomically.
- **log**: `ESP_LOG` with the tag `iotos`.
- **lock**: `ports/freertos/` (`iotos_freertos_lock_init`), a non-recursive mutex created
  with `xSemaphoreCreateMutexStatic`. It builds with ESP-IDF's FreeRTOS and with the
  plain kernel, which the NXP port shares. The same folder has a log
  (`iotos_freertos_log_init`) that prints through `IOTOS_FREERTOS_PRINTF`, by default the
  MCUXpresso debug console's `PRINTF`; the CI cross-compile builds both against
  FreeRTOS-Kernel V11.3.1 for a Cortex-M7 (`tests/freertos-config/`).

`ports/esp-idf/component.cmake` registers the SDK as an ESP-IDF component from the same
source list as the desktop library ([`cmake/iotos_sources.cmake`](../../firmware/sdk/cmake/iotos_sources.cmake)),
so the ESP32 runs the code the tests ran (FR-013). A project must not also add the ESP
Component Registry's coreMQTT, whose symbols clash, and does not use ESP-IDF's MQTT
client.

### MCUXpresso SDK, lwIP and FreeRTOS

`ports/mcuxpresso-lwip/` (`iotos_mcux.h`, `iotos_mcux_ports_init`) fills every port
but storage, for the MCUXpresso SDK 26.x with FreeRTOS and lwIP sockets:

- **stream**: mbedTLS 3.6 over lwIP sockets, with the kit's CA, the broker host as SNI
  and as the name the certificate must carry, within `IOTOS_CONNECT_TIMEOUT_MS`. The
  socket then gets a 20 ms receive timeout, which `recv` reports as 0. Certificate dates
  are checked once the clock is valid; before the first SNTP answer only the chain and the
  host name are. Entropy comes from the TRNG through `mbedtls_hardware_poll`
  (`MBEDTLS_ENTROPY_HARDWARE_ALT`), and mbedTLS allocates from the FreeRTOS heap.
  `iotos_mbedtls_config.h` is a TLS 1.2 client configuration without PSA, which the build
  selects with `MBEDTLS_CONFIG_FILE`.
- **clock**: UTC is valid once lwIP SNTP has answered in this boot, through the project's
  `lwipopts.h` (`SNTP_SET_SYSTEM_TIME_US` calls `iotos_mcux_sntp_set`); an application
  with GPS or a real-time clock calls it instead. `monotonic_ms` is the FreeRTOS tick, so
  `configTICK_RATE_HZ` must be 1000 (an `#error` checks it).
- **log** and **lock**: `ports/freertos/`.
- **storage**: none, so `bdSeq` restarts after a reset. A product adds one over its flash.

`iotos_mcux.cmake` adds the core from `cmake/iotos_sources.cmake` and these ports to the
project's target (FR-013). A project must leave the MCUXpresso coreMQTT middleware
unselected.

**The board example**, [`examples/rt1050-evkb-ethernet`](../../firmware/sdk/examples/rt1050-evkb-ethernet),
is a freestanding MCUXpresso SDK 26.09.00 project for the MIMXRT1050-EVKB over Ethernet:
`CMakeLists.txt` and `prj.conf` (the SDK's CMake and Kconfig build), the project's own
`lwipopts.h`, and `board/` with NXP's pin, clock and PHY files from its `lwip_mqtt`
example plus `rs485_pins.c`. It builds as `flexspi_nor_sdram_debug`: code runs from the
HyperFlash and data from the 32 MB SDRAM, because the 128 KB DTCM is too small for a
gateway with TLS. With the sample tables it uses 405 KB of flash, 92 KB of data and a
256 KB heap. `app/main.c` joins the network with DHCP, starts SNTP and then the SDK
task; a gateway also runs `app/modbus_rtu.c`, a Modbus RTU poller on LPUART3 (RS-485,
the UART driving DE/RE through RTS) over addresses 1 to 247, with the parts to change
marked `TODO(integrator)`. The [RT1050 gateway bench](../hardware/rt1050-evkb.md) is its
hardware check, with [`tooling/hardware/modbus_simulator.py`](../../tooling/hardware/modbus_simulator.py)
standing in for the bus. It is called supported once that bench passes.

**The modem template**, `ports/templates/modem-at-mqtt-template.c`, is an MQTT port
(level 2) annotated for the Quectel BG95 command family: the will, open, connect,
publish by length, subscribe and the received-message URC, with the clock from the
network. It is untested until the phase-2 bench modem passes, and names the fallback for
modems that cannot carry binary payloads by length: their transparent TLS socket and the
stream port.

## Limits

Compile-time, overridable: 512 devices, 8 device types, 64 metrics per type, 24-character
device IDs, a 4 KiB transmit buffer (the largest birth), a 1 KiB receive buffer, 192-byte
topics, 128-character string commands, 20 births per second, a 20 s keepalive, health
every 60 s, a 300 s clock wait and a 10 s connect timeout (TCP, TLS and CONNACK
together).

64-bit integers are limited to ±2^53, the range the platform keeps exactly: larger
values are refused by the writer, as the runtime would refuse them with a diagnostic.

## Wire rules

- Topics are `spBv1.0/<group>/{NBIRTH,NDATA,NDEATH,NCMD}/<edge>` and
  `…/{DBIRTH,DDATA,DDEATH,DCMD}/<edge>/<device>`. The SDK subscribes to exactly
  `…/NCMD/<edge>`, `…/DCMD/<edge>/+` and `spBv1.0/STATE/<host>`, the filters the broker
  grants.
- The client ID and username are the kit's username. MQTT 3.1.1, clean session. The will
  is the NDEATH with the current `bdSeq`, at QoS 1 and not retained. `bdSeq` goes up by
  one (modulo 256) before every connection and is saved first.
- Births wait for the host's retained STATE `{"online":true}`. A second online STATE, or
  an NCMD `Node Control/Rebirth`, sends the NBIRTH (seq 0) and every DBIRTH again,
  paced at `IOTOS_BIRTHS_PER_SECOND`. Births also wait for a valid clock.
- One `seq` counter covers every message after the NBIRTH, wrapping at 255.
- Aliases are unique across the node: node metrics take `index + 1`, device metrics
  `((slot + 1) << 16) | index`. Births carry name, alias and datatype; data carries the
  alias only. `bdSeq` and `Node Control/Rebirth` go by name without an alias.
- A device that is not born refuses data (`IOTOS_PENDING_BIRTH`) instead of sending it,
  because the runtime answers data before a birth with a rebirth of the whole node.
- Commands are matched by metric name, checked against the device type (known device
  and metric, `writable`, the declared datatype, the value's range) and handed to
  `on_command`. Retained commands, and commands that arrive before this session's
  births, are refused. The platform confirms a command only when a later reading shows
  the new value, so the integrator publishes it from `on_command`.
- A birth the transmit buffer or the port refuses is reported once (`on_event`
  `IOTOS_EVENT_BIRTH_FAILED`, with the device type in the log); that device stays
  offline until its next commit, and the other births carry on.
- Connection failures back off from 1 s, doubling to 300 s with ±20% jitter. Bad
  credentials are reported apart from network failures. Three connections the broker
  closes within 10 s, inside five minutes, are reported as a session takeover.

## Threading

- One task calls `iotos_poll`; every callback runs on it.
- `iotos_begin`…`iotos_commit` and the device calls may come from any task and take the
  lock port, which need not be recursive.
- `iotos_poll` releases the lock before calling `on_command` and `on_event`, so they may
  publish, add devices, mark them offline or call `iotos_stop` (a reboot command). Publishing the new state from `on_command`
  is the intended way to confirm a command.
- `on_birth` runs with the lock held while its birth is written, and may only call
  `iotos_put_*` and `iotos_put_at` on the writer it is given. Anything else deadlocks on
  a plain mutex, which is why the SDK asks for a non-recursive one: the mistake shows up
  at once.

## Gateway health

When the node's type has them, the SDK fills `uptime`, `sdk_version`,
`devices_configured`, `devices_online` and `reconnects` itself, and `connection_type`,
`signal_strength` and `firmware_version` from `iotos_set_connection` and
`iotos_set_firmware_version`. They go in every NBIRTH; the changing ones also go as
NDATA every `IOTOS_HEALTH_INTERVAL_S`. `signal_strength` is a null when the network
reports none.

On the platform these metrics are the gateway's own source. The organization's
**gateway health profile** (`POST device-profiles/gateway-health`) has the same eight keys,
so a gateway kit built with it as the node type announces exactly them, and the gateway
itself is onboarded as a device with it ([devices](devices.md#the-gateway-itself)). A
feature test compares the profile's keys with `iotos_health.h`.

## Building and testing

```bash
cmake -S firmware/sdk -B .local/sdk-build -DIOTOS_SANITIZE=ON && cmake --build .local/sdk-build
ctest --test-dir .local/sdk-build --output-on-failure
cmake -S firmware/sdk -B .local/sdk-arm -DCMAKE_TOOLCHAIN_FILE="$PWD/firmware/sdk/cmake/arm-none-eabi.cmake"
cmake --build .local/sdk-arm --target iotos_size
```

- Unit tests (Unity) run on test doubles for every port, including a scripted MQTT broker
  behind the stream port, so the real coreMQTT client is exercised. They cover the
  session, devices, writers, commands, both port levels (which must send identical
  bytes), the templates and a 500-device simulator self-test.
- `iotos_size` cross-compiles with `arm-none-eabi-gcc` for the Cortex-M7 and fails on a
  gateway structure over 32 KiB, any `.data` or `.bss`, or a heap reference.
- Contract fixtures: `tools/fixtures.c` drives a real session and writes
  `contracts/sparkplug/fixtures/sdk/`, which the runtime replays (`TestSDKFixtures`);
  the runtime writes `commands/` with its own encoder (`TestSDKCommandFixtures -update`)
  and the SDK decodes them. A CTest regenerates the SDK's files and compares.
- CI runs the `Embedded SDK` job with gcc and clang under AddressSanitizer and UBSan,
  and the cross-compile.

## Desktop simulator

`firmware/sdk/examples/desktop-simulator` runs the same SDK code with the POSIX ports,
publishing many simulated devices:

```bash
cmake -S firmware/sdk/examples/desktop-simulator -B .local/sim && cmake --build .local/sim
.local/sim/gateway-sim --devices water_meter=500 --interval 10 --state-file .local/sim/state
```

Built from the repository it uses `sample-config/` (placeholder broker and credentials);
built inside a starter (`sdk/examples/desktop-simulator`) it uses the starter's
`generated/` and `config/`, and without settings it says where to get them and exits
with status 2. A direct-device starter simulates the node's own metrics and refuses
`--devices`. The birth rate is the compile-time `IOTOS_BIRTHS_PER_SECOND`.

## Firmware starters

A starter is a credential-free project for one target and one role, generated from
published profile revisions by the API's `Firmware` domain
([`app/Domain/Firmware`](../../apps/api/app/Domain/Firmware)). Signed-in members with
`DeviceProfile.view` download it from a profile's **Firmware** tab. The layout is the
[starter layout contract](../../specs/027-firmware-starter-kits/contracts/starter-layout.md):

| Path | Holds | On update |
| --- | --- | --- |
| `sdk/` | The SDK without tests, tools or other boards' examples, plus `starter/` (`iotos_starter.h`, `settings_missing.c`, `iotos_starter.cmake`) | replaced |
| `generated/` | `iotos_type_<id>.h` per type, `iotos_types.h` and `.c` (`iotos_kit_types[]`, `iotos_kit_node_type`, `IOTOS_KIT_ROLE_GATEWAY`), `profiles/<code>.json` | replaced |
| `.iotos/` | The device brief schema, the porting guide, family notes, and for AI-assisted targets `reference/main.c` | replaced |
| `AGENTS.md`, `CLAUDE.md` | The AI brief; `CLAUDE.md` is `@AGENTS.md` | replaced |
| `iotos-starter.json` | The manifest ([schema](../../contracts/firmware/v1/starter-manifest.schema.json)): SDK version, profiles and revisions, per-metric `introduced_in` and `changed_in`, `retired`, warnings | replaced |
| `app/` (or the target's developer path) | `main.c`, `field.c` and `field.h` (one stub per metric, all returning `FIELD_UNAVAILABLE` or `FIELD_REJECTED`), `device-brief.example.yaml` | kept |
| `config/` | `README.md` only, until the settings are unpacked here | kept |

**Targets** come from [`firmware/starters/targets.json`](../../firmware/starters/targets.json).
A built target (`esp32-esp-idf`, `nxp-imxrt1050-mcuxpresso` and `linux`) names its SDK
example, toolchain, build and run commands, and is listed only when the example exists.
It may add `build_notes`, a paragraph for the README's Build section, and
`gitignore_extra`, lines for the starter's `.gitignore`.
AI-assisted targets (`stm32`, `rpi-pico`, `nordic-nrf`, `other`) ship the port templates
in `app/ports/` and [family notes](../../firmware/starters/families). Templates live in
[`firmware/starters/templates`](../../firmware/starters/templates) with `{{name}}`
placeholders that only ever receive starter facts.

**The ESP32 starter** is an ESP-IDF v5.4.1 project from
[`examples/esp32-wifi`](../../firmware/sdk/examples/esp32-wifi), with `main/` as the
developer path:

- `components/iotos/CMakeLists.txt` finds `sdk/`, `generated/` and `config/` beside
  `main/` (or the SDK repository's sample tables), then includes
  `sdk/ports/esp-idf/component.cmake`. The component's sources therefore come from the
  replaceable `sdk/`, and an SDK update brings new files with it.
- The settings' include folder and `IOTOS_KIT_HAVE_SETTINGS` are public on the component
  (`iotos_starter_sources(... PUBLIC)`), so `main.c` sees them.
- `main/CMakeLists.txt` builds every `.c` file in `main/` and requires every component,
  so the agent can add a Modbus file or use the UART driver without editing build files.
- `main.c` is the Linux example's program with ESP-IDF around it: Wi-Fi from
  `CONFIG_IOTOS_WIFI_SSID` and `CONFIG_IOTOS_WIFI_PASSWORD` (`main/Kconfig.projbuild`,
  set with `idf.py menuconfig`), NVS, the ports, the signal strength in the health
  metrics, and a one-tick delay in the loop, because `iotos_poll` returns at once while
  it waits to reconnect.
- `sdkconfig` holds the Wi-Fi password, so the `.gitignore` adds it with
  `sdkconfig.old` and `managed_components/`. `sdkconfig.defaults` sets the main task's
  stack (the TLS handshake runs on it), a larger app partition, TLS over mbedTLS, and
  SNTP.

The target is called supported once the [ESP32 starter bench](../hardware/esp32-starter-bench.md)
passes with two coding agents.

**The NXP starter** is the board example above, with `app/` as the developer path and
`CMakeLists.txt`, `prj.conf`, `lwipopts.h` and `board/` at the root. It holds no vendor
code but NXP's BSD-licensed board files: the README's Build section fetches the
MCUXpresso SDK 26.09.00 with `west`, narrowed to the projects the board needs, and the
build finds it through `MCUXSDK_ROOT` and the toolchain through `ARMGCC_DIR`. A direct
starter's `app/modbus_rtu.c` compiles to nothing (`IOTOS_KIT_ROLE_GATEWAY` is 0).

**Connection settings** are a separate download that needs `Device.manage-connections`:
`config/iotos_settings.h` and `.c` (format `IOTOS_KIT_SETTINGS_FORMAT 1`), the shared
`config/README.md` and, for a direct device, the connection kit's three files. A **full
kit** is a starter with them in place. Examples refuse settings of another format or role
with `#error`; without settings they print where to get them and exit 2.

**The AI brief** (`AGENTS.md`) has nine fixed sections: what the project is, rules (never
open `config/`, never edit the replaceable paths, no code before a confirmed brief, never
invent a value), what is already known, the interview, the device brief, the port (AI-
assisted only), the field side, verification and later changes. The agent records the
answers as `<developer path>/device-brief.yaml`
([schema](../../contracts/firmware/v1/device-brief.schema.json), `unknown` allowed for
any fact) and waits for confirmation before writing `field.c`.

**Updating**: the README's recipe checks the new manifest's `format`, then replaces exactly
the manifest's `replaceable` paths and the manifest. CI runs that recipe from revision 1
to 2 of a fixture profile and checks the developer's files are unchanged.

**Checks**:
- `php artisan firmware:starter-fixtures --output=<dir>` builds every available target and
  role from [`contracts/firmware/fixtures/profiles`](../../contracts/firmware/fixtures/profiles)
  without a database; the `Firmware starters` CI job builds the Linux ones with `-Werror`,
  runs them to the missing-settings exit, builds the simulator inside them, and
  syntax-checks the AI-assisted ones.
- Its `esp32` leg runs [`tooling/firmware/build-esp32-starters.sh`](../../tooling/firmware/build-esp32-starters.sh)
  in `espressif/idf:v5.4.1`: every ESP32 starter as downloaded, a full kit with the
  golden direct settings, and the example for the ESP32-C3 (RISC-V). Each build fails on
  a compiler warning in its own files, and on compiling other core sources than the
  desktop library ([`core_sources.py`](../../tooling/firmware/core_sources.py) reads both
  `compile_commands.json` files). ccache is kept between runs. With ESP-IDF's
  `export.sh` sourced, the same script runs locally.
- The [`Firmware NXP`](../../.github/workflows/firmware-nxp.yml) workflow runs
  [`tooling/firmware/build-nxp-starters.sh`](../../tooling/firmware/build-nxp-starters.sh)
  the same way for every NXP starter, a full kit and the example, on changes to the
  firmware, its contracts, its generator or the workflow, and nightly. It is a workflow
  of its own because the vendor SDK is large:
  [`fetch-mcuxsdk.sh`](../../tooling/firmware/fetch-mcuxsdk.sh) fetches a pinned
  revision and trims it to the RT1050 (about 550 MB), and both it and the Arm GNU
  Toolchain 14.2.rel1 are cached by version. The script runs locally with
  `MCUXSDK_ROOT` and `ARMGCC_DIR` set.
- `--golden` rewrites [`contracts/firmware/fixtures/expected`](../../contracts/firmware/fixtures/expected);
  `GoldenOutputTest` compares the generator with it byte for byte. Review that diff when
  the generator or the SDK headers change.
- Feature tests cover the layout per target and role, tenant isolation, permissions,
  limits (`IOTOS_MAX_METRICS_PER_TYPE`, `IOTOS_MAX_DEVICE_TYPES`), determinism, a secret
  scan of every starter, and the brief's drift against the SDK headers.

**End to end**: [`tooling/verify-embedded-sdk.mjs`](../../tooling/verify-embedded-sdk.mjs)
runs a gateway full kit against a local stack. It registers a gateway, downloads its Linux
kit with the gateway health profile as the node type and two device types, builds the
kit's desktop simulator with CMake and runs 500 devices, each reporting every 30 s
(`EMBEDDED_INTERVAL_S`; the dev API cannot keep up with 500 devices every 10 s, see
[gotchas](../dev/gotchas.md#local-stack)). It then checks:

1. Discovery of every source, and a telemetry capture with no runtime diagnostics.
2. A restart with the same state file re-announces every source within five minutes
   with the next `bdSeq` (SC-004).
3. Bulk onboarding of 247 devices, counting the rebirths the run causes. The runtime
   refuses an activation it checks before the device's next birth, so the script
   activates refused devices again in rounds timed between rebirths and records how
   many each round refused.
4. The gateway's own source onboarded with the health profile, with the SDK version and
   device counts arriving.
5. A command to a simulated valve is applied and observed.
6. Stopping the simulator takes the gateway and its devices offline.

It prints the timings, the rebirth count and the refusals per round, writes them to
`.local/embedded-sdk/<gateway>/evidence.json`, and deactivates and archives the devices it
created (`--keep` leaves them). `node tooling/verify-embedded-sdk.mjs` targets the dev
stack; with an `environment.json` argument it targets the disposable devices harness,
whose `tooling/test-devices.mjs` runs it when `cc` and `cmake` are on the PATH.
