/* SPDX-License-Identifier: MIT */
/* Commands: matched by name, validated against the device type, delivered unlocked. */
#include <stdio.h>
#include <string.h>

#include "codec.h"
#include "harness.h"
#include "unity.h"

#define DCMD "spBv1.0/" TEST_GROUP "/DCMD/" TEST_EDGE "/"

static harness h;

void setUp(void)
{
    fake_storage_reset();
    harness_init(&h, false);
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_device_add(&h.gw, "light-1", &light_type));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_device_add(&h.gw, "meter-1", &meter_type));
    harness_online(&h);
    fake_messages_clear(&h.mqtt.published);
}

void tearDown(void)
{
    harness_free(&h);
}

/* A command shaped like the runtime's: name, timestamp, datatype and value. */
static size_t command(uint8_t *out, const char *name, uint32_t datatype, const iotos__metric *value)
{
    iotos__pb pb;
    iotos__metric m = *value;
    m.name = name;
    m.has_timestamp = true;
    m.timestamp = TEST_TIME;
    m.has_datatype = true;
    m.datatype = datatype;
    iotos__pb_init(&pb, out, 512);
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos__pb_timestamp(&pb, TEST_TIME));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos__pb_metric(&pb, &m));
    return pb.length;
}

static void send_bool(const char *device, const char *name, uint32_t datatype, bool value, bool retained)
{
    uint8_t raw[512];
    char topic[128];
    iotos__metric v;
    memset(&v, 0, sizeof(v));
    v.value.boolean = value;
    snprintf(topic, sizeof(topic), DCMD "%s", device);
    harness_inject(&h, topic, raw, command(raw, name, datatype, &v), retained);
    harness_poll(&h, 1, 10);
}

static void test_a_valid_command_reaches_on_command(void)
{
    send_bool("light-1", "on", IOTOS_BOOLEAN, true, false);
    TEST_ASSERT_EQUAL_size_t(1, h.command_count);
    TEST_ASSERT_EQUAL_STRING("light-1", h.commands[0].device);
    TEST_ASSERT_EQUAL_STRING("on", h.commands[0].metric);
    TEST_ASSERT_EQUAL(IOTOS_BOOLEAN, h.commands[0].value.datatype);
    TEST_ASSERT_TRUE(h.commands[0].value.as.boolean);
}

static void test_on_command_can_publish_the_new_state(void)
{
    static decoded d;
    h.publish_on_command = true;
    send_bool("light-1", "on", IOTOS_BOOLEAN, true, false);
    TEST_ASSERT_EQUAL(IOTOS_OK, h.command_publish_result);
    TEST_ASSERT_EQUAL_size_t(1, h.mqtt.published.count);
    TEST_ASSERT_NOT_NULL(strstr(h.mqtt.published.items[0].topic, "/DDATA/" TEST_EDGE "/light-1"));
    TEST_ASSERT_TRUE(decode_payload(h.mqtt.published.items[0].data, h.mqtt.published.items[0].length, &d));
    TEST_ASSERT_EQUAL_UINT64(1u << 16, d.metrics[0].alias); /* light-1 is slot 0, metric 0 */
}

static void expect_rejected(size_t before_events)
{
    TEST_ASSERT_EQUAL_size_t(0, h.command_count);
    TEST_ASSERT_EQUAL_size_t(before_events + 1, harness_count_events(&h, IOTOS_EVENT_COMMAND_REJECTED));
}

