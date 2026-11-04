/* SPDX-License-Identifier: MIT */
/*
 * The program: connects with the settings in config/, registers the device types in
 * generated/, adds the devices listed in field.c and publishes what field.c reads.
 * A direct device publishes its own metrics as the node; a gateway publishes each device
 * behind it, and the SDK fills the node's health metrics.
 *
 * The SDK owns Sparkplug: births, deaths, sequence numbers, aliases and rebirths. This
 * file only decides when to read. The hardware is read in field.c.
 *
 * Settings: APP_POLL_INTERVAL_S (seconds between reads), APP_OFFLINE_AFTER_POLLS (missed
 * reads before a device is marked offline) and APP_STATE_DIRECTORY (where bdSeq is kept
 * between runs), all set when building.
 */
#define _POSIX_C_SOURCE 200809L
#include <signal.h>
#include <stdio.h>
#include <string.h>

#include "field.h"
#include "iotos/iotos.h"
#include "iotos_posix.h"
#include "iotos_starter.h"
#include "iotos_types.h"

#ifdef IOTOS_KIT_HAVE_SETTINGS
#include "iotos_settings.h"
#if IOTOS_KIT_SETTINGS_FORMAT != 1
#error "These connection settings need a newer starter"
#endif
#if IOTOS_KIT_GATEWAY != IOTOS_KIT_ROLE_GATEWAY
#error "These connection settings are for the other role: a gateway's settings need a gateway starter, and a direct device's a direct one"
#endif
#endif

#ifndef APP_POLL_INTERVAL_S
#define APP_POLL_INTERVAL_S 10
#endif
#ifndef APP_OFFLINE_AFTER_POLLS
#define APP_OFFLINE_AFTER_POLLS 3
#endif
#ifndef APP_STATE_DIRECTORY
#define APP_STATE_DIRECTORY "."
#endif
#ifndef APP_FIRMWARE_VERSION
#define APP_FIRMWARE_VERSION "0.1.0"
#endif

/* The array always has one entry (a single NULL for a direct device), so this never
 * compares an unsigned count with zero. */
#define KIT_TYPES (sizeof(iotos_kit_types) / sizeof(iotos_kit_types[0]))

static iotos_gateway gateway;
static iotos_settings settings; /* iotos_kit_settings with the node type set */
static unsigned char missed[IOTOS_MAX_DEVICES]; /* reads in a row a device did not answer */
static volatile sig_atomic_t stopping;

static const iotos_device_type *type_named(const char *code)
{
    for (size_t i = 0; i < KIT_TYPES; i++) {
        if (iotos_kit_types[i] && strcmp(iotos_kit_types[i]->code, code) == 0) {
            return iotos_kit_types[i];
        }
    }
    return NULL;
}

/* The type of the device with this ID; NULL is the node. */
static const iotos_device_type *type_of(const char *device_id)
{
    if (!device_id) {
        return &iotos_kit_node_type;
    }
    for (size_t i = 0; i < field_device_count; i++) {
        if (strcmp(field_devices[i].id, device_id) == 0) {
            return type_named(field_devices[i].type);
        }
    }
    return NULL;
}

static iotos_status put(iotos_writer *w, const iotos_metric_def *metric, const iotos_value *value)
{
    if (value->is_null) {
        return iotos_put_null(w, metric->name);
    }
    switch (metric->datatype) {
    case IOTOS_BOOLEAN:
        return iotos_put_bool(w, metric->name, value->as.boolean);
    case IOTOS_UINT8:
    case IOTOS_UINT16:
    case IOTOS_UINT32:
    case IOTOS_UINT64:
        return iotos_put_u64(w, metric->name, value->as.u64);
    case IOTOS_FLOAT:
    case IOTOS_DOUBLE:
        return iotos_put_double(w, metric->name, value->as.number);
    case IOTOS_STRING:
        return iotos_put_string(w, metric->name, value->as.string);
    case IOTOS_DATETIME:
        return iotos_put_datetime(w, metric->name, value->as.utc_ms);
    case IOTOS_BYTES:
        return iotos_put_bytes(w, metric->name, value->as.bytes.data, value->as.bytes.length);
    default:
        return iotos_put_i64(w, metric->name, value->as.i64);
    }
}

