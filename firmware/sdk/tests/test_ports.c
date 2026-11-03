/* SPDX-License-Identifier: MIT */
/* One scripted session over both port levels: the messages must be identical. */
#include <string.h>

#include "harness.h"
#include "unity.h"

static harness stream_run, mqtt_run;

void setUp(void) {}
void tearDown(void) {}

static void script(harness *h)
{
    iotos_writer *w;
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_device_add(&h->gw, "meter-1", &meter_type));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_device_add(&h->gw, "light-1", &light_type));
    harness_online(h);
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_begin(&h->gw, "meter-1", &w));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_put_double(w, "flow_rate", 4.5));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_commit(w));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_device_offline(&h->gw, "light-1"));
    harness_poll(h, 3, 100);
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_stop(&h->gw));
}

static void test_both_levels_send_the_same_messages(void)
{
    fake_messages *a, *b;
    fake_storage_reset();
    harness_init(&stream_run, true);
    script(&stream_run);
    fake_storage_reset();
    harness_init(&mqtt_run, false);
    script(&mqtt_run);
    a = harness_published(&stream_run);
    b = harness_published(&mqtt_run);
    TEST_ASSERT_EQUAL_size_t(6, b->count); /* NBIRTH, 2 DBIRTH, DDATA, DDEATH, NDEATH */
    TEST_ASSERT_EQUAL_size_t(b->count, a->count);
    for (size_t i = 0; i < a->count; i++) {
        TEST_ASSERT_EQUAL_STRING(b->items[i].topic, a->items[i].topic);
        TEST_ASSERT_EQUAL_size_t(b->items[i].length, a->items[i].length);
        TEST_ASSERT_EQUAL_MEMORY(b->items[i].data, a->items[i].data, a->items[i].length);
        TEST_ASSERT_EQUAL_UINT8(b->items[i].qos, a->items[i].qos);
        TEST_ASSERT_EQUAL(b->items[i].retain, a->items[i].retain);
    }
    TEST_ASSERT_EQUAL_STRING(mqtt_run.mqtt.will_topic, stream_run.stream.will_topic);
    TEST_ASSERT_EQUAL_MEMORY(mqtt_run.mqtt.will, stream_run.stream.will, mqtt_run.mqtt.will_length);
    harness_free(&stream_run);
    harness_free(&mqtt_run);
}

static void test_a_birth_larger_than_the_transport_names_the_type(void)
{
    fake_storage_reset();
    harness_init(&mqtt_run, false);
    mqtt_run.mqtt_port.max_payload = 120;
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_init(&mqtt_run.gw, &mqtt_run.settings, &mqtt_run.ports, &mqtt_run.callbacks));
    mqtt_run.settings.node_type = NULL;
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_register_type(&mqtt_run.gw, &light_type));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_device_add(&mqtt_run.gw, "light-1", &light_type));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_start(&mqtt_run.gw));
    harness_poll(&mqtt_run, 1, 0);
    harness_state(&mqtt_run, true);
    harness_poll(&mqtt_run, 5, 100);
    TEST_ASSERT_TRUE(harness_has_event(&mqtt_run, IOTOS_EVENT_BIRTH_FAILED));
    TEST_ASSERT_TRUE(fake_log_contains("light"));
    TEST_ASSERT_EQUAL_size_t(1, mqtt_run.mqtt.published.count); /* the small NBIRTH only */
    harness_free(&mqtt_run);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_both_levels_send_the_same_messages);
    RUN_TEST(test_a_birth_larger_than_the_transport_names_the_type);
    return UNITY_END();
}
