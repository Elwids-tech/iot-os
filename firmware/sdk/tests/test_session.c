/* SPDX-License-Identifier: MIT */
/* The edge-node session on the fake level 2 port. */
#include <string.h>

#include "codec.h"
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

static const fake_message *message(size_t index)
{
    TEST_ASSERT_TRUE(index < h.mqtt.published.count);
    return &h.mqtt.published.items[index];
}

static const decoded *payload(size_t index)
{
    const fake_message *m = message(index);
    TEST_ASSERT_TRUE(decode_payload(m->data, m->length, &d));
    return &d;
}

static void publish_meter(const char *id, double flow, iotos_status expected)
{
    iotos_writer *w;
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_begin(&h.gw, id, &w));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_put_double(w, "flow_rate", flow));
    TEST_ASSERT_EQUAL(expected, iotos_commit(w));
}

static void rebirth_command(bool retained)
{
    uint8_t raw[64];
    iotos__pb pb;
    iotos__metric m;
    memset(&m, 0, sizeof(m));
    m.name = "Node Control/Rebirth";
    m.has_datatype = true;
    m.datatype = IOTOS_BOOLEAN;
    m.value.boolean = true;
    iotos__pb_init(&pb, raw, sizeof(raw));
    iotos__pb_timestamp(&pb, TEST_TIME);
    iotos__pb_metric(&pb, &m);
    harness_inject(&h, "spBv1.0/" TEST_GROUP "/NCMD/" TEST_EDGE, raw, pb.length, retained);
}

static void test_will_carries_bdseq_and_bdseq_persists(void)
{
    uint8_t stored = 0;
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_start(&h.gw));
    harness_poll(&h, 1, 0);
    TEST_ASSERT_EQUAL_INT(1, h.mqtt.connects);
    TEST_ASSERT_EQUAL_STRING("spBv1.0/" TEST_GROUP "/NDEATH/" TEST_EDGE, h.mqtt.will_topic);
    TEST_ASSERT_EQUAL_UINT8(1, h.mqtt.last_connect.will_qos);
    TEST_ASSERT_FALSE(h.mqtt.last_connect.will_retain);
    TEST_ASSERT_TRUE(h.mqtt.last_connect.clean_session);
    TEST_ASSERT_EQUAL_STRING("edge-user", h.mqtt.last_connect.client_id);
    TEST_ASSERT_EQUAL_STRING("edge-user", h.mqtt.last_connect.username);
    TEST_ASSERT_EQUAL_UINT16(IOTOS_KEEPALIVE_S, h.mqtt.last_connect.keepalive_s);
    TEST_ASSERT_TRUE(decode_payload(h.mqtt.will, h.mqtt.will_length, &d));
    TEST_ASSERT_FALSE(d.has_seq);
    TEST_ASSERT_NOT_NULL(decoded_find(&d, "bdSeq"));
    TEST_ASSERT_EQUAL_UINT32(IOTOS_INT64, decoded_find(&d, "bdSeq")->datatype);
    TEST_ASSERT_EQUAL_UINT64(1, decoded_find(&d, "bdSeq")->integer);
    TEST_ASSERT_TRUE(fake_storage_byte("bdseq", &stored));
    TEST_ASSERT_EQUAL_UINT8(1, stored);
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_stop(&h.gw));

    /* A reboot: a new gateway loads the stored bdSeq and uses the next one. */
    harness_free(&h);
    harness_init(&h, false);
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_start(&h.gw));
    harness_poll(&h, 1, 0);
    TEST_ASSERT_TRUE(decode_payload(h.mqtt.will, h.mqtt.will_length, &d));
    TEST_ASSERT_EQUAL_UINT64(2, decoded_find(&d, "bdSeq")->integer);
}

static void test_subscribes_exactly_and_waits_for_the_host(void)
{
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_device_add(&h.gw, "meter-1", &meter_type));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_start(&h.gw));
    harness_poll(&h, 20, 100);
    TEST_ASSERT_EQUAL_INT(3, h.mqtt.subscription_count);
    TEST_ASSERT_EQUAL_STRING("spBv1.0/" TEST_GROUP "/NCMD/" TEST_EDGE, h.mqtt.subscriptions[0]);
    TEST_ASSERT_EQUAL_STRING("spBv1.0/" TEST_GROUP "/DCMD/" TEST_EDGE "/+", h.mqtt.subscriptions[1]);
    TEST_ASSERT_EQUAL_STRING("spBv1.0/STATE/" TEST_HOST, h.mqtt.subscriptions[2]);
    TEST_ASSERT_EQUAL_size_t(0, h.mqtt.published.count);
    publish_meter("meter-1", 1.0, IOTOS_PENDING_BIRTH);
    TEST_ASSERT_TRUE(harness_has_event(&h, IOTOS_EVENT_CONNECTED));
}

