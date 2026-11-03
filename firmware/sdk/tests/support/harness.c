/* SPDX-License-Identifier: MIT */
#include <string.h>

#include "harness.h"
#include "unity.h"

static const iotos_metric_def health_metrics[] = {
    {IOTOS_HEALTH_UPTIME, IOTOS_INT64, "s", false},
    {IOTOS_HEALTH_CONNECTION_TYPE, IOTOS_STRING, NULL, false},
    {IOTOS_HEALTH_SIGNAL_STRENGTH, IOTOS_DOUBLE, "dBm", false},
    {IOTOS_HEALTH_FIRMWARE_VERSION, IOTOS_STRING, NULL, false},
    {IOTOS_HEALTH_SDK_VERSION, IOTOS_STRING, NULL, false},
    {IOTOS_HEALTH_DEVICES_CONFIGURED, IOTOS_INT64, NULL, false},
    {IOTOS_HEALTH_DEVICES_ONLINE, IOTOS_INT64, NULL, false},
    {IOTOS_HEALTH_RECONNECTS, IOTOS_INT64, NULL, false},
};
const iotos_device_type health_type = {"gateway_health", 1, health_metrics, 8};

static const iotos_metric_def meter_metrics[] = {
    {"flow_rate", IOTOS_DOUBLE, "L/min", false},
    {"total_volume", IOTOS_DOUBLE, "L", false},
    {"valve_open", IOTOS_BOOLEAN, NULL, true},
};
const iotos_device_type meter_type = {"water_meter", 3, meter_metrics, 3};

static const iotos_metric_def light_metrics[] = {
    {"on", IOTOS_BOOLEAN, NULL, true},
    {"Brightness", IOTOS_INT32, "%", true},
    {"mode", IOTOS_STRING, NULL, true},
    {"scale", IOTOS_DOUBLE, NULL, true},
    {"label", IOTOS_STRING, NULL, false},
};
const iotos_device_type light_type = {"light", 2, light_metrics, 5};

static void on_birth(void *ctx, const char *device_id, iotos_writer *w)
{
    harness *h = (harness *)ctx;
    h->birth_calls++;
    if (device_id && strncmp(device_id, "meter", 5) == 0) {
        TEST_ASSERT_EQUAL(IOTOS_OK, iotos_put_double(w, "flow_rate", h->meter_flow));
        TEST_ASSERT_EQUAL(IOTOS_OK, iotos_put_bool(w, "valve_open", true));
    }
}

static void on_command(void *ctx, const char *device_id, const char *metric, const iotos_value *value)
{
    harness *h = (harness *)ctx;
    recorded_command *c;
    TEST_ASSERT_FALSE_MESSAGE(fake_lock_held(), "on_command ran with the lock held");
    TEST_ASSERT_TRUE(h->command_count < 16);
    c = &h->commands[h->command_count++];
    memset(c, 0, sizeof(*c));
    c->node = device_id == NULL;
    if (device_id) {
        strcpy(c->device, device_id);
    }
    strcpy(c->metric, metric);
    c->value = *value;
    if (value->datatype == IOTOS_STRING) {
        strcpy(c->text, value->as.string);
    }
    if (h->stop_on_command) {
        TEST_ASSERT_EQUAL(IOTOS_OK, iotos_stop(&h->gw));
        return;
    }
    if (h->publish_on_command && device_id) {
        iotos_writer *w;
        TEST_ASSERT_EQUAL(IOTOS_OK, iotos_begin(&h->gw, device_id, &w));
        if (value->datatype == IOTOS_BOOLEAN) {
            TEST_ASSERT_EQUAL(IOTOS_OK, iotos_put_bool(w, metric, value->as.boolean));
        }
        h->command_publish_result = iotos_commit(w);
    }
}

