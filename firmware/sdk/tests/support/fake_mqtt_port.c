/* SPDX-License-Identifier: MIT */
/* A level 2 port that records everything and delivers injected messages from poll. */
#include <stdio.h>
#include <string.h>

#include "fakes.h"
#include "unity.h"

static iotos_status fake_connect(void *ctx, const iotos_mqtt_connect *opts)
{
    fake_mqtt *f = (fake_mqtt *)ctx;
    f->connects++;
    f->last_connect = *opts;
    TEST_ASSERT_TRUE(strlen(opts->will_topic) < sizeof(f->will_topic));
    TEST_ASSERT_TRUE(opts->will_length <= sizeof(f->will));
    strcpy(f->will_topic, opts->will_topic);
    memcpy(f->will, opts->will_payload, opts->will_length);
    f->will_length = opts->will_length;
    f->last_connect.will_topic = f->will_topic;
    f->last_connect.will_payload = f->will;
    if (f->connect_result == IOTOS_OK) {
        f->subscription_count = 0;
    }
    if (f->deliver_on_connect) {
        fake_messages pending = f->inbound;
        memset(&f->inbound, 0, sizeof(f->inbound));
        for (size_t i = 0; i < pending.count; i++) {
            iotos_mqtt_inbound(f->gw, pending.items[i].topic, pending.items[i].data, pending.items[i].length,
                               pending.items[i].retain);
        }
        fake_messages_clear(&pending);
    }
    return f->connect_result;
}

static iotos_status fake_publish(void *ctx, const char *topic, const uint8_t *data, size_t len, uint8_t qos,
                                 bool retain)
{
    fake_mqtt *f = (fake_mqtt *)ctx;
    if (f->publish_result != IOTOS_OK) {
        return f->publish_result;
    }
    if (f->fail_topic && strstr(topic, f->fail_topic)) {
        return f->fail_result;
    }
    fake_messages_add(&f->published, topic, strlen(topic), data, len, qos, retain);
    if (f->after_publish) {
        f->after_publish(f->after_ctx, &f->published.items[f->published.count - 1]);
    }
    return IOTOS_OK;
}

static iotos_status fake_subscribe(void *ctx, const char *filter, uint8_t qos)
{
    fake_mqtt *f = (fake_mqtt *)ctx;
    TEST_ASSERT_TRUE(f->subscription_count < 8);
    strcpy(f->subscriptions[f->subscription_count], filter);
    f->subscription_qos[f->subscription_count] = qos;
    f->subscription_count++;
    return IOTOS_OK;
}

static iotos_status fake_poll(void *ctx, uint32_t budget_ms)
{
    fake_mqtt *f = (fake_mqtt *)ctx;
    fake_messages pending = f->inbound;
    (void)budget_ms;
    memset(&f->inbound, 0, sizeof(f->inbound));
    for (size_t i = 0; i < pending.count; i++) {
        fake_message *m = &pending.items[i];
        iotos_mqtt_inbound(f->gw, m->topic, m->data, m->length, m->retain);
    }
    fake_messages_clear(&pending);
    return f->poll_result;
}

static void fake_disconnect(void *ctx)
{
    ((fake_mqtt *)ctx)->disconnects++;
}

void fake_mqtt_init(fake_mqtt *fake, iotos_mqtt_port *port)
{
    memset(fake, 0, sizeof(*fake));
    memset(port, 0, sizeof(*port));
    port->connect = fake_connect;
    port->publish = fake_publish;
    port->subscribe = fake_subscribe;
    port->poll = fake_poll;
    port->disconnect = fake_disconnect;
    port->ctx = fake;
}

void fake_mqtt_free(fake_mqtt *fake)
{
    fake_messages_clear(&fake->published);
    fake_messages_clear(&fake->inbound);
}

void fake_mqtt_inject(fake_mqtt *fake, const char *topic, const uint8_t *data, size_t length, bool retained)
{
    fake_messages_add(&fake->inbound, topic, strlen(topic), data, length, 0, retained);
}

void fake_mqtt_state(fake_mqtt *fake, bool online)
{
    char payload[64];
    snprintf(payload, sizeof(payload), "{\"online\":%s,\"timestamp\":%llu}", online ? "true" : "false",
             (unsigned long long)fake_clock_utc());
    fake_mqtt_inject(fake, "spBv1.0/STATE/" TEST_HOST, (const uint8_t *)payload, strlen(payload), true);
}