static void test_nbirth_has_seq_zero_and_the_dbirths_follow(void)
{
    const decoded_metric *m;
    iotos_set_firmware_version(&h.gw, "fw-2.1");
    iotos_set_connection(&h.gw, IOTOS_CONN_ETHERNET, false, 0);
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_device_add(&h.gw, "meter-1", &meter_type));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_device_add(&h.gw, "meter-2", &meter_type));
    harness_online(&h);
    TEST_ASSERT_EQUAL_size_t(3, h.mqtt.published.count);
    TEST_ASSERT_EQUAL_STRING("spBv1.0/" TEST_GROUP "/NBIRTH/" TEST_EDGE, message(0)->topic);
    TEST_ASSERT_EQUAL_UINT8(0, message(0)->qos);
    TEST_ASSERT_FALSE(message(0)->retain);
    payload(0);
    TEST_ASSERT_TRUE(d.has_seq);
    TEST_ASSERT_EQUAL_UINT64(0, d.seq);
    m = decoded_find(&d, "bdSeq");
    TEST_ASSERT_NOT_NULL(m);
    TEST_ASSERT_FALSE(m->has_alias);
    TEST_ASSERT_EQUAL_UINT64(1, m->integer);
    m = decoded_find(&d, "Node Control/Rebirth");
    TEST_ASSERT_NOT_NULL(m);
    TEST_ASSERT_FALSE(m->has_alias);
    TEST_ASSERT_EQUAL_UINT32(IOTOS_BOOLEAN, m->datatype);
    TEST_ASSERT_EQUAL_UINT64(0, m->integer);
    /* Health: every metric present once, with node aliases 1..8. */
    TEST_ASSERT_EQUAL_size_t(10, d.count);
    TEST_ASSERT_EQUAL_STRING(IOTOS_SDK_VERSION, decoded_find(&d, IOTOS_HEALTH_SDK_VERSION)->text);
    TEST_ASSERT_EQUAL_STRING("fw-2.1", decoded_find(&d, IOTOS_HEALTH_FIRMWARE_VERSION)->text);
    TEST_ASSERT_EQUAL_STRING("ethernet", decoded_find(&d, IOTOS_HEALTH_CONNECTION_TYPE)->text);
    TEST_ASSERT_TRUE(decoded_find(&d, IOTOS_HEALTH_SIGNAL_STRENGTH)->is_null);
    TEST_ASSERT_EQUAL_UINT64(2, decoded_find(&d, IOTOS_HEALTH_DEVICES_CONFIGURED)->integer);
    TEST_ASSERT_EQUAL_UINT64(2, decoded_find(&d, IOTOS_HEALTH_DEVICES_ONLINE)->integer);
    TEST_ASSERT_EQUAL_UINT64(0, decoded_find(&d, IOTOS_HEALTH_RECONNECTS)->integer);
    TEST_ASSERT_EQUAL_UINT64(1, decoded_find(&d, IOTOS_HEALTH_UPTIME)->alias);
    TEST_ASSERT_EQUAL_UINT64(8, decoded_find(&d, IOTOS_HEALTH_RECONNECTS)->alias);

    TEST_ASSERT_EQUAL_STRING("spBv1.0/" TEST_GROUP "/DBIRTH/" TEST_EDGE "/meter-1", message(1)->topic);
    TEST_ASSERT_EQUAL_UINT64(1, payload(1)->seq);
    TEST_ASSERT_EQUAL_STRING("spBv1.0/" TEST_GROUP "/DBIRTH/" TEST_EDGE "/meter-2", message(2)->topic);
    TEST_ASSERT_EQUAL_UINT64(2, payload(2)->seq);
    TEST_ASSERT_TRUE(harness_has_event(&h, IOTOS_EVENT_ONLINE));
}

