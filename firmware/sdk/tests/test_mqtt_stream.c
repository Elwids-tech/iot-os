/* SPDX-License-Identifier: MIT */
/* The real MQTT client (coreMQTT) over the level 1 port, against a scripted broker. */
#include <string.h>

#include "codec.h"
#include "harness.h"
#include "unity.h"

static harness h;
static decoded d;

void setUp(void)
{
    fake_storage_reset();
    harness_init(&h, true);
}

void tearDown(void)
{
    harness_free(&h);
}

static void test_connect_packet(void)
{
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_start(&h.gw));
    harness_poll(&h, 1, 0);
    TEST_ASSERT_TRUE(h.gw.connected);
    TEST_ASSERT_EQUAL_STRING("edge-user", h.stream.client_id);
    TEST_ASSERT_EQUAL_STRING("edge-user", h.stream.username);
    TEST_ASSERT_EQUAL_STRING("not-a-real-password", h.stream.password);
    TEST_ASSERT_TRUE(h.stream.clean_session);
    TEST_ASSERT_EQUAL_UINT16(IOTOS_KEEPALIVE_S, h.stream.keepalive);
    TEST_ASSERT_TRUE(h.stream.will_flag);
    TEST_ASSERT_EQUAL_UINT8(1, h.stream.will_qos);
    TEST_ASSERT_FALSE(h.stream.will_retain);
    TEST_ASSERT_EQUAL_STRING("spBv1.0/" TEST_GROUP "/NDEATH/" TEST_EDGE, h.stream.will_topic);
    TEST_ASSERT_TRUE(decode_payload(h.stream.will, h.stream.will_length, &d));
    TEST_ASSERT_EQUAL_UINT64(1, decoded_find(&d, "bdSeq")->integer);
}

static void test_subscribes_to_exactly_three_filters(void)
{
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_start(&h.gw));
    harness_poll(&h, 2, 10);
    TEST_ASSERT_EQUAL_INT(3, h.stream.subscription_count);
    TEST_ASSERT_EQUAL_STRING("spBv1.0/" TEST_GROUP "/NCMD/" TEST_EDGE, h.stream.subscriptions[0]);
    TEST_ASSERT_EQUAL_STRING("spBv1.0/" TEST_GROUP "/DCMD/" TEST_EDGE "/+", h.stream.subscriptions[1]);
    TEST_ASSERT_EQUAL_STRING("spBv1.0/STATE/" TEST_HOST, h.stream.subscriptions[2]);
    for (int i = 0; i < 3; i++) {
        TEST_ASSERT_EQUAL_UINT8(0, h.stream.subscription_qos[i]);
    }
}

static void test_bad_credentials_are_an_auth_failure(void)
{
    h.stream.connack_code = 5;
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_start(&h.gw));
    harness_poll(&h, 1, 0);
    TEST_ASSERT_FALSE(h.gw.connected);
    TEST_ASSERT_TRUE(harness_has_event(&h, IOTOS_EVENT_AUTH_FAILED));
    TEST_ASSERT_FALSE(h.stream.open);
}

static void test_other_refusals_are_transport_failures(void)
{
    h.stream.connack_code = 3; /* server unavailable */
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_start(&h.gw));
    harness_poll(&h, 1, 0);
    TEST_ASSERT_TRUE(harness_has_event(&h, IOTOS_EVENT_CONNECT_FAILED));
    TEST_ASSERT_FALSE(harness_has_event(&h, IOTOS_EVENT_AUTH_FAILED));
}

static void test_partial_sends_and_receives(void)
{
    h.stream.send_chunk = 7;
    h.stream.recv_chunk = 3;
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_device_add(&h.gw, "meter-1", &meter_type));
    harness_online(&h);
    TEST_ASSERT_EQUAL_size_t(2, h.stream.published.count);
    TEST_ASSERT_NOT_NULL(strstr(h.stream.published.items[0].topic, "/NBIRTH/"));
    TEST_ASSERT_TRUE(decode_payload(h.stream.published.items[1].data, h.stream.published.items[1].length, &d));
    TEST_ASSERT_EQUAL_DOUBLE(12.5, decoded_find(&d, "flow_rate")->number);
}

static void test_keepalive_pings_when_idle(void)
{
    harness_online(&h);
    harness_poll(&h, 30, 1000);
    TEST_ASSERT_TRUE(h.stream.pings > 0);
    TEST_ASSERT_TRUE(h.gw.connected);
}

static void test_a_dropped_connection_reconnects_and_rebirths(void)
{
    harness_online(&h);
    fake_stream_drop(&h.stream);
    harness_poll(&h, 1, 0);
    TEST_ASSERT_FALSE(h.gw.connected);
    TEST_ASSERT_TRUE(harness_has_event(&h, IOTOS_EVENT_DISCONNECTED));
    fake_messages_clear(&h.stream.published);
    harness_poll(&h, 30, 100);
    TEST_ASSERT_TRUE(h.gw.connected);
    TEST_ASSERT_EQUAL_INT(2, h.stream.connects);
    harness_state(&h, true);
    harness_poll(&h, 5, 100);
    TEST_ASSERT_TRUE(h.stream.published.count >= 1);
    TEST_ASSERT_TRUE(decode_payload(h.stream.published.items[0].data, h.stream.published.items[0].length, &d));
    TEST_ASSERT_EQUAL_UINT64(2, decoded_find(&d, "bdSeq")->integer);
}

