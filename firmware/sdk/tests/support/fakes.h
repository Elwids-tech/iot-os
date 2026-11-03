/* SPDX-License-Identifier: MIT */
/* Test doubles for every port, and a payload decoder for assertions. */
#ifndef IOTOS_TEST_FAKES_H
#define IOTOS_TEST_FAKES_H

#include "iotos/iotos.h"

/* Clock: UTC and monotonic time move together under the test's control. */
extern const iotos_clock_port fake_clock;
void fake_clock_reset(uint64_t utc_ms, bool valid);
void fake_clock_advance(uint32_t ms);
void fake_clock_set_valid(bool valid);
uint64_t fake_clock_utc(void);

/* Storage: an in-memory key-value store that survives iotos_init. */
extern const iotos_storage_port fake_storage;
void fake_storage_reset(void);
bool fake_storage_byte(const char *key, uint8_t *value);

/* Lock: non-recursive; taking it twice, or releasing it unheld, fails the test. */
extern const iotos_lock_port fake_lock;
void fake_lock_reset(void);
bool fake_lock_held(void);

/* Log: keeps the last lines. */
extern const iotos_log_port fake_log;
void fake_log_reset(void);
bool fake_log_contains(const char *text);

/* A recorded message. */
typedef struct {
    char topic[IOTOS_TOPIC_MAX];
    uint8_t *data;
    size_t length;
    uint8_t qos;
    bool retain;
} fake_message;

typedef struct {
    fake_message *items;
    size_t count, capacity;
} fake_messages;
void fake_messages_add(fake_messages *list, const char *topic, size_t topic_length, const uint8_t *data,
                       size_t length, uint8_t qos, bool retain);
void fake_messages_clear(fake_messages *list);
/* The index of the first message whose topic contains text, from start; -1 if none. */
long fake_messages_find(const fake_messages *list, const char *text, size_t start);

/* Level 2 port: records what the SDK does and delivers injected messages from poll. */
typedef struct {
    iotos_gateway *gw;
    iotos_status connect_result;
    iotos_status publish_result;
    iotos_status poll_result; /* returned after delivering the queued inbound messages */
    const char *fail_topic;    /* publishes whose topic contains this return fail_result */
    iotos_status fail_result;
    bool deliver_on_connect;   /* hand queued inbound messages over during connect */
    size_t max_payload;
    int connects, disconnects;
    char will_topic[IOTOS_TOPIC_MAX];
    uint8_t will[256];
    size_t will_length;
    iotos_mqtt_connect last_connect;
    char subscriptions[8][IOTOS_TOPIC_MAX];
    uint8_t subscription_qos[8];
    int subscription_count;
    fake_messages published;
    fake_messages inbound;
    /* Called after each publish, to drive scripted behaviour. */
    void (*after_publish)(void *ctx, const fake_message *message);
    void *after_ctx;
} fake_mqtt;
void fake_mqtt_init(fake_mqtt *fake, iotos_mqtt_port *port);
void fake_mqtt_free(fake_mqtt *fake);
void fake_mqtt_inject(fake_mqtt *fake, const char *topic, const uint8_t *data, size_t length, bool retained);
void fake_mqtt_state(fake_mqtt *fake, bool online); /* retained STATE for the test host */

/* Level 1 port: a scripted broker that speaks MQTT bytes. */
typedef struct {
    bool refuse_tcp;
    bool silent;            /* never answers CONNECT */
    uint32_t connect_delay_ms; /* the TCP and TLS part takes this long */
    uint32_t recv_tick_ms;  /* each empty recv lets this much time pass */
    uint8_t connack_code;
    size_t send_chunk, recv_chunk; /* partial I/O: at most this many bytes per call (0 = all) */
    bool open;
    int connects, pings, disconnects;
    /* The client's CONNECT, decoded */
    char client_id[128], username[128], password[128];
    uint16_t keepalive;
    bool clean_session, will_flag, will_retain;
    uint8_t will_qos;
    char will_topic[IOTOS_TOPIC_MAX];
    uint8_t will[256];
    size_t will_length;
    char subscriptions[8][IOTOS_TOPIC_MAX];
    uint8_t subscription_qos[8];
    int subscription_count;
    fake_messages published;
    uint8_t in[16384];
    size_t in_length;
    uint8_t out[16384];
    size_t out_length, out_offset;
} fake_stream;
void fake_stream_init(fake_stream *fake, iotos_stream_port *port);
void fake_stream_free(fake_stream *fake);
void fake_stream_publish(fake_stream *fake, const char *topic, const uint8_t *data, size_t length, bool retain);
void fake_stream_state(fake_stream *fake, bool online);
void fake_stream_drop(fake_stream *fake); /* the broker closes the connection */

/* Decoding recorded payloads. */
typedef struct {
    char name[64];
    bool has_name, has_alias, has_timestamp, has_datatype, is_null;
    uint64_t alias, timestamp;
    uint32_t datatype;
    uint8_t value_field;
    uint64_t integer;
    double number;
    char text[256];
    size_t length;
} decoded_metric;

typedef struct {
    bool has_timestamp, has_seq;
    uint64_t timestamp, seq;
    size_t count;
    decoded_metric metrics[256];
} decoded;

bool decode_payload(const uint8_t *data, size_t length, decoded *out);
const decoded_metric *decoded_find(const decoded *d, const char *name);
const decoded_metric *decoded_alias(const decoded *d, uint64_t alias);

#define TEST_HOST "host-1"
#define TEST_GROUP "group-1"
#define TEST_EDGE "edge-1"
#define TEST_TIME 1712345000000ull

#endif
