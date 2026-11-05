# Porting the IoT OS SDK to a board

The SDK is C99 with no heap and no operating system. It reaches the board only through
the ports in `sdk/include/iotos/iotos_ports.h`, which the program passes to `iotos_init`
in an `iotos_ports` structure. Write them with designated initialisers
(`.connect = my_connect`), so they keep compiling when a later SDK adds an optional
member.

## The six ports

| Port | Needed | What it does | Template |
| --- | --- | --- | --- |
| stream | one of stream or MQTT | A verified TLS byte stream to the broker. The SDK runs MQTT over it (level 1). | `stream-template.c` |
| MQTT | one of stream or MQTT | A modem that runs MQTT and TLS itself (level 2). It hands each received message to `iotos_mqtt_inbound`. | `modem-at-mqtt-template.c` (untested) |
| clock | yes | UTC milliseconds once the time is set, and a monotonic millisecond counter. | `clock-template.c` |
| storage | recommended | Keeps the Sparkplug `bdSeq` across reboots. Without it, bdSeq starts again after a reboot. | `storage-template.c` |
| log | optional | Writes the SDK's messages somewhere a developer can read them. | `log-template.c` |
| lock | with more than one task | A plain mutex. The SDK never takes it twice from one task. | `lock-template.c` |

## Choosing the network level

- **Level 1, a byte stream**, when the board has TCP and TLS: lwIP with mbedTLS, a Wi-Fi
  module's sockets, or a modem in transparent TLS mode. The SDK's bundled coreMQTT runs
  over it. The TLS handshake must verify the broker against the CA and the host name.
- **Level 2, MQTT**, when a cellular modem runs MQTT itself (AT commands). Set
  `max_payload` to the largest publish the modem accepts. Births larger than that are
  refused and logged. The template is annotated for the Quectel BG95 command family and
  has not passed a bench yet: check each command against the modem's application notes.
  Sparkplug payloads are binary, so a modem that cannot publish, receive and set its will
  by length belongs on level 1, through its transparent TLS socket.

Never add a second MQTT client. Vendor middleware that bundles coreMQTT or another MQTT
library must be left out of the build, or the program fails to link or runs two
sessions.

## Threading

- One task calls `iotos_poll` every 10 to 100 ms, and every callback runs on that task.
- `on_birth` runs while the SDK holds its lock. It may only call the `iotos_put_` calls
  on the writer it is given. Any other SDK call from there deadlocks.
- `on_command` and `on_event` run with the lock released, so they may publish.
- `iotos_begin`, the `iotos_put_` calls and `iotos_commit` may be called from other
  tasks when the lock port is set.

## Filling the templates

1. Copy each template from `app/ports/` into the build, and rename the `my_` prefix.
2. Replace each `TODO` with the board's calls. The comments say what each function must
   return, and what the SDK does with it.
3. The desktop ports in `sdk/ports/posix/` are a complete working set to compare with.
4. Build the program with every source the starter lists: `sdk/src/`,
   `sdk/third_party/coreMQTT/source/`, `generated/iotos_types.c`, `app/` and
   `app/ports/`. Add `config/iotos_settings.c` when it exists, and
   `sdk/starter/settings_missing.c` until then. Include `sdk/include/`, `sdk/starter/`,
   `generated/` and `config/`.

## Checking a port against the platform

With the connection settings in `config/`:

1. **Connect**: the log shows `event: connected`. `credentials refused` means wrong
   settings; `connect failed` usually means TLS: check the CA, the host name and the
   clock.
2. **Birth**: once the platform is online, the log shows `event: online`, and the device
   page in IoT OS shows the node's metrics.
3. **Command**: send a command from IoT OS to a metric that accepts commands. The
   device applies it and publishes the new state, and the platform marks it confirmed.
4. **Reboot**: restart the board and check that it connects again with the next bdSeq
   (the storage port works).
