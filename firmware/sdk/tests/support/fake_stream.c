/* SPDX-License-Identifier: MIT */
/*
 * A scripted MQTT 3.1.1 broker behind a level 1 port. It decodes what the client sends
 * (CONNECT, SUBSCRIBE, PUBLISH, PINGREQ, DISCONNECT) and answers with bytes, so the
 * SDK's real MQTT client runs against it.
 */
#include <stdio.h>
#include <string.h>

#include "fakes.h"
#include "unity.h"

static void queue(fake_stream *f, const uint8_t *data, size_t length)
{
    TEST_ASSERT_TRUE(f->out_length + length <= sizeof(f->out));
    memcpy(f->out + f->out_length, data, length);
    f->out_length += length;
}

static size_t encode_length(uint8_t *out, size_t value)
{
    size_t n = 0;
    do {
        uint8_t byte = (uint8_t)(value % 128u);
        value /= 128u;
        out[n++] = (uint8_t)(byte | (value ? 0x80u : 0));
    } while (value);
    return n;
}

/* Reads a two-byte length and that many bytes; false past the end. */
static bool field(const uint8_t *p, size_t end, size_t *at, const uint8_t **data, size_t *length)
{
    if (*at + 2 > end) {
        return false;
    }
    *length = (size_t)p[*at] << 8 | p[*at + 1];
    *at += 2;
    if (*at + *length > end) {
        return false;
    }
    *data = p + *at;
    *at += *length;
    return true;
}

static void copy_text(char *out, size_t size, const uint8_t *data, size_t length)
{
    TEST_ASSERT_TRUE(length < size);
    memcpy(out, data, length);
    out[length] = '\0';
}

static void handle(fake_stream *f, uint8_t type, const uint8_t *p, size_t length)
{
    size_t at = 0;
    const uint8_t *data;
    size_t size;
    switch (type >> 4) {
    case 1: { /* CONNECT */
        uint8_t flags;
        uint8_t connack[4] = {0x20, 0x02, 0x00, f->connack_code};
        TEST_ASSERT_TRUE(field(p, length, &at, &data, &size));
        TEST_ASSERT_EQUAL_MEMORY("MQTT", data, 4);
        TEST_ASSERT_EQUAL_UINT8(4, p[at]); /* MQTT 3.1.1 */
        flags = p[at + 1];
        f->keepalive = (uint16_t)(p[at + 2] << 8 | p[at + 3]);
        at += 4;
        f->clean_session = flags & 0x02u;
        f->will_flag = flags & 0x04u;
        f->will_qos = (flags >> 3) & 3u;
        f->will_retain = flags & 0x20u;
        TEST_ASSERT_TRUE(field(p, length, &at, &data, &size));
        copy_text(f->client_id, sizeof(f->client_id), data, size);
        if (f->will_flag) {
            TEST_ASSERT_TRUE(field(p, length, &at, &data, &size));
            copy_text(f->will_topic, sizeof(f->will_topic), data, size);
            TEST_ASSERT_TRUE(field(p, length, &at, &data, &size));
            TEST_ASSERT_TRUE(size <= sizeof(f->will));
            memcpy(f->will, data, size);
            f->will_length = size;
        }
        if (flags & 0x80u) {
            TEST_ASSERT_TRUE(field(p, length, &at, &data, &size));
            copy_text(f->username, sizeof(f->username), data, size);
        }
        if (flags & 0x40u) {
            TEST_ASSERT_TRUE(field(p, length, &at, &data, &size));
            copy_text(f->password, sizeof(f->password), data, size);
        }
        if (!f->silent) {
            queue(f, connack, sizeof(connack));
        }
        break;
    }
    case 3: { /* PUBLISH */
        uint8_t qos = (type >> 1) & 3u;
        TEST_ASSERT_TRUE(field(p, length, &at, &data, &size));
        if (qos) {
            at += 2;
        }
        fake_messages_add(&f->published, (const char *)data, size, p + at, length - at, qos, type & 1u);
        break;
    }
    case 8: { /* SUBSCRIBE */
        uint8_t suback[16] = {0x90, 0, p[0], p[1]};
        size_t count = 0;
        at = 2;
        while (at < length) {
            TEST_ASSERT_TRUE(field(p, length, &at, &data, &size));
            TEST_ASSERT_TRUE(f->subscription_count < 8);
            copy_text(f->subscriptions[f->subscription_count], IOTOS_TOPIC_MAX, data, size);
            f->subscription_qos[f->subscription_count++] = p[at++];
            suback[4 + count++] = 0;
        }
        suback[1] = (uint8_t)(2 + count);
        queue(f, suback, 4 + count);
        break;
    }
    case 12: { /* PINGREQ */
        uint8_t pingresp[2] = {0xD0, 0x00};
        f->pings++;
        queue(f, pingresp, 2);
        break;
    }
    case 14: /* DISCONNECT */
        f->disconnects++;
        f->open = false;
        break;
    default:
        TEST_FAIL_MESSAGE("unexpected packet from the client");
    }
}

