/* SPDX-License-Identifier: MIT */
/*
 * IoT OS embedded SDK: a Sparkplug B edge node for gateways and direct devices.
 *
 * The integrator registers device types, adds devices, writes values and handles
 * commands. The SDK owns the Sparkplug session: births, deaths, sequence numbers,
 * aliases, rebirth requests and the host application's state. All of its state lives
 * in one iotos_gateway the caller allocates, and it never uses the heap.
 */
#ifndef IOTOS_H
#define IOTOS_H

#include "iotos_config_defaults.h"
#include "iotos_health.h"
#include "iotos_ports.h"
#include "iotos_types.h"

#ifdef __cplusplus
extern "C" {
#endif

#define IOTOS_SDK_VERSION "0.1.0"

typedef struct iotos_gateway iotos_gateway;
typedef struct iotos_writer iotos_writer;

/*
 * Callbacks. One task calls iotos_poll, and every callback runs on that task.
 */
typedef struct {
    /* Fill the current values for a birth (device_id NULL = the node). Metrics not
     * written are sent as nulls. Runs while the gateway lock is held: call only
     * iotos_put_* and iotos_put_at on w. Any other SDK call from here deadlocks. */
    void (*on_birth)(void *ctx, const char *device_id, iotos_writer *w);
    /* A validated command (device_id NULL = the node): the metric accepts commands and
     * the value has its datatype. Runs with the lock released: apply the command, then
     * publish the metric's new state from here. The platform confirms a command only
     * when it sees that value. */
    void (*on_command)(void *ctx, const char *device_id, const char *metric,
                       const iotos_value *value);
    /* Connection, authentication, session takeover, clock and rejected commands. Runs
     * with the lock released, so it may publish, add devices or mark them offline. */
    void (*on_event)(void *ctx, iotos_event event, iotos_status detail);
    void *ctx;
} iotos_callbacks;

/* Lifecycle. iotos_init copies the port and callback structures; settings and device
 * types must outlive the gateway. */
iotos_status iotos_init(iotos_gateway *gw, const iotos_settings *settings,
                        const iotos_ports *ports, const iotos_callbacks *callbacks);
iotos_status iotos_register_type(iotos_gateway *gw, const iotos_device_type *type);
iotos_status iotos_start(iotos_gateway *gw); /* begins connecting */
/* Network I/O, keepalive, inbound messages, paced births and reconnect back-off.
 * Returns within budget_ms, except that a connection attempt may block for up to
 * IOTOS_CONNECT_TIMEOUT_MS. Call it from one task, often (every 10-100 ms). */
iotos_status iotos_poll(iotos_gateway *gw, uint32_t budget_ms);
iotos_status iotos_stop(iotos_gateway *gw); /* publishes NDEATH, disconnects */

/* Health. The SDK publishes these when the node type has the matching metrics
 * (iotos_health.h). */
iotos_status iotos_set_firmware_version(iotos_gateway *gw, const char *version); /* before iotos_start; kept by pointer */
iotos_status iotos_set_connection(iotos_gateway *gw, iotos_connection_type type,
                                  bool has_signal, double signal_dbm);

/* Devices. These and the writer calls may be called from any task. */
iotos_status iotos_device_add(iotos_gateway *gw, const char *id, const iotos_device_type *type);
iotos_status iotos_device_offline(iotos_gateway *gw, const char *id); /* DDEATH */
iotos_status iotos_device_remove(iotos_gateway *gw, const char *id);  /* DDEATH, frees the slot */

/* Values. A writer holds the gateway lock from iotos_begin until it is committed or
 * aborted, so keep it short. Only one writer is open at a time.
 *
 * Each put checks the value against the metric's datatype: integer puts narrow to the
 * metric's width with a range check, numbers must be finite, and 64-bit integers must
 * stay within +/-2^53, the range the platform keeps exactly. A failed put returns an
 * error and leaves the message as it was.
 *
 * iotos_commit returns IOTOS_PENDING_BIRTH, and sends nothing, for a device whose birth
 * is queued: on_birth supplies its current values. A device marked offline is queued
 * for a new birth by its next commit. */
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
iotos_status iotos_put_at(iotos_writer *w, uint64_t utc_ms); /* timestamp for the following puts */
iotos_status iotos_commit(iotos_writer *w);                   /* sends DDATA or NDATA */
void iotos_abort(iotos_writer *w);

/* Level 2 ports hand each received message to the SDK from inside their poll. */
void iotos_mqtt_inbound(iotos_gateway *gw, const char *topic, const uint8_t *data, size_t len,
                        bool retained);

const char *iotos_status_text(iotos_status status);

/* ------------------------------------------------------------------------------------
 * Internal state. It is public only so the caller can allocate iotos_gateway; every
 * member may change between versions.
 */

/* Room for the MQTT client's context; mqtt_stream.c checks it fits. */
#define IOTOS__MQTT_CONTEXT_WORDS 32
#define IOTOS__EVENT_QUEUE 8

typedef struct {
    char id[IOTOS_DEVICE_ID_MAX + 1];
    uint8_t type;  /* index into the registered types */
    uint8_t state; /* free, offline, birth pending, born */
} iotos__device_slot;

struct iotos_writer {
    iotos_gateway *gw;
    const iotos_device_type *type;
    int32_t slot; /* -1 = the node */
    bool open;
    bool birth;
    bool clock_valid;
    bool use_at;
    bool overflow; /* a put did not fit */
    uint64_t clock_ms; /* metric timestamp unless iotos_put_at set one */
    uint64_t at_ms;
    size_t length; /* bytes written to the transmit buffer */
    uint16_t count; /* metrics written */
    uint8_t filled[(IOTOS_MAX_METRICS_PER_TYPE + 7) / 8]; /* birth: metrics written */
};

struct iotos_gateway {
    const iotos_settings *settings;
    iotos_stream_port stream;
    iotos_mqtt_port mqtt;
    iotos_clock_port clock;
    iotos_storage_port storage;
    iotos_log_port log;
    iotos_lock_port lock;
    iotos_callbacks callbacks;
    bool use_stream;

    /* Session */
    uint8_t state;
    uint8_t bd_seq;
    uint8_t seq;
    bool started;
    bool connected;
    bool host_online;
    bool node_born;
    bool node_birth_pending;
    bool polling;
    bool in_inbound;
    bool received; /* the stream delivered bytes during this receive pass */
    uint32_t reconnects;
    uint32_t connects;
    uint32_t backoff_ms;
    uint32_t next_attempt_ms;
    uint32_t connected_at_ms;
    uint32_t short_closes[3];
    uint8_t short_close_count;
    uint32_t next_birth_ms;
    bool clock_waiting;
    uint32_t clock_wait_since_ms;
    uint32_t clock_next_report_ms;
    uint32_t last_ms;
    uint64_t uptime_ms;
    uint32_t next_health_ms;
    uint32_t random;
    uint16_t birth_cursor;

    /* Health */
    const char *firmware_version;
    uint8_t connection_type;
    bool connection_set;
    bool has_signal;
    double signal_dbm;

    /* Devices */
    const iotos_device_type *types[IOTOS_MAX_DEVICE_TYPES];
    uint8_t type_count;
    uint16_t device_count;
    iotos__device_slot devices[IOTOS_MAX_DEVICES];

    /* Events waiting for the lock to be released */
    struct {
        uint8_t event;
        int8_t detail;
    } events[IOTOS__EVENT_QUEUE];
    uint8_t event_count;

    iotos_writer writer;
    char topic[IOTOS_TOPIC_MAX];
    char command_device[IOTOS_DEVICE_ID_MAX + 1];
    char command_text[IOTOS_COMMAND_STRING_MAX + 1];
    void *mqtt_context[IOTOS__MQTT_CONTEXT_WORDS];
    uint8_t tx[IOTOS_TX_BUFFER];
    uint8_t rx[IOTOS_RX_BUFFER]; /* also the MQTT client's buffer */
};

#ifdef __cplusplus
}
#endif

#endif