static void test_health_is_published_every_interval(void)
{
    harness_online(&h);
    fake_messages_clear(&h.mqtt.published);
    fake_clock_advance(IOTOS_HEALTH_INTERVAL_S * 1000u - 200u);
    harness_poll(&h, 1, 0);
    TEST_ASSERT_EQUAL_size_t(0, h.mqtt.published.count);
    harness_poll(&h, 1, 300);
    harness_poll(&h, 1, 0);
    TEST_ASSERT_EQUAL_size_t(1, h.mqtt.published.count);
    TEST_ASSERT_EQUAL_STRING("spBv1.0/" TEST_GROUP "/NDATA/" TEST_EDGE, message(0)->topic);
    payload(0);
    TEST_ASSERT_NULL(decoded_find(&d, IOTOS_HEALTH_UPTIME)); /* data carries aliases only */
    TEST_ASSERT_TRUE(decoded_alias(&d, 1)->integer >= IOTOS_HEALTH_INTERVAL_S - 1);
    TEST_ASSERT_NULL(decoded_alias(&d, 5)); /* sdk_version only in births */
}

static void test_seq_wraps_from_255_to_0(void)
{
    uint64_t previous;
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_device_add(&h.gw, "meter-1", &meter_type));
    harness_online(&h);
    for (int i = 0; i < 300; i++) {
        publish_meter("meter-1", i, IOTOS_OK);
    }
    previous = payload(1)->seq;
    for (size_t i = 2; i < h.mqtt.published.count; i++) {
        uint64_t seq = payload(i)->seq;
        TEST_ASSERT_EQUAL_UINT64((previous + 1) % 256, seq);
        previous = seq;
    }
    TEST_ASSERT_EQUAL_size_t(302, h.mqtt.published.count);
}

static void test_rebirth_command_and_host_restart_rebirth_everything(void)
{
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_device_add(&h.gw, "meter-1", &meter_type));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_device_add(&h.gw, "meter-2", &meter_type));
    harness_online(&h);
    publish_meter("meter-1", 3.0, IOTOS_OK);

    fake_messages_clear(&h.mqtt.published);
    rebirth_command(false);
    harness_poll(&h, 10, 100);
    TEST_ASSERT_EQUAL_size_t(3, h.mqtt.published.count);
    TEST_ASSERT_NOT_NULL(strstr(message(0)->topic, "/NBIRTH/"));
    TEST_ASSERT_EQUAL_UINT64(0, payload(0)->seq);
    TEST_ASSERT_EQUAL_UINT64(1, decoded_find(&d, "bdSeq")->integer); /* same session */
    TEST_ASSERT_NOT_NULL(strstr(message(1)->topic, "/DBIRTH/"));
    TEST_ASSERT_NOT_NULL(strstr(message(2)->topic, "/DBIRTH/"));
    TEST_ASSERT_TRUE(harness_has_event(&h, IOTOS_EVENT_REBIRTH));

    fake_messages_clear(&h.mqtt.published);
    harness_state(&h, true);
    harness_poll(&h, 10, 100);
    TEST_ASSERT_EQUAL_size_t(3, h.mqtt.published.count);
    TEST_ASSERT_NOT_NULL(strstr(message(0)->topic, "/NBIRTH/"));
    TEST_ASSERT_EQUAL_size_t(2, harness_count_events(&h, IOTOS_EVENT_REBIRTH));
}

static void test_retained_ncmd_is_ignored(void)
{
    harness_online(&h);
    fake_messages_clear(&h.mqtt.published);
    rebirth_command(true);
    harness_poll(&h, 10, 100);
    TEST_ASSERT_EQUAL_size_t(0, h.mqtt.published.count);
}

static void test_host_offline_pauses_publishing(void)
{
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_device_add(&h.gw, "meter-1", &meter_type));
    harness_online(&h);
    harness_state(&h, false);
    harness_poll(&h, 1, 0);
    TEST_ASSERT_TRUE(harness_has_event(&h, IOTOS_EVENT_HOST_OFFLINE));
    publish_meter("meter-1", 1.0, IOTOS_E_OFFLINE);
}

static void test_auth_failure_is_its_own_event_and_back_off_grows_to_the_cap(void)
{
    uint32_t attempts[16];
    int seen = 0;
    uint32_t elapsed = 0;
    h.mqtt.connect_result = IOTOS_E_AUTH;
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_start(&h.gw));
    while (seen < 12 && elapsed < 60u * 60u * 1000u) {
        int before = h.mqtt.connects;
        harness_poll(&h, 1, 100);
        elapsed += 100;
        if (h.mqtt.connects != before) {
            attempts[seen++] = elapsed;
        }
    }
    TEST_ASSERT_EQUAL_INT(12, seen);
    TEST_ASSERT_TRUE(harness_has_event(&h, IOTOS_EVENT_AUTH_FAILED));
    TEST_ASSERT_FALSE(harness_has_event(&h, IOTOS_EVENT_CONNECT_FAILED));
    for (int i = 1; i < seen; i++) {
        uint32_t nominal = 1000u << (i - 1);
        uint32_t gap = attempts[i] - attempts[i - 1];
        if (nominal > 300000u) {
            nominal = 300000u;
        }
        TEST_ASSERT_TRUE_MESSAGE(gap >= nominal * 8 / 10 && gap <= nominal * 12 / 10 + 100, "back-off out of range");
    }
}

