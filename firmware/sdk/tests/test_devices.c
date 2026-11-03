/* SPDX-License-Identifier: MIT */
/* Device slots, limits, aliases and paced births for hundreds of devices. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "harness.h"
#include "unity.h"

static harness h;
static decoded d;

void setUp(void)
{
    fake_storage_reset();
    harness_init(&h, false);
}

void tearDown(void)
{
    harness_free(&h);
}

static void add_fleet(int meters, int lights)
{
    char id[32];
    for (int i = 0; i < meters; i++) {
        snprintf(id, sizeof(id), "meter-%03d", i);
        TEST_ASSERT_EQUAL(IOTOS_OK, iotos_device_add(&h.gw, id, &meter_type));
    }
    for (int i = 0; i < lights; i++) {
        snprintf(id, sizeof(id), "light-%03d", i);
        TEST_ASSERT_EQUAL(IOTOS_OK, iotos_device_add(&h.gw, id, &light_type));
    }
}

static void test_500_devices_are_born_in_order_at_the_configured_rate(void)
{
    char expected[96];
    uint32_t elapsed = 0;
    size_t births_in_second[64] = {0};
    size_t seen = 0;
    add_fleet(250, 250);
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_start(&h.gw));
    harness_poll(&h, 1, 0);
    harness_state(&h, true);
    while (h.mqtt.published.count < 501 && elapsed < 60000) {
        harness_poll(&h, 1, 50);
        elapsed += 50;
        while (seen < h.mqtt.published.count) {
            births_in_second[elapsed / 1000]++;
            seen++;
        }
    }
    TEST_ASSERT_EQUAL_size_t(501, h.mqtt.published.count);
    TEST_ASSERT_NOT_NULL(strstr(h.mqtt.published.items[0].topic, "/NBIRTH/"));
    for (size_t i = 1; i <= 500; i++) {
        const fake_message *m = &h.mqtt.published.items[i];
        if (i <= 250) {
            snprintf(expected, sizeof(expected), "spBv1.0/%s/DBIRTH/%s/meter-%03zu", TEST_GROUP, TEST_EDGE, i - 1);
        } else {
            snprintf(expected, sizeof(expected), "spBv1.0/%s/DBIRTH/%s/light-%03zu", TEST_GROUP, TEST_EDGE, i - 251);
        }
        TEST_ASSERT_EQUAL_STRING(expected, m->topic);
        TEST_ASSERT_TRUE(decode_payload(m->data, m->length, &d));
        TEST_ASSERT_EQUAL_UINT64(i % 256, d.seq);
    }
    for (size_t s = 0; s < 64; s++) {
        TEST_ASSERT_TRUE_MESSAGE(births_in_second[s] <= IOTOS_BIRTHS_PER_SECOND + 1, "births exceeded the rate");
    }
    TEST_ASSERT_TRUE(elapsed >= 24000 && elapsed <= 26500);
}

static int compare_alias(const void *a, const void *b)
{
    uint64_t x = *(const uint64_t *)a, y = *(const uint64_t *)b;
    return x < y ? -1 : x > y;
}

static void test_aliases_are_unique_across_the_node(void)
{
    static uint64_t aliases[4096];
    size_t count = 0;
    add_fleet(20, 20);
    harness_online(&h);
    for (size_t i = 0; i < h.mqtt.published.count; i++) {
        const fake_message *m = &h.mqtt.published.items[i];
        TEST_ASSERT_TRUE(decode_payload(m->data, m->length, &d));
        for (size_t j = 0; j < d.count; j++) {
            if (d.metrics[j].has_alias) {
                aliases[count++] = d.metrics[j].alias;
            }
        }
    }
    TEST_ASSERT_EQUAL_size_t(8 + 20 * 3 + 20 * 5, count);
    qsort(aliases, count, sizeof(aliases[0]), compare_alias);
    for (size_t i = 1; i < count; i++) {
        TEST_ASSERT_TRUE_MESSAGE(aliases[i] != aliases[i - 1], "duplicate alias");
    }
}

static void test_limits_and_errors_leave_other_devices_untouched(void)
{
    static iotos_metric_def many[IOTOS_MAX_METRICS_PER_TYPE + 1];
    static char names[IOTOS_MAX_METRICS_PER_TYPE + 1][8];
    static iotos_device_type extra[8];
    iotos_device_type too_many = {"too_many", 1, many, IOTOS_MAX_METRICS_PER_TYPE + 1};
    char id[32];
    for (int i = 0; i <= IOTOS_MAX_METRICS_PER_TYPE; i++) {
        snprintf(names[i], sizeof(names[i]), "m%d", i);
        many[i].name = names[i];
        many[i].datatype = IOTOS_DOUBLE;
    }
    TEST_ASSERT_EQUAL(IOTOS_E_FULL, iotos_register_type(&h.gw, &too_many));
    for (int i = 0; i < IOTOS_MAX_DEVICE_TYPES - 2; i++) {
        extra[i] = meter_type;
        TEST_ASSERT_EQUAL(IOTOS_OK, iotos_register_type(&h.gw, &extra[i]));
    }
    extra[7] = meter_type;
    TEST_ASSERT_EQUAL(IOTOS_E_FULL, iotos_register_type(&h.gw, &extra[7]));

    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_device_add(&h.gw, "meter-1", &meter_type));
    TEST_ASSERT_EQUAL(IOTOS_E_DUPLICATE, iotos_device_add(&h.gw, "meter-1", &meter_type));
    TEST_ASSERT_EQUAL(IOTOS_E_INVALID, iotos_device_add(&h.gw, "", &meter_type));
    TEST_ASSERT_EQUAL(IOTOS_E_INVALID, iotos_device_add(&h.gw, "has space", &meter_type));
    TEST_ASSERT_EQUAL(IOTOS_E_INVALID, iotos_device_add(&h.gw, "a/b", &meter_type));
    TEST_ASSERT_EQUAL(IOTOS_E_INVALID, iotos_device_add(&h.gw, "a+b", &meter_type));
    TEST_ASSERT_EQUAL(IOTOS_E_INVALID, iotos_device_add(&h.gw, "abcdefghijklmnopqrstuvwxy", &meter_type));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_device_add(&h.gw, "abcdefghijklmnopqrstuvwx", &meter_type));
    TEST_ASSERT_EQUAL(IOTOS_E_INVALID, iotos_device_add(&h.gw, "meter-2", &too_many));
    for (int i = 2; i < IOTOS_MAX_DEVICES; i++) {
        snprintf(id, sizeof(id), "dev-%d", i);
        TEST_ASSERT_EQUAL(IOTOS_OK, iotos_device_add(&h.gw, id, &light_type));
    }
    TEST_ASSERT_EQUAL(IOTOS_E_FULL, iotos_device_add(&h.gw, "one-too-many", &meter_type));
    TEST_ASSERT_EQUAL_UINT16(IOTOS_MAX_DEVICES, h.gw.device_count);
    TEST_ASSERT_EQUAL_STRING("meter-1", h.gw.devices[0].id);
}

static void test_offline_and_remove_send_ddeath(void)
{
    add_fleet(2, 0);
    harness_online(&h);
    fake_messages_clear(&h.mqtt.published);
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_device_offline(&h.gw, "meter-000"));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_device_remove(&h.gw, "meter-001"));
    TEST_ASSERT_EQUAL_size_t(2, h.mqtt.published.count);
    TEST_ASSERT_EQUAL_STRING("spBv1.0/" TEST_GROUP "/DDEATH/" TEST_EDGE "/meter-000", h.mqtt.published.items[0].topic);
    TEST_ASSERT_EQUAL_STRING("spBv1.0/" TEST_GROUP "/DDEATH/" TEST_EDGE "/meter-001", h.mqtt.published.items[1].topic);
    TEST_ASSERT_TRUE(decode_payload(h.mqtt.published.items[1].data, h.mqtt.published.items[1].length, &d));
    TEST_ASSERT_TRUE(d.has_seq);
    TEST_ASSERT_EQUAL_size_t(0, d.count);
    TEST_ASSERT_EQUAL(IOTOS_E_INVALID, iotos_device_offline(&h.gw, "meter-001"));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_device_add(&h.gw, "meter-001", &meter_type));
    TEST_ASSERT_EQUAL_UINT16(2, h.gw.device_count);
}

static void test_births_still_flow_after_25_days_online(void)
{
    add_fleet(1, 0);
    harness_online(&h);
    fake_clock_advance(25u * 24u * 3600u * 1000u); /* past 2^31 ms */
    harness_poll(&h, 1, 0);
    fake_messages_clear(&h.mqtt.published);
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_device_add(&h.gw, "meter-new", &meter_type));
    harness_poll(&h, 3, 100);
    TEST_ASSERT_TRUE(fake_messages_find(&h.mqtt.published, "/DBIRTH/" TEST_EDGE "/meter-new", 0) >= 0);
}