static void test_rejections_are_reported_and_never_applied(void)
{
    uint8_t raw[512];
    iotos__metric v;
    size_t n = 0;
    char long_text[IOTOS_COMMAND_STRING_MAX + 2];

    send_bool("no-such-device", "on", IOTOS_BOOLEAN, true, false);
    expect_rejected(n++);
    send_bool("light-1", "no_such_metric", IOTOS_BOOLEAN, true, false);
    expect_rejected(n++);
    TEST_ASSERT_TRUE(fake_log_contains("unknown metric"));
    send_bool("light-1", "on", IOTOS_INT32, true, false);
    expect_rejected(n++);
    TEST_ASSERT_TRUE(fake_log_contains("wrong datatype"));

    memset(&v, 0, sizeof(v));
    v.value.bytes.data = (const uint8_t *)"read only";
    v.value.bytes.length = 9;
    harness_inject(&h, DCMD "light-1", raw, command(raw, "label", IOTOS_STRING, &v), false);
    harness_poll(&h, 1, 10);
    expect_rejected(n++);
    TEST_ASSERT_TRUE(fake_log_contains("does not accept commands"));

    memset(long_text, 'x', sizeof(long_text) - 1);
    long_text[sizeof(long_text) - 1] = '\0';
    v.value.bytes.data = (const uint8_t *)long_text;
    v.value.bytes.length = strlen(long_text);
    harness_inject(&h, DCMD "light-1", raw, command(raw, "mode", IOTOS_STRING, &v), false);
    harness_poll(&h, 1, 10);
    expect_rejected(n++);

    memset(&v, 0, sizeof(v));
    v.is_null = true;
    harness_inject(&h, DCMD "light-1", raw, command(raw, "on", IOTOS_BOOLEAN, &v), false);
    harness_poll(&h, 1, 10);
    expect_rejected(n++);

    {
        /* Alias only, no name. */
        iotos__pb pb;
        iotos__metric m;
        memset(&m, 0, sizeof(m));
        m.has_alias = true;
        m.alias = 1u << 16;
        m.datatype = IOTOS_BOOLEAN;
        m.value.boolean = true;
        iotos__pb_init(&pb, raw, sizeof(raw));
        iotos__pb_metric(&pb, &m);
        harness_inject(&h, DCMD "light-1", raw, pb.length, false);
        harness_poll(&h, 1, 10);
        expect_rejected(n++);
    }
    {
        const uint8_t junk[] = {0x12, 0x40, 0x01};
        harness_inject(&h, DCMD "light-1", junk, sizeof(junk), false);
        harness_poll(&h, 1, 10);
        expect_rejected(n++);
    }
    TEST_ASSERT_EQUAL_size_t(0, h.mqtt.published.count);
}

static void test_a_retained_command_is_ignored(void)
{
    send_bool("light-1", "on", IOTOS_BOOLEAN, true, true);
    TEST_ASSERT_EQUAL_size_t(0, h.command_count);
    TEST_ASSERT_FALSE(harness_has_event(&h, IOTOS_EVENT_COMMAND_REJECTED));
}

static void test_a_command_for_an_offline_device_is_rejected(void)
{
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_device_offline(&h.gw, "light-1"));
    send_bool("light-1", "on", IOTOS_BOOLEAN, true, false);
    expect_rejected(0);
    TEST_ASSERT_TRUE(h.events[h.event_count - 1].detail == IOTOS_E_OFFLINE);
}

static size_t read_file(const char *path, uint8_t *out, size_t size)
{
    FILE *f = fopen(path, "rb");
    size_t n;
    TEST_ASSERT_NOT_NULL_MESSAGE(f, path);
    n = fread(out, 1, size, f);
    fclose(f);
    return n;
}

static void test_the_runtime_light_fixture_reaches_on_command(void)
{
    uint8_t raw[256];
    size_t length = read_file(IOTOS_FIXTURES_DIR "/dcmd-light.bin", raw, sizeof(raw));
    harness_inject(&h, DCMD "light-1", raw, length, false);
    harness_poll(&h, 1, 10);
    TEST_ASSERT_EQUAL_size_t(1, h.command_count);
    TEST_ASSERT_EQUAL_STRING("Brightness", h.commands[0].metric);
    TEST_ASSERT_EQUAL_INT64(8, h.commands[0].value.as.i64);
}