/* Puts every metric field.c can read now. Returns how many were put, or -1 when the
 * device did not answer. A metric that is unavailable is left out: births send it as a
 * null, and data messages skip it. */
static int put_readings(iotos_writer *w, const iotos_device_type *type, const char *device_id)
{
    int count = 0;
    bool answered = false, offline = false;
    for (uint16_t m = 0; m < type->metric_count; m++) {
        iotos_value value;
        field_status status;
        memset(&value, 0, sizeof(value));
        value.datatype = type->metrics[m].datatype;
        status = field_read(type->code, type->metrics[m].name, device_id, &value);
        if (status == FIELD_OK) {
            answered = true;
            if (put(w, &type->metrics[m], &value) == IOTOS_OK) {
                count++;
            } else {
                fprintf(stderr, "field.c returned a value the SDK refused for %s\n", type->metrics[m].name);
            }
        } else if (status == FIELD_OFFLINE) {
            offline = true;
        }
    }
    return offline && !answered ? -1 : count;
}

static void on_birth(void *ctx, const char *device_id, iotos_writer *w)
{
    const iotos_device_type *type = type_of(device_id);
    (void)ctx;
    /* This runs with the SDK's lock held, so field_read must be quick here: return the
     * last value read when reading the hardware takes long. */
    if (type) {
        (void)put_readings(w, type, device_id);
    }
}

static void on_command(void *ctx, const char *device_id, const char *metric, const iotos_value *value)
{
    const iotos_device_type *type = type_of(device_id);
    iotos_writer *w;
    (void)ctx;
    if (!type) {
        return;
    }
    if (field_command(type->code, metric, device_id, value) != FIELD_OK) {
        fprintf(stderr, "field.c did not apply %s on %s\n", metric, device_id ? device_id : "the node");
        return;
    }
    /* The platform confirms a command when it sees the new state: read it back now. */
    for (uint16_t m = 0; m < type->metric_count; m++) {
        iotos_value state;
        if (strcmp(type->metrics[m].name, metric) != 0) {
            continue;
        }
        memset(&state, 0, sizeof(state));
        state.datatype = type->metrics[m].datatype;
        if (field_read(type->code, metric, device_id, &state) == FIELD_OK
            && iotos_begin(&gateway, device_id, &w) == IOTOS_OK) {
            if (put(w, &type->metrics[m], &state) == IOTOS_OK) {
                (void)iotos_commit(w);
            } else {
                iotos_abort(w);
            }
        }
    }
}

static void on_event(void *ctx, iotos_event event, iotos_status detail)
{
    static const char *const names[] = {"connected",      "connect failed",    "credentials refused",
                                        "disconnected",   "session takeover",  "host online",
                                        "host offline",   "rebirth requested", "online",
                                        "clock not set",  "birth failed",      "command rejected"};
    (void)ctx;
    printf("event: %s (%s)\n", (unsigned)event < sizeof(names) / sizeof(names[0]) ? names[event] : "?",
           iotos_status_text(detail));
    fflush(stdout);
}

static void publish(const char *device_id, const iotos_device_type *type, unsigned char *misses)
{
    iotos_writer *w;
    int count;
    if (iotos_begin(&gateway, device_id, &w) != IOTOS_OK) {
        return;
    }
    count = put_readings(w, type, device_id);
    if (count > 0) {
        (void)iotos_commit(w); /* IOTOS_PENDING_BIRTH or IOTOS_E_OFFLINE: the birth or the next round carries it */
    } else {
        iotos_abort(w);
    }
    if (!misses) {
        return;
    }
    if (count >= 0) {
        *misses = 0;
    } else if (*misses < APP_OFFLINE_AFTER_POLLS && ++*misses == APP_OFFLINE_AFTER_POLLS) {
        (void)iotos_device_offline(&gateway, device_id); /* its next answer brings a new birth */
    }
}

