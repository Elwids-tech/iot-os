# Contract: SDK C API (`iotos.h`, version 0.1)

This is the public surface integrators compile against. Anything not listed here is
internal and may change between minor versions. Breaking changes bump the major
version once 1.0 is released; before that, they are listed in `CHANGELOG.md`.

## Return codes

`iotos_status` is an enum. `IOTOS_OK` is 0, and every other value is negative:

| Code | Meaning |
| --- | --- |
| `IOTOS_OK` | Done |
| `IOTOS_PENDING_BIRTH` | The device's birth is queued; its current values go out with the birth (R8) |
| `IOTOS_E_INVALID` | Bad argument: ID characters, unknown type or metric, wrong datatype, NaN/Inf, out-of-range integer |
| `IOTOS_E_DUPLICATE` | Device ID already added |
| `IOTOS_E_FULL` | A compile-time limit would be exceeded |
| `IOTOS_E_TOO_LARGE` | The message would exceed `IOTOS_TX_BUFFER` or the transport's maximum size |
| `IOTOS_E_OFFLINE` | Not connected, or the host application is offline |
| `IOTOS_E_CLOCK` | The clock is not valid yet |
| `IOTOS_E_TRANSPORT` | The network port reported an error |
| `IOTOS_E_AUTH` | The broker refused the credentials |

`iotos_status_text(status)` returns a constant English string.

## Lifecycle

```c
iotos_status iotos_init(iotos_gateway *gw, const iotos_settings *settings,
                        const iotos_ports *ports, const iotos_callbacks *callbacks);
iotos_status iotos_register_type(iotos_gateway *gw, const iotos_device_type *type);
iotos_status iotos_start(iotos_gateway *gw);          /* begins connecting */
iotos_status iotos_poll(iotos_gateway *gw, uint32_t budget_ms); /* call from one task */
iotos_status iotos_stop(iotos_gateway *gw);           /* publishes NDEATH, disconnects */
```

`iotos_settings` and every `iotos_device_type` come from the kit's generated headers.
`iotos_poll` does network I/O, keepalive, inbound messages, paced births and reconnect
back-off, and returns within `budget_ms`.

All SDK state lives in the caller's `iotos_gateway`, including the MQTT client's context
and buffer at the stream level. The library has no other writable static data and never
calls `malloc`, `calloc`, `realloc` or `free`, so `sizeof(iotos_gateway)` is its whole RAM
use apart from the integrator's ports.

```c
typedef struct {
    const char *broker_host; uint16_t broker_port;
    const char *group_id, *edge_node_id, *host_id;
    const char *username;               /* also the MQTT client ID */
    const char *password, *ca_pem;
    const iotos_device_type *node_type; /* the node's metrics: gateway health, or a direct device's profile */
} iotos_settings;
```

## Health

```c
typedef enum { IOTOS_CONN_ETHERNET, IOTOS_CONN_WIFI, IOTOS_CONN_CELLULAR, IOTOS_CONN_OTHER } iotos_connection_type;
iotos_status iotos_set_firmware_version(iotos_gateway *gw, const char *version);  /* before iotos_start */
iotos_status iotos_set_connection(iotos_gateway *gw, iotos_connection_type type,
                                  bool has_signal, double signal_dbm);
```

When the node type contains the default health metrics, the SDK fills them in every
NBIRTH and every `IOTOS_HEALTH_INTERVAL_S`:
- `uptime`, `sdk_version`, `devices_configured`, `devices_online` and `reconnects`
  come from the SDK itself;
- `connection_type`, `signal_strength` and `firmware_version` come from the two setters
  above;
- `signal_strength` is a null when `has_signal` is false.

Their names are constants in `iotos_health.h`. The integrator's own node metrics are
written in `on_birth` (device NULL) and through `iotos_begin(gw, NULL, …)`.

## Devices and values