static void test_transport_failure_is_reported_as_connect_failed(void)
{
    h.mqtt.connect_result = IOTOS_E_TRANSPORT;
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_start(&h.gw));
    harness_poll(&h, 1, 0);
    TEST_ASSERT_TRUE(harness_has_event(&h, IOTOS_EVENT_CONNECT_FAILED));
    TEST_ASSERT_FALSE(harness_has_event(&h, IOTOS_EVENT_AUTH_FAILED));
}

static void lose_connections(int times)
{
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_start(&h.gw));
    for (int i = 0; i < times; i++) {
        int connects = h.mqtt.connects;
        for (int step = 0; step < 4000 && h.mqtt.connects == connects; step++) {
            harness_poll(&h, 1, 100);
        }
        TEST_ASSERT_TRUE(h.gw.connected);
        fake_clock_advance(1000);
        h.mqtt.poll_result = IOTOS_E_TRANSPORT;
        harness_poll(&h, 1, 0);
        h.mqtt.poll_result = IOTOS_OK;
        TEST_ASSERT_FALSE(h.gw.connected);
    }
}

static void test_three_quick_closes_report_a_session_takeover(void)
{
    lose_connections(3);
    TEST_ASSERT_EQUAL_size_t(1, harness_count_events(&h, IOTOS_EVENT_SESSION_TAKEOVER));
}

static void test_two_quick_closes_do_not(void)
{
    lose_connections(2);
    TEST_ASSERT_FALSE(harness_has_event(&h, IOTOS_EVENT_SESSION_TAKEOVER));
    TEST_ASSERT_EQUAL_size_t(2, harness_count_events(&h, IOTOS_EVENT_DISCONNECTED));
}

static void test_reconnects_are_counted(void)
{
    lose_connections(1);
    harness_poll(&h, 40, 100);
    TEST_ASSERT_TRUE(h.gw.connected);
    TEST_ASSERT_EQUAL_UINT32(1, h.gw.reconnects);
}

static void test_invalid_clock_holds_births_and_is_reported(void)
{
    fake_clock_set_valid(false);
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_start(&h.gw));
    harness_poll(&h, 1, 0);
    harness_state(&h, true);
    harness_poll(&h, 10, 1000);
    TEST_ASSERT_EQUAL_size_t(0, h.mqtt.published.count);
    TEST_ASSERT_FALSE(harness_has_event(&h, IOTOS_EVENT_CLOCK_INVALID));
    harness_poll(&h, 300, 1000);
    TEST_ASSERT_EQUAL_size_t(1, harness_count_events(&h, IOTOS_EVENT_CLOCK_INVALID));
    harness_poll(&h, 61, 1000);
    TEST_ASSERT_EQUAL_size_t(2, harness_count_events(&h, IOTOS_EVENT_CLOCK_INVALID));
    TEST_ASSERT_EQUAL_size_t(0, h.mqtt.published.count);
    fake_clock_set_valid(true);
    harness_poll(&h, 1, 0);
    TEST_ASSERT_EQUAL_size_t(1, h.mqtt.published.count);
    TEST_ASSERT_NOT_NULL(strstr(message(0)->topic, "/NBIRTH/"));
}

static iotos_status event_publish_result = IOTOS_E_INVALID;

static void publish_on_online(harness *hh, iotos_event event)
{
    iotos_writer *w;
    if (event != IOTOS_EVENT_ONLINE) {
        return;
    }
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_begin(&hh->gw, NULL, &w));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_put_string(w, IOTOS_HEALTH_FIRMWARE_VERSION, "fw-3"));
    event_publish_result = iotos_commit(w);
}

static void test_on_event_may_publish(void)
{
    h.on_event_extra = publish_on_online;
    harness_online(&h);
    TEST_ASSERT_EQUAL(IOTOS_OK, event_publish_result);
    TEST_ASSERT_NOT_NULL(strstr(message(1)->topic, "/NDATA/"));
}