static void publish_all(void)
{
    if (!IOTOS_KIT_ROLE_GATEWAY) {
        publish(NULL, &iotos_kit_node_type, NULL);
    }
    for (size_t i = 0; i < field_device_count; i++) {
        const iotos_device_type *type = type_named(field_devices[i].type);
        if (type) {
            publish(field_devices[i].id, type, &missed[i]);
        }
    }
}

static int add_devices(void)
{
    for (size_t i = 0; i < KIT_TYPES; i++) {
        if (iotos_kit_types[i] && iotos_register_type(&gateway, iotos_kit_types[i]) != IOTOS_OK) {
            fprintf(stderr, "could not register type %s\n", iotos_kit_types[i]->code);
            return 1;
        }
    }
    if (field_device_count > IOTOS_MAX_DEVICES) {
        fprintf(stderr, "field.c lists more than IOTOS_MAX_DEVICES devices\n");
        return 1;
    }
    for (size_t i = 0; i < field_device_count; i++) {
        const iotos_device_type *type = type_named(field_devices[i].type);
        iotos_status status = type ? iotos_device_add(&gateway, field_devices[i].id, type) : IOTOS_E_INVALID;
        if (status != IOTOS_OK) {
            fprintf(stderr, "could not add %s (type %s): %s\n", field_devices[i].id, field_devices[i].type,
                    iotos_status_text(status));
            return 1;
        }
    }
    return 0;
}

static void request_stop(int signal_number)
{
    (void)signal_number;
    stopping = 1;
}

static const iotos_callbacks callbacks = {on_birth, on_command, on_event, NULL};

int main(void)
{
    static iotos_posix posix;
    uint32_t next_read;

    if (!iotos_kit_settings_present) {
        fprintf(stderr, "No connection settings: download them from the device's page in IoT OS and put the files in config/\n");
        return 2;
    }
    settings = iotos_kit_settings;
    settings.node_type = &iotos_kit_node_type;
    if (field_init() != 0) {
        fprintf(stderr, "field_init failed\n");
        return 1;
    }
    if (iotos_posix_ports_init(&posix, APP_STATE_DIRECTORY, IOTOS_LOG_INFO) != IOTOS_OK
        || iotos_init(&gateway, &settings, &posix.ports, &callbacks) != IOTOS_OK) {
        fprintf(stderr, "could not initialise the SDK: check config/iotos_settings.h\n");
        return 1;
    }
    if (add_devices() != 0) {
        return 1;
    }
    (void)iotos_set_firmware_version(&gateway, APP_FIRMWARE_VERSION);
    (void)iotos_set_connection(&gateway, IOTOS_CONN_ETHERNET, false, 0);
    signal(SIGINT, request_stop);
    signal(SIGTERM, request_stop);
    printf("connecting %s/%s to %s:%u with %u devices\n", settings.group_id, settings.edge_node_id,
           settings.broker_host, (unsigned)settings.broker_port, (unsigned)field_device_count);
    fflush(stdout);

    (void)iotos_start(&gateway);
    next_read = iotos_posix_monotonic_ms() + APP_POLL_INTERVAL_S * 1000u;
    while (!stopping) {
        (void)iotos_poll(&gateway, 50);
        if ((uint32_t)(iotos_posix_monotonic_ms() - next_read) < 0x80000000u) {
            next_read += APP_POLL_INTERVAL_S * 1000u;
            publish_all();
        }
    }
    printf("stopping\n");
    (void)iotos_stop(&gateway);
    iotos_posix_ports_free(&posix);
    return 0;
}