static void test_the_runtime_command_fixtures_decode(void)
{
    /* Written by the runtime's own encoder (services/runtime/internal/app). */
    uint8_t raw[256];
    size_t length;
    length = read_file(IOTOS_FIXTURES_DIR "/sdk/commands/ncmd-rebirth.bin", raw, sizeof(raw));
    harness_inject(&h, "spBv1.0/" TEST_GROUP "/NCMD/" TEST_EDGE, raw, length, false);
    harness_poll(&h, 1, 10);
    TEST_ASSERT_TRUE(harness_has_event(&h, IOTOS_EVENT_REBIRTH));
    harness_poll(&h, 10, 100);

    length = read_file(IOTOS_FIXTURES_DIR "/sdk/commands/dcmd-bool.bin", raw, sizeof(raw));
    harness_inject(&h, DCMD "light-1", raw, length, false);
    length = read_file(IOTOS_FIXTURES_DIR "/sdk/commands/dcmd-double.bin", raw, sizeof(raw));
    harness_inject(&h, DCMD "light-1", raw, length, false);
    length = read_file(IOTOS_FIXTURES_DIR "/sdk/commands/dcmd-string.bin", raw, sizeof(raw));
    harness_inject(&h, DCMD "light-1", raw, length, false);
    harness_poll(&h, 1, 10);
    TEST_ASSERT_EQUAL_size_t(3, h.command_count);
    TEST_ASSERT_EQUAL_STRING("on", h.commands[0].metric);
    TEST_ASSERT_TRUE(h.commands[0].value.as.boolean);
    TEST_ASSERT_EQUAL_STRING("scale", h.commands[1].metric);
    TEST_ASSERT_EQUAL_DOUBLE(0.75, h.commands[1].value.as.number);
    TEST_ASSERT_EQUAL_STRING("mode", h.commands[2].metric);
    TEST_ASSERT_EQUAL_STRING("eco", h.commands[2].text);
}

static void test_a_metric_name_with_a_nul_is_rejected(void)
{
    /* name "on\0zzzzzzzzzzzz", datatype Boolean, value true */
    static const uint8_t raw[] = {0x12, 0x15, 0x0a, 0x0f, 'o', 'n', 0, 'z', 'z', 'z', 'z', 'z', 'z', 'z', 'z', 'z', 'z',
                                  'z', 'z', 0x20, 0x0b, 0x70, 0x01};
    harness_inject(&h, DCMD "light-1", raw, sizeof(raw), false);
    harness_poll(&h, 1, 10);
    expect_rejected(0);
}

static void test_many_rejections_leave_room_for_state_changes(void)
{
    uint8_t raw[1024];
    iotos__pb pb;
    iotos__metric m;
    char name[16];
    memset(&m, 0, sizeof(m));
    m.has_datatype = true;
    m.datatype = IOTOS_BOOLEAN;
    iotos__pb_init(&pb, raw, sizeof(raw));
    for (int i = 0; i < 12; i++) {
        snprintf(name, sizeof(name), "nope_%d", i);
        m.name = name;
        TEST_ASSERT_EQUAL(IOTOS_OK, iotos__pb_metric(&pb, &m));
    }
    harness_inject(&h, DCMD "light-1", raw, pb.length, false);
    h.mqtt.poll_result = IOTOS_E_TRANSPORT; /* and the connection drops in the same poll */
    harness_poll(&h, 1, 10);
    h.mqtt.poll_result = IOTOS_OK;
    TEST_ASSERT_EQUAL_size_t(1, harness_count_events(&h, IOTOS_EVENT_COMMAND_REJECTED));
    TEST_ASSERT_TRUE(harness_has_event(&h, IOTOS_EVENT_DISCONNECTED));
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_a_valid_command_reaches_on_command);
    RUN_TEST(test_on_command_can_publish_the_new_state);
    RUN_TEST(test_rejections_are_reported_and_never_applied);
    RUN_TEST(test_a_retained_command_is_ignored);
    RUN_TEST(test_a_command_for_an_offline_device_is_rejected);
    RUN_TEST(test_the_runtime_light_fixture_reaches_on_command);
    RUN_TEST(test_the_runtime_command_fixtures_decode);
    RUN_TEST(test_a_metric_name_with_a_nul_is_rejected);
    RUN_TEST(test_many_rejections_leave_room_for_state_changes);
    return UNITY_END();
}