static void test_stop_publishes_ndeath(void)
{
    harness_online(&h);
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_stop(&h.gw));
    TEST_ASSERT_EQUAL_STRING("spBv1.0/" TEST_GROUP "/NDEATH/" TEST_EDGE, message(h.mqtt.published.count - 1)->topic);
    payload(h.mqtt.published.count - 1);
    TEST_ASSERT_EQUAL_UINT64(1, decoded_find(&d, "bdSeq")->integer);
    TEST_ASSERT_EQUAL_INT(1, h.mqtt.disconnects);
}

static void test_init_rejects_bad_settings_and_ports(void)
{
    static iotos_gateway gw;
    iotos_settings s = h.settings;
    iotos_ports p = h.ports;
    s.group_id = "bad/group";
    TEST_ASSERT_EQUAL(IOTOS_E_INVALID, iotos_init(&gw, &s, &h.ports, NULL));
    s = h.settings;
    s.edge_node_id = "edge+";
    TEST_ASSERT_EQUAL(IOTOS_E_INVALID, iotos_init(&gw, &s, &h.ports, NULL));
    p.stream = &h.stream_port;
    TEST_ASSERT_EQUAL(IOTOS_E_INVALID, iotos_init(&gw, &h.settings, &p, NULL)); /* both levels */
    p = h.ports;
    p.mqtt = NULL;
    TEST_ASSERT_EQUAL(IOTOS_E_INVALID, iotos_init(&gw, &h.settings, &p, NULL)); /* neither */
    p = h.ports;
    p.clock = NULL;
    TEST_ASSERT_EQUAL(IOTOS_E_INVALID, iotos_init(&gw, &h.settings, &p, NULL));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_init(&gw, &h.settings, &h.ports, NULL));
}

static void test_state_delivered_during_connect_is_ignored(void)
{
    h.mqtt.deliver_on_connect = true;
    harness_state(&h, true);
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_start(&h.gw));
    harness_poll(&h, 5, 100);
    TEST_ASSERT_TRUE(h.gw.connected);
    TEST_ASSERT_EQUAL_size_t(0, h.mqtt.published.count);
    TEST_ASSERT_FALSE(harness_has_event(&h, IOTOS_EVENT_HOST_ONLINE));
    harness_state(&h, true);
    harness_poll(&h, 2, 100);
    TEST_ASSERT_NOT_NULL(strstr(message(0)->topic, "/NBIRTH/"));
}

static void test_commands_before_the_births_are_rejected(void)
{
    uint8_t raw[64];
    iotos__pb pb;
    iotos__metric m;
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_device_add(&h.gw, "light-1", &light_type));
    harness_online(&h);
    harness_state(&h, false); /* host offline: born states are stale */
    harness_poll(&h, 1, 0);
    memset(&m, 0, sizeof(m));
    m.name = "on";
    m.has_datatype = true;
    m.datatype = IOTOS_BOOLEAN;
    m.value.boolean = true;
    iotos__pb_init(&pb, raw, sizeof(raw));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos__pb_metric(&pb, &m));
    harness_inject(&h, "spBv1.0/" TEST_GROUP "/DCMD/" TEST_EDGE "/light-1", raw, pb.length, false);
    harness_poll(&h, 1, 0);
    TEST_ASSERT_EQUAL_size_t(0, h.command_count);
    TEST_ASSERT_TRUE(harness_has_event(&h, IOTOS_EVENT_COMMAND_REJECTED));
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_will_carries_bdseq_and_bdseq_persists);
    RUN_TEST(test_subscribes_exactly_and_waits_for_the_host);
    RUN_TEST(test_nbirth_has_seq_zero_and_the_dbirths_follow);
    RUN_TEST(test_health_is_published_every_interval);
    RUN_TEST(test_seq_wraps_from_255_to_0);
    RUN_TEST(test_rebirth_command_and_host_restart_rebirth_everything);
    RUN_TEST(test_retained_ncmd_is_ignored);
    RUN_TEST(test_host_offline_pauses_publishing);
    RUN_TEST(test_auth_failure_is_its_own_event_and_back_off_grows_to_the_cap);
    RUN_TEST(test_transport_failure_is_reported_as_connect_failed);
    RUN_TEST(test_three_quick_closes_report_a_session_takeover);
    RUN_TEST(test_two_quick_closes_do_not);
    RUN_TEST(test_reconnects_are_counted);
    RUN_TEST(test_invalid_clock_holds_births_and_is_reported);
    RUN_TEST(test_on_event_may_publish);
    RUN_TEST(test_stop_publishes_ndeath);
    RUN_TEST(test_init_rejects_bad_settings_and_ports);
    RUN_TEST(test_state_delivered_during_connect_is_ignored);
    RUN_TEST(test_commands_before_the_births_are_rejected);
    return UNITY_END();
}
