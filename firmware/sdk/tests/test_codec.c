/* SPDX-License-Identifier: MIT */
/* The codec against the runtime's existing fixtures, every datatype, the value checks and
 * malformed input. */
#include <float.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "codec.h"
#include "fakes.h"
#include "unity.h"

static uint8_t buffer[4096];

void setUp(void) {}
void tearDown(void) {}

static size_t read_fixture(const char *name, uint8_t *out, size_t size)
{
    char path[512];
    FILE *f;
    size_t n;
    snprintf(path, sizeof(path), "%s/%s", IOTOS_FIXTURES_DIR, name);
    f = fopen(path, "rb");
    TEST_ASSERT_NOT_NULL_MESSAGE(f, path);
    n = fread(out, 1, size, f);
    fclose(f);
    return n;
}

static iotos__metric metric(const char *name, uint32_t datatype)
{
    iotos__metric m;
    memset(&m, 0, sizeof(m));
    m.name = name;
    m.has_timestamp = true;
    m.timestamp = TEST_TIME;
    m.has_datatype = name != NULL;
    m.datatype = datatype;
    return m;
}

static void assert_fixture(const char *name, const iotos__pb *pb)
{
    uint8_t expected[1024];
    size_t length = read_fixture(name, expected, sizeof(expected));
    TEST_ASSERT_EQUAL_size_t_MESSAGE(length, pb->length, name);
    TEST_ASSERT_EQUAL_MEMORY_MESSAGE(expected, pb->data, length, name);
}

static void test_nbirth_fixture_byte_for_byte(void)
{
    iotos__pb pb;
    iotos__metric bd = metric("bdSeq", IOTOS_INT64);
    iotos__metric rebirth = metric("Node Control/Rebirth", IOTOS_BOOLEAN);
    iotos__metric temperature = metric("Temperature", IOTOS_INT32);
    bd.value.integer = 1;
    rebirth.has_alias = true;
    rebirth.alias = 0;
    rebirth.value.boolean = false;
    temperature.has_alias = true;
    temperature.alias = 1;
    temperature.value.integer = (uint32_t)(int32_t)-5;
    iotos__pb_init(&pb, buffer, sizeof(buffer));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos__pb_timestamp(&pb, TEST_TIME));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos__pb_metric(&pb, &bd));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos__pb_metric(&pb, &rebirth));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos__pb_metric(&pb, &temperature));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos__pb_seq(&pb, 0));
    assert_fixture("nbirth.bin", &pb);
}

static void test_dbirth_fixture_byte_for_byte(void)
{
    iotos__pb pb;
    const char *names[] = {"Voltage L1", "Voltage L2", "Voltage L3"};
    const double values[] = {230.0, 231.0, 229.0};
    iotos__pb_init(&pb, buffer, sizeof(buffer));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos__pb_timestamp(&pb, TEST_TIME));
    for (int i = 0; i < 3; i++) {
        iotos__metric m = metric(names[i], IOTOS_DOUBLE);
        m.has_alias = true;
        m.alias = (uint64_t)i + 1;
        m.value.number = values[i];
        TEST_ASSERT_EQUAL(IOTOS_OK, iotos__pb_metric(&pb, &m));
    }
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos__pb_seq(&pb, 1));
    assert_fixture("dbirth-meter.bin", &pb);
}

static void test_ddata_alias_fixture_byte_for_byte(void)
{
    iotos__pb pb;
    iotos__metric m = metric(NULL, IOTOS_DOUBLE);
    m.has_alias = true;
    m.alias = 1;
    m.value.number = 232.0;
    iotos__pb_init(&pb, buffer, sizeof(buffer));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos__pb_timestamp(&pb, TEST_TIME));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos__pb_metric(&pb, &m));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos__pb_seq(&pb, 2));
    assert_fixture("ddata-alias.bin", &pb);
}

