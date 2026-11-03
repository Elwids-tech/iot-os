/* SPDX-License-Identifier: MIT */
/* Writers: datatypes, ranges, timestamps, pending births and the transmit buffer. */
#include <math.h>
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

static const decoded *payload(size_t index)
{
    TEST_ASSERT_TRUE(index < h.mqtt.published.count);
    TEST_ASSERT_TRUE(decode_payload(h.mqtt.published.items[index].data, h.mqtt.published.items[index].length, &d));
    return &d;
}

static const char *topic(size_t index)
{
    TEST_ASSERT_TRUE(index < h.mqtt.published.count);
    return h.mqtt.published.items[index].topic;
}

static iotos_status publish_flow(const char *id, double flow)
{
    iotos_writer *w;
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_begin(&h.gw, id, &w));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_put_double(w, "flow_rate", flow));
    return iotos_commit(w);
}

static void test_a_pending_birth_refuses_publishes(void)
{
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_device_add(&h.gw, "meter-1", &meter_type));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_start(&h.gw));
    harness_poll(&h, 1, 0);
    TEST_ASSERT_EQUAL(IOTOS_PENDING_BIRTH, publish_flow("meter-1", 1.0));
    TEST_ASSERT_EQUAL_size_t(0, h.mqtt.published.count);
}

static void test_offline_then_publish_gives_ddeath_dbirth_ddata(void)
{
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_device_add(&h.gw, "meter-1", &meter_type));
    harness_online(&h);
    fake_messages_clear(&h.mqtt.published);
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_device_offline(&h.gw, "meter-1"));
    h.meter_flow = 99.0;
    TEST_ASSERT_EQUAL(IOTOS_PENDING_BIRTH, publish_flow("meter-1", 99.0));
    TEST_ASSERT_EQUAL_size_t(1, h.mqtt.published.count); /* only the DDEATH */
    harness_poll(&h, 2, 100);
    TEST_ASSERT_EQUAL_size_t(2, h.mqtt.published.count);
    TEST_ASSERT_NOT_NULL(strstr(topic(0), "/DDEATH/"));
    TEST_ASSERT_NOT_NULL(strstr(topic(1), "/DBIRTH/"));
    TEST_ASSERT_EQUAL_DOUBLE(99.0, decoded_find(payload(1), "flow_rate")->number);
    TEST_ASSERT_EQUAL(IOTOS_OK, publish_flow("meter-1", 100.0));
    TEST_ASSERT_EQUAL_size_t(3, h.mqtt.published.count);
    TEST_ASSERT_NOT_NULL(strstr(topic(2), "/DDATA/"));
}

static void test_unfilled_birth_metrics_are_nulls_with_their_datatype(void)
{
    const decoded_metric *m;
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_device_add(&h.gw, "meter-1", &meter_type));
    harness_online(&h);
    payload(1);
    TEST_ASSERT_EQUAL_size_t(3, d.count);
    m = decoded_find(&d, "total_volume");
    TEST_ASSERT_NOT_NULL(m);
    TEST_ASSERT_TRUE(m->is_null);
    TEST_ASSERT_EQUAL_UINT32(IOTOS_DOUBLE, m->datatype);
    TEST_ASSERT_TRUE(m->has_alias);
    TEST_ASSERT_EQUAL_UINT64((1ull << 16) | 1u, m->alias);
    TEST_ASSERT_FALSE(decoded_find(&d, "flow_rate")->is_null);
}

