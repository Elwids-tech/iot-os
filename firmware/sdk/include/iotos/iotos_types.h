/* SPDX-License-Identifier: MIT */
#ifndef IOTOS_TYPES_H
#define IOTOS_TYPES_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* IOTOS_OK is 0 and every other code is negative. iotos_status_text() describes one. */
typedef enum {
    IOTOS_OK = 0,
    IOTOS_PENDING_BIRTH = -1, /* the device's birth is queued; its values go out with it */
    IOTOS_E_INVALID = -2,     /* bad argument, unknown type or metric, wrong datatype, out of range */
    IOTOS_E_DUPLICATE = -3,   /* the device ID, or a birth metric, is already there */
    IOTOS_E_FULL = -4,        /* a compile-time limit would be exceeded */
    IOTOS_E_TOO_LARGE = -5,   /* the message would exceed IOTOS_TX_BUFFER or the transport */
    IOTOS_E_OFFLINE = -6,     /* not connected, or the host application is offline */
    IOTOS_E_CLOCK = -7,       /* the clock is not valid yet */
    IOTOS_E_TRANSPORT = -8,   /* the network port reported an error */
    IOTOS_E_AUTH = -9         /* the broker refused the credentials */
} iotos_status;

/* Sparkplug B datatypes the SDK writes and accepts; the values are Sparkplug's. */
typedef enum {
    IOTOS_INT8 = 1,
    IOTOS_INT16 = 2,
    IOTOS_INT32 = 3,
    IOTOS_INT64 = 4,
    IOTOS_UINT8 = 5,
    IOTOS_UINT16 = 6,
    IOTOS_UINT32 = 7,
    IOTOS_UINT64 = 8,
    IOTOS_FLOAT = 9,
    IOTOS_DOUBLE = 10,
    IOTOS_BOOLEAN = 11,
    IOTOS_STRING = 12,
    IOTOS_DATETIME = 13,
    IOTOS_BYTES = 17
} iotos_datatype;

/* One metric of a device type. Kits generate these from published device profiles. */
typedef struct {
    const char *name;
    iotos_datatype datatype;
    const char *unit; /* NULL when the parameter has none */
    bool writable;    /* accepts commands */
} iotos_metric_def;

/* A device type, shared by every device of that profile. The metric index is part of
 * each metric's alias, so the order must not change for a published revision. */
typedef struct {
    const char *code;
    uint32_t profile_revision;
    const iotos_metric_def *metrics;
    uint16_t metric_count;
} iotos_device_type;

/* A command value. Strings are NUL-terminated; strings and bytes stay valid only during
 * the callback. */
typedef struct {
    iotos_datatype datatype;
    bool is_null;
    union {
        bool boolean;
        int64_t i64;     /* Int8 to Int64 */
        uint64_t u64;    /* UInt8 to UInt64 */
        double number;   /* Float and Double */
        uint64_t utc_ms; /* DateTime */
        const char *string;
        struct {
            const uint8_t *data;
            size_t length;
        } bytes;
    } as;
} iotos_value;

/* Connection and identity, from the kit's generated iotos_settings.c. */
typedef struct {
    const char *broker_host;
    uint16_t broker_port;
    const char *group_id, *edge_node_id, *host_id;
    const char *username; /* also the MQTT client ID */
    const char *password, *ca_pem;
    const iotos_device_type *node_type; /* the node's metrics: gateway health, or a direct device's profile */
} iotos_settings;

/* What on_event reports. The detail is an iotos_status. */
typedef enum {
    IOTOS_EVENT_CONNECTED,         /* the broker accepted the session */
    IOTOS_EVENT_CONNECT_FAILED,    /* detail IOTOS_E_TRANSPORT */
    IOTOS_EVENT_AUTH_FAILED,       /* detail IOTOS_E_AUTH: check the kit's credentials */
    IOTOS_EVENT_DISCONNECTED,      /* detail IOTOS_E_TRANSPORT */
    IOTOS_EVENT_SESSION_TAKEOVER,  /* the broker keeps closing new connections: another client uses these credentials */
    IOTOS_EVENT_HOST_ONLINE,       /* births start */
    IOTOS_EVENT_HOST_OFFLINE,      /* publishing pauses until the host is back */
    IOTOS_EVENT_REBIRTH,           /* the host asked for every birth again */
    IOTOS_EVENT_ONLINE,            /* the node birth was sent */
    IOTOS_EVENT_CLOCK_INVALID,     /* detail IOTOS_E_CLOCK: births wait for a valid clock */
    IOTOS_EVENT_BIRTH_FAILED,      /* detail IOTOS_E_TOO_LARGE, or the port's refusal: the log names the device type */
    IOTOS_EVENT_COMMAND_REJECTED   /* detail IOTOS_E_INVALID or IOTOS_E_OFFLINE: the log says why */
} iotos_event;

/* Reported through iotos_set_connection and the connection_type health metric. */
typedef enum {
    IOTOS_CONN_ETHERNET,
    IOTOS_CONN_WIFI,
    IOTOS_CONN_CELLULAR,
    IOTOS_CONN_OTHER
} iotos_connection_type;

typedef enum {
    IOTOS_LOG_ERROR,
    IOTOS_LOG_WARN,
    IOTOS_LOG_INFO,
    IOTOS_LOG_DEBUG
} iotos_log_level;

#ifdef __cplusplus
}
#endif

#endif