static void test_ndeath_fixture_byte_for_byte(void)
{
    iotos__pb pb;
    iotos__metric bd = metric("bdSeq", IOTOS_INT64);
    bd.value.integer = 1;
    iotos__pb_init(&pb, buffer, sizeof(buffer));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos__pb_timestamp(&pb, TEST_TIME));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos__pb_metric(&pb, &bd));
    assert_fixture("ndeath.bin", &pb);
}

static void test_decodes_dcmd_light_fixture(void)
{
    uint8_t raw[256];
    static decoded d;
    size_t length = read_fixture("dcmd-light.bin", raw, sizeof(raw));
    TEST_ASSERT_TRUE(decode_payload(raw, length, &d));
    TEST_ASSERT_EQUAL_size_t(1, d.count);
    TEST_ASSERT_EQUAL_STRING("Brightness", d.metrics[0].name);
    TEST_ASSERT_EQUAL_UINT32(IOTOS_INT32, d.metrics[0].datatype);
    TEST_ASSERT_EQUAL_UINT8(10, d.metrics[0].value_field);
    TEST_ASSERT_EQUAL_UINT64(8, d.metrics[0].integer);
    TEST_ASSERT_TRUE(d.has_timestamp);
    TEST_ASSERT_EQUAL_UINT64(TEST_TIME, d.timestamp);
    TEST_ASSERT_FALSE(d.has_seq);
}

static void test_round_trips_every_datatype(void)
{
    static decoded d;
    iotos__pb pb;
    struct {
        uint32_t datatype;
        uint64_t integer;
        double number;
        const char *text;
        uint8_t field;
    } cases[] = {
        {IOTOS_INT8, (uint32_t)(int32_t)-128, 0, NULL, 10},     {IOTOS_INT16, (uint32_t)(int32_t)-32768, 0, NULL, 10},
        {IOTOS_INT32, (uint32_t)INT32_MIN, 0, NULL, 10},        {IOTOS_INT64, (uint64_t)-9007199254740991LL, 0, NULL, 11},
        {IOTOS_UINT8, 255, 0, NULL, 10},                        {IOTOS_UINT16, 65535, 0, NULL, 10},
        {IOTOS_UINT32, UINT32_MAX, 0, NULL, 10},                {IOTOS_UINT64, 9007199254740991ULL, 0, NULL, 11},
        {IOTOS_FLOAT, 0, 1.5, NULL, 12},                        {IOTOS_DOUBLE, 0, -2.25e10, NULL, 13},
        {IOTOS_BOOLEAN, 1, 0, NULL, 14},                        {IOTOS_STRING, 0, 0, "hello", 15},
        {IOTOS_DATETIME, TEST_TIME, 0, NULL, 11},               {IOTOS_BYTES, 0, 0, "\x01\x02\x03", 16},
    };
    const size_t count = sizeof(cases) / sizeof(cases[0]);
    iotos__pb_init(&pb, buffer, sizeof(buffer));
    for (size_t i = 0; i < count; i++) {
        iotos__metric m = metric("m", cases[i].datatype);
        m.has_alias = true;
        m.alias = i + 1;
        if (cases[i].field == 12 || cases[i].field == 13) {
            m.value.number = cases[i].number;
        } else if (cases[i].text) {
            m.value.bytes.data = (const uint8_t *)cases[i].text;
            m.value.bytes.length = strlen(cases[i].text);
        } else if (cases[i].datatype == IOTOS_BOOLEAN) {
            m.value.boolean = true;
        } else {
            m.value.integer = cases[i].integer;
        }
        TEST_ASSERT_EQUAL(IOTOS_OK, iotos__pb_metric(&pb, &m));
    }
    {
        iotos__metric null_metric = metric("n", IOTOS_DOUBLE);
        null_metric.is_null = true;
        TEST_ASSERT_EQUAL(IOTOS_OK, iotos__pb_metric(&pb, &null_metric));
    }
    TEST_ASSERT_TRUE(decode_payload(buffer, pb.length, &d));
    TEST_ASSERT_EQUAL_size_t(count + 1, d.count);
    for (size_t i = 0; i < count; i++) {
        const decoded_metric *m = &d.metrics[i];
        TEST_ASSERT_EQUAL_UINT32(cases[i].datatype, m->datatype);
        TEST_ASSERT_EQUAL_UINT8(cases[i].field, m->value_field);
        TEST_ASSERT_EQUAL_UINT64(i + 1, m->alias);
        if (cases[i].field == 12 || cases[i].field == 13) {
            TEST_ASSERT_EQUAL_DOUBLE(cases[i].number, m->number);
        } else if (cases[i].text) {
            TEST_ASSERT_EQUAL_STRING(cases[i].text, m->text);
        } else {
            TEST_ASSERT_EQUAL_UINT64(cases[i].datatype == IOTOS_BOOLEAN ? 1 : (cases[i].field == 10 ? (uint32_t)cases[i].integer : cases[i].integer), m->integer);
        }
    }
    TEST_ASSERT_TRUE(d.metrics[count].is_null);
    TEST_ASSERT_EQUAL_UINT8(0, d.metrics[count].value_field);
}