```c
iotos_status iotos_device_add(iotos_gateway *gw, const char *id, const iotos_device_type *type);
iotos_status iotos_device_offline(iotos_gateway *gw, const char *id);   /* DDEATH */
iotos_status iotos_device_remove(iotos_gateway *gw, const char *id);    /* DDEATH, frees the slot */

iotos_status iotos_begin(iotos_gateway *gw, const char *device_id /* NULL = node */,
                         iotos_writer **out);
iotos_status iotos_put_bool(iotos_writer *w, const char *metric, bool value);
iotos_status iotos_put_i64(iotos_writer *w, const char *metric, int64_t value);
iotos_status iotos_put_u64(iotos_writer *w, const char *metric, uint64_t value);
iotos_status iotos_put_double(iotos_writer *w, const char *metric, double value);
iotos_status iotos_put_string(iotos_writer *w, const char *metric, const char *value);
iotos_status iotos_put_datetime(iotos_writer *w, const char *metric, uint64_t utc_ms);
iotos_status iotos_put_bytes(iotos_writer *w, const char *metric, const uint8_t *data, size_t len);
iotos_status iotos_put_null(iotos_writer *w, const char *metric);
iotos_status iotos_put_at(iotos_writer *w, uint64_t utc_ms);   /* timestamp for following puts */
iotos_status iotos_commit(iotos_writer *w);                     /* sends DDATA/NDATA */
void         iotos_abort(iotos_writer *w);
```

- Each `put_*` checks the value against the metric's datatype in the device type. Integer
  puts narrow to the metric's declared width with a range check.
- A writer holds the gateway lock from `iotos_begin` until it is committed or aborted.
  Only one writer is open at a time.
- `iotos_commit` returns `IOTOS_PENDING_BIRTH` for a device that is not born yet; nothing
  is sent.

## Callbacks

```c
typedef struct {
    /* Fill current values for a birth; metrics not written are sent as null. */
    void (*on_birth)(void *ctx, const char *device_id /* NULL = node */, iotos_writer *w);
    /* A validated command: the metric accepts commands and the value has its datatype. */
    void (*on_command)(void *ctx, const char *device_id /* NULL = node */,
                       const char *metric, const iotos_value *value);
    /* Connection, authentication, session takeover, clock, rejected commands. */
    void (*on_event)(void *ctx, iotos_event event, iotos_status detail);
    void *ctx;
} iotos_callbacks;
```

After applying a command, the integrator publishes the metric's new state. The platform
confirms a command only when it sees that value (R9).

**Threads and the lock.**
- One task calls `iotos_poll`, and every callback runs on that task.
- `iotos_begin`…`iotos_commit`, `iotos_device_add`, `iotos_device_offline` and
  `iotos_device_remove` may be called from any task. Each takes the lock from
  `iotos_lock_port`, which need not be recursive.
- `iotos_poll` releases the lock before calling `on_command` or `on_event`. Those two
  callbacks may therefore publish, add devices or mark them offline. Publishing the new
  state from inside `on_command` is the expected way to confirm a command.
- `on_birth` runs while the birth is being written and the lock is held. It may only call
  `iotos_put_*` and `iotos_put_at` on the writer it is given; any other SDK call from it
  would deadlock.

## Ports

