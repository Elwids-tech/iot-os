/* SPDX-License-Identifier: MIT */
/*
 * The integrator's side of the SDK. ports/templates/ has an annotated template for
 * each port, and ports/posix/ a working desktop set.
 *
 * Port structures only ever gain members at the end, and a NULL function means the
 * port does not offer it. Write ports with designated initialisers
 * (.connect = my_connect, ...) and they keep compiling when a later version adds an
 * optional member.
 */
#ifndef IOTOS_PORTS_H
#define IOTOS_PORTS_H

#include "iotos_types.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Level 1: a TLS byte stream. The SDK runs MQTT over it. */
typedef struct {
    /* Open a TCP connection and complete a TLS handshake that verifies the broker
     * against ca_pem and host. IOTOS_OK, or IOTOS_E_TRANSPORT. */
    iotos_status (*connect)(void *ctx, const char *host, uint16_t port, const char *ca_pem,
                            uint32_t timeout_ms);
    /* Bytes sent (possibly fewer than len), 0 if nothing could be sent yet, <0 on error. */
    int32_t (*send)(void *ctx, const uint8_t *data, size_t len);
    /* Bytes read, 0 if nothing arrived within a short wait (tens of ms), <0 on error. */
    int32_t (*recv)(void *ctx, uint8_t *data, size_t len);
    void (*close)(void *ctx);
    void *ctx;
} iotos_stream_port;

/* Everything a level 2 port needs to open the MQTT session. */
typedef struct {
    const char *host;
    uint16_t port;
    const char *ca_pem;
    const char *client_id, *username, *password;
    uint16_t keepalive_s;
    bool clean_session;
    const char *will_topic;
    const uint8_t *will_payload;
    size_t will_length;
    uint8_t will_qos;
    bool will_retain;
    uint32_t timeout_ms;
} iotos_mqtt_connect;

/* Level 2: the modem runs MQTT (and TLS) itself. */
typedef struct {
    /* IOTOS_OK, IOTOS_E_AUTH when the broker refuses the credentials, or IOTOS_E_TRANSPORT. */
    iotos_status (*connect)(void *ctx, const iotos_mqtt_connect *opts);
    iotos_status (*publish)(void *ctx, const char *topic, const uint8_t *data, size_t len,
                            uint8_t qos, bool retain);
    iotos_status (*subscribe)(void *ctx, const char *filter, uint8_t qos);
    /* Handle the modem for up to budget_ms, handing each received message to
     * iotos_mqtt_inbound. IOTOS_E_TRANSPORT when the session is lost. */
    iotos_status (*poll)(void *ctx, uint32_t budget_ms);
    void (*disconnect)(void *ctx);
    size_t max_payload; /* largest publish the modem accepts; 0 = unlimited */
    void *ctx;
} iotos_mqtt_port;

typedef struct {
    /* UTC milliseconds. *valid is false until the time is set (SNTP, network time). */
    uint64_t (*now_ms)(void *ctx, bool *valid);
    /* Milliseconds from any fixed point, never going backwards, wrapping at 2^32. Used
     * for intervals, and handed to the MQTT client, which takes no context. */
    uint32_t (*monotonic_ms)(void);
    void *ctx;
} iotos_clock_port;

/* Optional. Without it bdSeq lives in RAM and starts again after a reboot. */
typedef struct {
    /* Copy exactly len bytes stored under key into out; false if there are none. */
    bool (*load)(void *ctx, const char *key, void *out, size_t len);
    /* Store len bytes under key, atomically; false on failure. */
    bool (*save)(void *ctx, const char *key, const void *data, size_t len);
    void *ctx;
} iotos_storage_port;

/* Optional. Messages are short, complete sentences without a trailing newline. */
typedef struct {
    void (*write)(void *ctx, iotos_log_level level, const char *message);
    void *ctx;
} iotos_log_port;

/* Optional for single-task builds. A plain, non-recursive mutex is enough: the SDK
 * never takes it twice from one task. */
typedef struct {
    void (*lock)(void *ctx);
    void (*unlock)(void *ctx);
    void *ctx;
} iotos_lock_port;

typedef struct {
    const iotos_stream_port *stream; /* exactly one of stream or mqtt */
    const iotos_mqtt_port *mqtt;
    const iotos_clock_port *clock;
    const iotos_storage_port *storage; /* optional */
    const iotos_log_port *log;         /* optional */
    const iotos_lock_port *lock;       /* optional for single-task builds */
} iotos_ports;

#ifdef __cplusplus
}
#endif

#endif