static void test_value_checks(void)
{
    iotos__pb pb;
    struct {
        uint32_t datatype;
        uint64_t integer;
        double number;
    } bad[] = {
        {IOTOS_INT8, (uint32_t)(int32_t)128, 0},    {IOTOS_INT16, (uint32_t)(int32_t)-32769, 0},
        {IOTOS_INT32, 1ull << 32, 0},               {IOTOS_INT64, 9007199254740992ULL, 0},
        {IOTOS_INT64, (uint64_t)-9007199254740992LL, 0}, {IOTOS_UINT8, 256, 0},
        {IOTOS_UINT16, 65536, 0},                   {IOTOS_UINT64, 9007199254740992ULL, 0},
        {IOTOS_FLOAT, 0, NAN},                      {IOTOS_FLOAT, 0, 1e39},
        {IOTOS_DOUBLE, 0, INFINITY},                {IOTOS_DOUBLE, 0, NAN},
        {99, 0, 0},
    };
    iotos__pb_init(&pb, buffer, sizeof(buffer));
    for (size_t i = 0; i < sizeof(bad) / sizeof(bad[0]); i++) {
        iotos__metric m = metric("m", bad[i].datatype);
        m.value.integer = bad[i].integer;
        if (bad[i].datatype == IOTOS_FLOAT || bad[i].datatype == IOTOS_DOUBLE) {
            m.value.number = bad[i].number;
        }
        TEST_ASSERT_EQUAL_MESSAGE(IOTOS_E_INVALID, iotos__pb_metric(&pb, &m), "a bad value was accepted");
    }
    {
        static uint8_t big[65537];
        iotos__metric m = metric("m", IOTOS_STRING);
        memset(big, 'a', sizeof(big));
        m.value.bytes.data = big;
        m.value.bytes.length = sizeof(big);
        TEST_ASSERT_EQUAL(IOTOS_E_INVALID, iotos__pb_metric(&pb, &m));
        m.value.bytes.data = (const uint8_t *)"a\0b";
        m.value.bytes.length = 3;
        TEST_ASSERT_EQUAL(IOTOS_E_INVALID, iotos__pb_metric(&pb, &m));
    }
    TEST_ASSERT_EQUAL_size_t(0, pb.length);
}