static void test_a_refused_device_birth_does_not_stall_the_others(void)
{
    size_t failed = 0;
    add_fleet(1, 1);
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_device_add(&h.gw, "meter-later", &meter_type));
    h.mqtt.fail_topic = "/DBIRTH/" TEST_EDGE "/light-000";
    h.mqtt.fail_result = IOTOS_E_INVALID;
    harness_online(&h);
    harness_poll(&h, 20, 100);
    TEST_ASSERT_TRUE(fake_messages_find(&h.mqtt.published, "/DBIRTH/" TEST_EDGE "/meter-later", 0) >= 0);
    TEST_ASSERT_EQUAL_UINT8(1 /* offline */, h.gw.devices[1].state);
    for (size_t i = 0; i < h.event_count; i++) {
        failed += h.events[i].event == IOTOS_EVENT_BIRTH_FAILED && h.events[i].detail == IOTOS_E_INVALID;
    }
    TEST_ASSERT_EQUAL_size_t(1, failed);
    TEST_ASSERT_TRUE(h.birth_calls <= 4);
}

static void test_a_refused_node_birth_is_reported_once(void)
{
    h.mqtt.fail_topic = "/NBIRTH/";
    h.mqtt.fail_result = IOTOS_E_INVALID;
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_start(&h.gw));
    harness_poll(&h, 1, 0);
    harness_state(&h, true);
    harness_poll(&h, 20, 100);
    TEST_ASSERT_FALSE(h.gw.node_born);
    TEST_ASSERT_EQUAL_size_t(1, harness_count_events(&h, IOTOS_EVENT_BIRTH_FAILED));
    TEST_ASSERT_EQUAL_size_t(1, h.birth_calls);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_500_devices_are_born_in_order_at_the_configured_rate);
    RUN_TEST(test_aliases_are_unique_across_the_node);
    RUN_TEST(test_limits_and_errors_leave_other_devices_untouched);
    RUN_TEST(test_offline_and_remove_send_ddeath);
    RUN_TEST(test_births_still_flow_after_25_days_online);
    RUN_TEST(test_a_refused_device_birth_does_not_stall_the_others);
    RUN_TEST(test_a_refused_node_birth_is_reported_once);
    return UNITY_END();
}
