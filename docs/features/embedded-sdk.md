# Embedded SDK

A portable C99 library that gateway and device firmware compile in to talk to the
platform over Sparkplug B on MQTT and TLS. It owns the Sparkplug edge-node session for a
gateway and hundreds of devices behind it; the integrator keeps the hardware behind small
ports. The decision is [ADR-029](../adr/ADR-029-embedded-sdk-and-gateway-kits.md), the
spec [026](../../specs/026-embedded-gateway-sdk/spec.md), and the API contract
[sdk-c-api](../../specs/026-embedded-gateway-sdk/contracts/sdk-c-api.md).

Code: [`firmware/sdk`](../../firmware/sdk/README.md), MIT-licensed for that folder
only. Gateway kits that bundle it with generated settings, and the board port, follow
in later pull requests of spec 026.

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
shipped (a CTest keeps them in step with the headers), and `ports/posix/` a working
desktop set. Port structures only ever gain members at the end and treat `NULL` as
unsupported, so ports written with designated initialisers keep compiling. That is how
store-and-forward will extend `iotos_storage_port`: new optional calls at the end, used
only when set.

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

## Building and testing

```bash
cmake -S firmware/sdk -B .local/sdk-build -DIOTOS_SANITIZE=ON && cmake --build .local/sdk-build
ctest --test-dir .local/sdk-build --output-on-failure
cmake -S firmware/sdk -B .local/sdk-arm -DCMAKE_TOOLCHAIN_FILE=firmware/sdk/cmake/arm-none-eabi.cmake
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
built from a kit it uses the kit's `config/`. A direct-device kit simulates the node's
own metrics and refuses `--devices`. The birth rate is the compile-time
`IOTOS_BIRTHS_PER_SECOND`.