static void parse(fake_stream *f)
{
    for (;;) {
        size_t value = 0, multiplier = 1, at = 1;
        uint8_t byte;
        if (f->in_length < 2) {
            return;
        }
        do {
            if (at >= f->in_length) {
                return;
            }
            byte = f->in[at++];
            value += (byte & 0x7fu) * multiplier;
            multiplier *= 128u;
        } while (byte & 0x80u);
        if (at + value > f->in_length) {
            return;
        }
        handle(f, f->in[0], f->in + at, value);
        memmove(f->in, f->in + at + value, f->in_length - at - value);
        f->in_length -= at + value;
    }
}

static iotos_status fake_connect(void *ctx, const char *host, uint16_t port, const char *ca_pem, uint32_t timeout_ms)
{
    fake_stream *f = (fake_stream *)ctx;
    (void)host;
    (void)port;
    (void)ca_pem;
    (void)timeout_ms;
    f->connects++;
    fake_clock_advance(f->connect_delay_ms);
    if (f->refuse_tcp) {
        return IOTOS_E_TRANSPORT;
    }
    f->open = true;
    f->in_length = f->out_length = f->out_offset = 0;
    f->subscription_count = 0;
    return IOTOS_OK;
}

static int32_t fake_send(void *ctx, const uint8_t *data, size_t len)
{
    fake_stream *f = (fake_stream *)ctx;
    size_t n = f->send_chunk && len > f->send_chunk ? f->send_chunk : len;
    if (!f->open) {
        return -1;
    }
    TEST_ASSERT_TRUE(f->in_length + n <= sizeof(f->in));
    memcpy(f->in + f->in_length, data, n);
    f->in_length += n;
    parse(f);
    return (int32_t)n;
}

static int32_t fake_recv(void *ctx, uint8_t *data, size_t len)
{
    fake_stream *f = (fake_stream *)ctx;
    size_t pending = f->out_length - f->out_offset;
    size_t n = len < pending ? len : pending;
    if (!f->open) {
        return -1;
    }
    if (f->recv_chunk && n > f->recv_chunk) {
        n = f->recv_chunk;
    }
    if (!n) {
        fake_clock_advance(f->recv_tick_ms);
    }
    memcpy(data, f->out + f->out_offset, n);
    f->out_offset += n;
    if (f->out_offset == f->out_length) {
        f->out_offset = f->out_length = 0;
    }
    return (int32_t)n;
}

static void fake_close(void *ctx)
{
    ((fake_stream *)ctx)->open = false;
}

void fake_stream_init(fake_stream *fake, iotos_stream_port *port)
{
    memset(fake, 0, sizeof(*fake));
    memset(port, 0, sizeof(*port));
    port->connect = fake_connect;
    port->send = fake_send;
    port->recv = fake_recv;
    port->close = fake_close;
    port->ctx = fake;
}

void fake_stream_free(fake_stream *fake)
{
    fake_messages_clear(&fake->published);
}

void fake_stream_publish(fake_stream *fake, const char *topic, const uint8_t *data, size_t length, bool retain)
{
    uint8_t header[8];
    size_t topic_length = strlen(topic);
    size_t n;
    header[0] = (uint8_t)(0x30u | (retain ? 1u : 0u));
    n = 1 + encode_length(header + 1, 2 + topic_length + length);
    header[n++] = (uint8_t)(topic_length >> 8);
    header[n++] = (uint8_t)topic_length;
    queue(fake, header, n);
    queue(fake, (const uint8_t *)topic, topic_length);
    queue(fake, data, length);
}

void fake_stream_state(fake_stream *fake, bool online)
{
    char payload[64];
    snprintf(payload, sizeof(payload), "{\"online\":%s,\"timestamp\":%llu}", online ? "true" : "false",
             (unsigned long long)fake_clock_utc());
    fake_stream_publish(fake, "spBv1.0/STATE/" TEST_HOST, (const uint8_t *)payload, strlen(payload), true);
}

void fake_stream_drop(fake_stream *fake)
{
    fake->open = false;
}