```c
typedef struct {                /* Level 1: TLS byte stream; the SDK runs MQTT over it */
    iotos_status (*connect)(void *ctx, const char *host, uint16_t port,
                            const char *ca_pem, uint32_t timeout_ms);
    int32_t      (*send)(void *ctx, const uint8_t *data, size_t len);  /* bytes sent or <0 */
    int32_t      (*recv)(void *ctx, uint8_t *data, size_t len);        /* bytes read, 0 none, <0 */
    void         (*close)(void *ctx);
    void *ctx;
} iotos_stream_port;

typedef struct {                /* Level 2: the modem runs MQTT */
    iotos_status (*connect)(void *ctx, const iotos_mqtt_connect *opts); /* incl. will */
    iotos_status (*publish)(void *ctx, const char *topic, const uint8_t *data,
                            size_t len, uint8_t qos, bool retain);
    iotos_status (*subscribe)(void *ctx, const char *filter, uint8_t qos);
    iotos_status (*poll)(void *ctx, uint32_t budget_ms);  /* delivers via iotos_mqtt_inbound */
    void         (*disconnect)(void *ctx);
    size_t       max_payload;                             /* 0 = unlimited */
    void *ctx;
} iotos_mqtt_port;

void iotos_mqtt_inbound(iotos_gateway *gw, const char *topic,
                        const uint8_t *data, size_t len, bool retained);

typedef struct { uint64_t (*now_ms)(void *ctx, bool *valid); void *ctx; } iotos_clock_port;
typedef struct {                /* optional; NULL keeps bdSeq in RAM only */
    bool (*load)(void *ctx, const char *key, void *out, size_t len);
    bool (*save)(void *ctx, const char *key, const void *data, size_t len);
    void *ctx;
} iotos_storage_port;
typedef struct { void (*write)(void *ctx, iotos_log_level level, const char *message); void *ctx; } iotos_log_port;
typedef struct { void (*lock)(void *ctx); void (*unlock)(void *ctx); void *ctx; } iotos_lock_port;

typedef struct {
    const iotos_stream_port  *stream;   /* exactly one of stream or mqtt */
    const iotos_mqtt_port    *mqtt;
    const iotos_clock_port   *clock;
    const iotos_storage_port *storage;  /* optional */
    const iotos_log_port     *log;      /* optional */
    const iotos_lock_port    *lock;     /* optional for single-task builds */
} iotos_ports;
```

Port structures only ever gain members at the end, and a `NULL` function means the
port does not offer it. Ports written with designated initialisers therefore keep
compiling when a later version adds an optional member, for example store-and-forward
calls on `iotos_storage_port` (FR-030).

Shipped ports:
- `ports/posix`: stream (mbedTLS over sockets), clock, file storage, stderr log, pthread
  lock.
- `ports/freertos`: lock and log helpers.
- `ports/mcuxpresso-lwip`: stream (mbedTLS over lwIP sockets) and lwIP SNTP clock.
- `ports/templates/`: annotated templates for every port, which compile as shipped:
  - `stream-template.c`;
  - `modem-at-mqtt-template.c`, written for the BG95 command family;
  - `clock-template.c`, `storage-template.c`, `log-template.c` and `lock-template.c`.

## Configuration macros

All are overridable before including `iotos.h`, with the defaults from research R7:
`IOTOS_MAX_DEVICES`, `IOTOS_MAX_DEVICE_TYPES`, `IOTOS_MAX_METRICS_PER_TYPE`,
`IOTOS_DEVICE_ID_MAX`, `IOTOS_TX_BUFFER`, `IOTOS_RX_BUFFER` (also coreMQTT's fixed buffer),
`IOTOS_BIRTHS_PER_SECOND` (default 20), `IOTOS_KEEPALIVE_S` (default 20),
`IOTOS_HEALTH_INTERVAL_S` (default 60), `IOTOS_CLOCK_WAIT_S` (default 300, after which
`on_event` reports `IOTOS_E_CLOCK` every minute).

## Wire behaviour (normative)

- Topics are `spBv1.0/<group>/{NBIRTH,NDATA,NDEATH,NCMD}/<edge>` and
  `spBv1.0/<group>/{DBIRTH,DDATA,DDEATH,DCMD}/<edge>/<device>`. The SDK subscribes to
  exactly `…/NCMD/<edge>`, `…/DCMD/<edge>/+` and `spBv1.0/STATE/<host>`.
- The client ID and username are the kit's username. MQTT 3.1.1, clean session, the will
  is the NDEATH with the current bdSeq at QoS 1 and not retained, data is QoS 0.
- Births carry name and alias for every metric; data carries aliases only (R9). The
  NBIRTH's `bdSeq` and `Node Control/Rebirth` go by name without an alias, because they
  never appear in data.
- Retained NCMD/DCMD are ignored. Commands are matched by metric name.