static void test_datatype_and_range_errors(void)
{
    iotos_writer *w;
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_device_add(&h.gw, "light-1", &light_type));
    harness_online(&h);
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_begin(&h.gw, "light-1", &w));
    TEST_ASSERT_EQUAL(IOTOS_E_INVALID, iotos_put_double(w, "on", 1.0));
    TEST_ASSERT_EQUAL(IOTOS_E_INVALID, iotos_put_bool(w, "Brightness", true));
    TEST_ASSERT_EQUAL(IOTOS_E_INVALID, iotos_put_i64(w, "Brightness", 2147483648LL));
    TEST_ASSERT_EQUAL(IOTOS_E_INVALID, iotos_put_u64(w, "Brightness", 1ull << 40));
    TEST_ASSERT_EQUAL(IOTOS_E_INVALID, iotos_put_double(w, "scale", NAN));
    TEST_ASSERT_EQUAL(IOTOS_E_INVALID, iotos_put_double(w, "scale", INFINITY));
    TEST_ASSERT_EQUAL(IOTOS_E_INVALID, iotos_put_string(w, "on", "yes"));
    TEST_ASSERT_EQUAL(IOTOS_E_INVALID, iotos_put_string(w, "mode", NULL));
    TEST_ASSERT_EQUAL(IOTOS_E_INVALID, iotos_put_bool(w, "no_such_metric", true));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_put_i64(w, "Brightness", -2147483648LL));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_put_u64(w, "scale", 3));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_commit(w));
    payload(h.mqtt.published.count - 1);
    TEST_ASSERT_EQUAL_size_t(2, d.count);
    TEST_ASSERT_EQUAL_UINT64((uint32_t)INT32_MIN, d.metrics[0].integer);
    TEST_ASSERT_EQUAL_DOUBLE(3.0, d.metrics[1].number);
    TEST_ASSERT_EQUAL(IOTOS_E_INVALID, iotos_begin(&h.gw, "no-such-device", &w));
}

static void test_put_at_timestamps_are_used(void)
{
    iotos_writer *w;
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_device_add(&h.gw, "meter-1", &meter_type));
    harness_online(&h);
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_begin(&h.gw, "meter-1", &w));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_put_double(w, "flow_rate", 1.0));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_put_at(w, TEST_TIME - 5000));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_put_double(w, "flow_rate", 2.0));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_put_double(w, "total_volume", 3.0));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_commit(w));
    payload(h.mqtt.published.count - 1);
    TEST_ASSERT_EQUAL_size_t(3, d.count);
    TEST_ASSERT_EQUAL_UINT64(fake_clock_utc(), d.metrics[0].timestamp);
    TEST_ASSERT_EQUAL_UINT64(TEST_TIME - 5000, d.metrics[1].timestamp);
    TEST_ASSERT_EQUAL_UINT64(TEST_TIME - 5000, d.metrics[2].timestamp);
}

static void test_an_invalid_clock_needs_put_at(void)
{
    iotos_writer *w;
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_device_add(&h.gw, "meter-1", &meter_type));
    harness_online(&h);
    fake_clock_set_valid(false);
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_begin(&h.gw, "meter-1", &w));
    TEST_ASSERT_EQUAL(IOTOS_E_CLOCK, iotos_put_double(w, "flow_rate", 1.0));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_put_at(w, TEST_TIME));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_put_double(w, "flow_rate", 1.0));
    iotos_abort(w);
    TEST_ASSERT_FALSE(fake_lock_held());
}

static void test_a_full_buffer_is_too_large_and_the_rest_still_sends(void)
{
    iotos_writer *w;
    iotos_status status = IOTOS_OK;
    int written = 0;
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_device_add(&h.gw, "meter-1", &meter_type));
    harness_online(&h);
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_begin(&h.gw, "meter-1", &w));
    while (status == IOTOS_OK) {
        status = iotos_put_double(w, "flow_rate", written);
        written += status == IOTOS_OK;
    }
    TEST_ASSERT_EQUAL(IOTOS_E_TOO_LARGE, status);
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_commit(w));
    payload(h.mqtt.published.count - 1);
    TEST_ASSERT_EQUAL_size_t((size_t)written, d.count);
    TEST_ASSERT_TRUE(h.mqtt.published.items[h.mqtt.published.count - 1].length <= IOTOS_TX_BUFFER);
}

static void test_node_data_waits_for_the_node_birth(void)
{
    iotos_writer *w;
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_start(&h.gw));
    harness_poll(&h, 1, 0);
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_begin(&h.gw, NULL, &w));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_put_string(w, IOTOS_HEALTH_FIRMWARE_VERSION, "x"));
    TEST_ASSERT_EQUAL(IOTOS_E_OFFLINE, iotos_commit(w));
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_a_pending_birth_refuses_publishes);
    RUN_TEST(test_offline_then_publish_gives_ddeath_dbirth_ddata);
    RUN_TEST(test_unfilled_birth_metrics_are_nulls_with_their_datatype);
    RUN_TEST(test_datatype_and_range_errors);
    RUN_TEST(test_put_at_timestamps_are_used);
    RUN_TEST(test_an_invalid_clock_needs_put_at);
    RUN_TEST(test_a_full_buffer_is_too_large_and_the_rest_still_sends);
    RUN_TEST(test_node_data_waits_for_the_node_birth);
    return UNITY_END();
}