static void on_event(void *ctx, iotos_event event, iotos_status detail)
{
    harness *h = (harness *)ctx;
    TEST_ASSERT_FALSE_MESSAGE(fake_lock_held(), "on_event ran with the lock held");
    if (h->event_count < 64) {
        h->events[h->event_count].event = event;
        h->events[h->event_count].detail = detail;
        h->event_count++;
    }
    if (h->on_event_extra) {
        h->on_event_extra(h, event);
    }
}

void harness_init(harness *h, bool stream)
{
    memset(h, 0, sizeof(*h));
    fake_clock_reset(TEST_TIME, true);
    fake_lock_reset();
    fake_log_reset();
    h->settings.broker_host = "mqtt.example.test";
    h->settings.broker_port = 8883;
    h->settings.group_id = TEST_GROUP;
    h->settings.edge_node_id = TEST_EDGE;
    h->settings.host_id = TEST_HOST;
    h->settings.username = "edge-user";
    h->settings.password = "not-a-real-password";
    h->settings.ca_pem = "-----BEGIN CERTIFICATE-----\n-----END CERTIFICATE-----\n";
    h->settings.node_type = &health_type;
    if (stream) {
        fake_stream_init(&h->stream, &h->stream_port);
        h->ports.stream = &h->stream_port;
    } else {
        fake_mqtt_init(&h->mqtt, &h->mqtt_port);
        h->ports.mqtt = &h->mqtt_port;
    }
    h->ports.clock = &fake_clock;
    h->ports.storage = &fake_storage;
    h->ports.lock = &fake_lock;
    h->ports.log = &fake_log;
    h->callbacks.on_birth = on_birth;
    h->callbacks.on_command = on_command;
    h->callbacks.on_event = on_event;
    h->callbacks.ctx = h;
    h->meter_flow = 12.5;
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_init(&h->gw, &h->settings, &h->ports, &h->callbacks));
    h->mqtt.gw = &h->gw;
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_register_type(&h->gw, &meter_type));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_register_type(&h->gw, &light_type));
}

void harness_free(harness *h)
{
    TEST_ASSERT_FALSE_MESSAGE(fake_lock_held(), "the lock is still held");
    fake_mqtt_free(&h->mqtt);
    fake_stream_free(&h->stream);
}

fake_messages *harness_published(harness *h)
{
    return h->ports.stream ? &h->stream.published : &h->mqtt.published;
}

void harness_state(harness *h, bool online)
{
    if (h->ports.stream) {
        fake_stream_state(&h->stream, online);
    } else {
        fake_mqtt_state(&h->mqtt, online);
    }
}

void harness_inject(harness *h, const char *topic, const uint8_t *data, size_t length, bool retained)
{
    if (h->ports.stream) {
        fake_stream_publish(&h->stream, topic, data, length, retained);
    } else {
        fake_mqtt_inject(&h->mqtt, topic, data, length, retained);
    }
}

void harness_poll(harness *h, int times, uint32_t step_ms)
{
    for (int i = 0; i < times; i++) {
        TEST_ASSERT_EQUAL(IOTOS_OK, iotos_poll(&h->gw, 10));
        TEST_ASSERT_FALSE(fake_lock_held());
        fake_clock_advance(step_ms);
    }
}

void harness_online(harness *h)
{
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_start(&h->gw));
    harness_poll(h, 1, 0); /* connects and subscribes */
    harness_state(h, true);
    for (int i = 0; i < 100000 && (h->gw.node_birth_pending || !h->gw.node_born || h->gw.state != 4); i++) {
        harness_poll(h, 1, 50);
    }
    TEST_ASSERT_TRUE(h->gw.node_born);
}

bool harness_has_event(const harness *h, iotos_event event)
{
    return harness_count_events(h, event) > 0;
}

size_t harness_count_events(const harness *h, iotos_event event)
{
    size_t n = 0;
    for (size_t i = 0; i < h->event_count; i++) {
        if (h->events[i].event == event) {
            n++;
        }
    }
    return n;
}
