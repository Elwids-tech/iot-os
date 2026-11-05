# IoT OS embedded SDK

A portable C99 library that connects gateway and device firmware to IoT OS over MQTT
with Sparkplug B. It owns the Sparkplug session (births, deaths, sequence numbers,
aliases, rebirth requests, the host application's state and commands) for a gateway
and hundreds of devices behind it. You keep the hardware: the network, clock, storage,
logging and locking are small ports you implement or copy from `ports/`.

- No heap and no writable static data: all state lives in one `iotos_gateway` you
  allocate, about 20 KB with 512 devices.
- No operating system in the core. FreeRTOS, bare metal and desktop builds use the same
  code.
- Two network levels: a TLS byte stream (the SDK runs MQTT over it with the bundled
  coreMQTT client), or a modem that runs MQTT itself.

## Layout

| Path | What |
| --- | --- |
| `include/iotos/` | The API: `iotos.h`, `iotos_ports.h`, `iotos_types.h`, `iotos_health.h`, `iotos_config_defaults.h` |
| `src/` | The core: codec, session, devices, writer, commands, health, MQTT over a stream |
| `third_party/coreMQTT/` | coreMQTT v2.3.1, vendored (`THIRD_PARTY.md`) |
| `ports/posix/` | Desktop ports: mbedTLS over sockets, clock, file storage, stderr log, pthread lock |
| `ports/esp-idf/` | ESP-IDF v5.4 ports: esp-tls, SNTP and esp_timer, NVS, ESP_LOG; `component.cmake` makes the SDK an ESP-IDF component |
| `ports/freertos/` | A FreeRTOS lock (a static, non-recursive mutex) and log |
| `ports/mcuxpresso-lwip/` | MCUXpresso SDK 26.x ports: mbedTLS over lwIP sockets, the TRNG, lwIP SNTP and the FreeRTOS tick; `iotos_mcux.cmake` adds them to a project |
| `ports/templates/` | Annotated templates for each port, which compile as shipped, and an untested modem MQTT port (`modem-at-mqtt-template.c`) |
| `examples/desktop-simulator/` | A gateway simulator with many simulated devices |
| `cmake/iotos_sources.cmake` | The core's source list, which every build uses |
| `tests/`, `tools/` | Unit tests and the contract fixture writer (repository only) |
| `examples/linux-app/`, `examples/esp32-wifi/`, `examples/rt1050-evkb-ethernet/` | The Linux, ESP32 and NXP starters' projects (repository only) |

## Using it

```c
#include "iotos/iotos.h"
#include "iotos_settings.h"  /* from your kit's config/ */
#include "iotos_types.h"

static iotos_gateway gateway;

static void on_birth(void *ctx, const char *device_id, iotos_writer *w) {
    /* Current values for a birth; metrics you skip are sent as nulls. */
}
static void on_command(void *ctx, const char *device_id, const char *metric, const iotos_value *value) {
    /* Apply it, then publish the new state from here: that confirms the command. */
}

void connectivity_task(void) {
    static const iotos_callbacks callbacks = { on_birth, on_command, NULL, NULL };
    iotos_init(&gateway, &iotos_kit_settings, &my_ports, &callbacks);
    iotos_register_type(&gateway, &iotos_type_water_meter);
    iotos_device_add(&gateway, "meter-17", &iotos_type_water_meter);
    iotos_start(&gateway);
    for (;;) {
        iotos_poll(&gateway, 50);
    }
}

void rs485_task(void) {  /* any task */
    iotos_writer *w;
    if (iotos_begin(&gateway, "meter-17", &w) == IOTOS_OK) {
        iotos_put_double(w, "flow_rate", 12.5);
        iotos_commit(w);
    }
}
```

`iotos_commit` returns `IOTOS_PENDING_BIRTH` while a device's birth is queued; nothing
is lost, because the birth asks `on_birth` for the current values.

### Threads

- One task calls `iotos_poll`, and every callback runs on that task.
- The writer and device calls may come from any task. They take the lock port, which
  can be a plain FreeRTOS mutex.
- `on_command` and `on_event` run with the lock released, so they may publish.
- `on_birth` runs with the lock held: only `iotos_put_*` and `iotos_put_at` on its
  writer are allowed there.

## Ports

| Port | Required | What it does |
| --- | --- | --- |
| stream or mqtt | one of them | A TLS byte stream, or a modem's own MQTT session |
| clock | yes | UTC milliseconds once synchronised, and a monotonic millisecond counter |
| storage | no | Keeps `bdSeq` across reboots |
| log | no | Short sentences explaining problems |
| lock | when several tasks call the SDK | A plain, non-recursive mutex |

Start from `ports/templates/`; `ports/posix/` is a complete desktop set,
`ports/esp-idf/` a complete ESP-IDF one (`iotos_esp_idf_ports_init`) and
`ports/mcuxpresso-lwip/` an MCUXpresso one without storage (`iotos_mcux_ports_init`).
Port structures only gain members at the end, so write them with designated
initialisers.

## Limits

Compile-time, in `iotos_config_defaults.h`, overridable with `-D`: 512 devices, 8 device
types, 64 metrics per type, 24-character device IDs, a 4 KiB transmit buffer, a 1 KiB
receive buffer and 20 births per second. Build the library and your application with
the same values. 64-bit integers are limited to ±2^53, the range the platform keeps
exactly.

## Building and testing

The desktop build fetches mbedTLS and Unity (pinned by hash) and builds under `.local/`
in the repository:

```bash
cmake -S firmware/sdk -B .local/sdk-build -DIOTOS_SANITIZE=ON && cmake --build .local/sdk-build
ctest --test-dir .local/sdk-build --output-on-failure
```

Cross-compile the core for a Cortex-M7 and check its size, static data and heap use:

```bash
cmake -S firmware/sdk -B .local/sdk-arm -DCMAKE_TOOLCHAIN_FILE="$PWD/firmware/sdk/cmake/arm-none-eabi.cmake"
cmake --build .local/sdk-arm --target iotos_size
```

In your own firmware build, compile the files `cmake/iotos_sources.cmake` lists
(`src/*.c` and `third_party/coreMQTT/source/*.c`, in `IOTOS_CORE_SOURCES`) with
`include/`, `src/`, `third_party/coreMQTT/source/include` and
`third_party/coreMQTT/source/interface` on the include path; a CMake build can include
that file. Do not also build another copy of coreMQTT (for example the MCUXpresso
middleware, or the coreMQTT component from the ESP Component Registry): two copies give
duplicate symbols.

The design, wire rules and decisions are in the repository's
`docs/features/embedded-sdk.md` and ADR-029.

## Licence

MIT (`LICENSE`), for this folder only. Third-party code is listed in `THIRD_PARTY.md`.