static void test_full_buffer_is_too_large_and_never_truncates(void)
{
    uint8_t small[64];
    iotos__pb pb;
    iotos__metric m = metric("a-fairly-long-metric-name", IOTOS_DOUBLE);
    size_t before;
    m.value.number = 1.0;
    iotos__pb_init(&pb, small, sizeof(small));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos__pb_timestamp(&pb, TEST_TIME));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos__pb_metric(&pb, &m));
    before = pb.length;
    TEST_ASSERT_EQUAL(IOTOS_E_TOO_LARGE, iotos__pb_metric(&pb, &m));
    TEST_ASSERT_EQUAL_size_t(before, pb.length);
    pb.length = sizeof(small);
    TEST_ASSERT_EQUAL(IOTOS_E_TOO_LARGE, iotos__pb_seq(&pb, 5));
    TEST_ASSERT_EQUAL(IOTOS_E_TOO_LARGE, iotos__pb_timestamp(&pb, TEST_TIME));
}

static void test_reader_rejects_malformed_input(void)
{
    const uint8_t bad_varint[] = {0x08, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f};
    const uint8_t past_end[] = {0x12, 0x10, 0x0a, 0x01};
    const uint8_t group_wire[] = {0x0b};
    const uint8_t field_zero[] = {0x00, 0x01};
    const uint8_t truncated_double[] = {0x12, 0x03, 0x69, 0x00, 0x00};
    TEST_ASSERT_EQUAL(IOTOS_E_INVALID, iotos__pb_read(bad_varint, sizeof(bad_varint), NULL, NULL, NULL));
    TEST_ASSERT_EQUAL(IOTOS_E_INVALID, iotos__pb_read(past_end, sizeof(past_end), NULL, NULL, NULL));
    TEST_ASSERT_EQUAL(IOTOS_E_INVALID, iotos__pb_read(group_wire, sizeof(group_wire), NULL, NULL, NULL));
    TEST_ASSERT_EQUAL(IOTOS_E_INVALID, iotos__pb_read(field_zero, sizeof(field_zero), NULL, NULL, NULL));
    TEST_ASSERT_EQUAL(IOTOS_E_INVALID, iotos__pb_read(truncated_double, sizeof(truncated_double), NULL, NULL, NULL));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos__pb_read(NULL, 0, NULL, NULL, NULL));
}

static void count_metric(void *ctx, const iotos__metric_in *m)
{
    (void)m;
    (*(size_t *)ctx)++;
}

static void test_reader_survives_random_input(void)
{
    /* Random buffers and mutations of a real payload; the sanitizers catch any read
     * outside the buffer. */
    uint8_t valid[256], sample[256];
    size_t valid_length = read_fixture("nbirth.bin", valid, sizeof(valid));
    uint32_t seed = 12345u;
    for (int round = 0; round < 10000; round++) {
        size_t length, metrics = 0;
        uint8_t *heap;
        seed = seed * 1103515245u + 12345u;
        if (round % 2) {
            length = valid_length;
            memcpy(sample, valid, valid_length);
            for (int flips = 0; flips < 3; flips++) {
                seed = seed * 1103515245u + 12345u;
                sample[(seed >> 8) % valid_length] = (uint8_t)(seed >> 16);
            }
        } else {
            length = (seed >> 8) % sizeof(sample);
            for (size_t i = 0; i < length; i++) {
                seed = seed * 1103515245u + 12345u;
                sample[i] = (uint8_t)(seed >> 16);
            }
        }
        heap = malloc(length ? length : 1);
        memcpy(heap, sample, length);
        (void)iotos__pb_read(heap, length, NULL, count_metric, &metrics);
        free(heap);
    }
    TEST_PASS();
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_nbirth_fixture_byte_for_byte);
    RUN_TEST(test_dbirth_fixture_byte_for_byte);
    RUN_TEST(test_ddata_alias_fixture_byte_for_byte);
    RUN_TEST(test_ndeath_fixture_byte_for_byte);
    RUN_TEST(test_decodes_dcmd_light_fixture);
    RUN_TEST(test_round_trips_every_datatype);
    RUN_TEST(test_value_checks);
    RUN_TEST(test_full_buffer_is_too_large_and_never_truncates);
    RUN_TEST(test_reader_rejects_malformed_input);
    RUN_TEST(test_reader_survives_random_input);
    return UNITY_END();
}