static void test_stop_sends_ndeath_then_disconnect(void)
{
    harness_online(&h);
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_stop(&h.gw));
    TEST_ASSERT_NOT_NULL(strstr(h.stream.published.items[h.stream.published.count - 1].topic, "/NDEATH/"));
    TEST_ASSERT_EQUAL_INT(1, h.stream.disconnects);
}

static void test_on_command_publishes_from_inside_the_mqtt_client(void)
{
    uint8_t raw[128];
    iotos__pb pb;
    iotos__metric m;
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_device_add(&h.gw, "light-1", &light_type));
    harness_online(&h);
    fake_messages_clear(&h.stream.published);
    h.publish_on_command = true;
    memset(&m, 0, sizeof(m));
    m.name = "on";
    m.has_timestamp = true;
    m.timestamp = TEST_TIME;
    m.has_datatype = true;
    m.datatype = IOTOS_BOOLEAN;
    m.value.boolean = true;
    iotos__pb_init(&pb, raw, sizeof(raw));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos__pb_timestamp(&pb, TEST_TIME));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos__pb_metric(&pb, &m));
    fake_stream_publish(&h.stream, "spBv1.0/" TEST_GROUP "/DCMD/" TEST_EDGE "/light-1", raw, pb.length, false);
    harness_poll(&h, 1, 10);
    TEST_ASSERT_EQUAL_size_t(1, h.command_count);
    TEST_ASSERT_EQUAL(IOTOS_OK, h.command_publish_result);
    TEST_ASSERT_EQUAL_size_t(1, h.stream.published.count);
    TEST_ASSERT_NOT_NULL(strstr(h.stream.published.items[0].topic, "/DDATA/" TEST_EDGE "/light-1"));
    TEST_ASSERT_TRUE(h.gw.connected);
}

static void test_stop_from_on_command_is_safe(void)
{
    uint8_t raw[128];
    iotos__pb pb;
    iotos__metric m;
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_device_add(&h.gw, "light-1", &light_type));
    harness_online(&h);
    h.stop_on_command = true;
    memset(&m, 0, sizeof(m));
    m.name = "on";
    m.has_datatype = true;
    m.datatype = IOTOS_BOOLEAN;
    m.value.boolean = true;
    iotos__pb_init(&pb, raw, sizeof(raw));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos__pb_metric(&pb, &m));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos__pb_metric(&pb, &m)); /* a second metric after the stop */
    fake_stream_publish(&h.stream, "spBv1.0/" TEST_GROUP "/DCMD/" TEST_EDGE "/light-1", raw, pb.length, false);
    harness_poll(&h, 3, 10);
    TEST_ASSERT_EQUAL_size_t(1, h.command_count);
    TEST_ASSERT_FALSE(h.gw.connected);
    TEST_ASSERT_EQUAL_INT(1, h.stream.disconnects);
    TEST_ASSERT_NOT_NULL(strstr(h.stream.published.items[h.stream.published.count - 1].topic, "/NDEATH/"));
}

static void test_a_connection_attempt_keeps_to_one_timeout(void)
{
    uint64_t before;
    h.stream.connect_delay_ms = IOTOS_CONNECT_TIMEOUT_MS - 1000;
    h.stream.silent = true;
    h.stream.recv_tick_ms = 100;
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_start(&h.gw));
    before = fake_clock_utc();
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_poll(&h.gw, 10));
    TEST_ASSERT_FALSE(h.gw.connected);
    TEST_ASSERT_TRUE(fake_clock_utc() - before <= IOTOS_CONNECT_TIMEOUT_MS + 200);
    TEST_ASSERT_TRUE(harness_has_event(&h, IOTOS_EVENT_CONNECT_FAILED));
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_connect_packet);
    RUN_TEST(test_subscribes_to_exactly_three_filters);
    RUN_TEST(test_bad_credentials_are_an_auth_failure);
    RUN_TEST(test_other_refusals_are_transport_failures);
    RUN_TEST(test_partial_sends_and_receives);
    RUN_TEST(test_keepalive_pings_when_idle);
    RUN_TEST(test_a_dropped_connection_reconnects_and_rebirths);
    RUN_TEST(test_stop_sends_ndeath_then_disconnect);
    RUN_TEST(test_on_command_publishes_from_inside_the_mqtt_client);
    RUN_TEST(test_stop_from_on_command_is_safe);
    RUN_TEST(test_a_connection_attempt_keeps_to_one_timeout);
    return UNITY_END();
}
