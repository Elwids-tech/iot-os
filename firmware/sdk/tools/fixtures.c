/* SPDX-License-Identifier: MIT */
/*
 * Writes the SDK's contract fixtures: one real session on the fake port with a fixed
 * clock, saved message by message, plus expected.json describing each one. The Go
 * runtime replays them in order (services/runtime/internal/sparkplug, TestSDKFixtures).
 *
 *   iotos_fixtures <output directory>
 */
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

#include "harness.h"
#include "unity.h"

static const char *out_dir;
static harness h;
static decoded d;
static FILE *json;
static size_t written;

static const iotos_metric_def all_metrics[] = {
    {"i8", IOTOS_INT8, NULL, false},      {"i16", IOTOS_INT16, NULL, false},   {"i32", IOTOS_INT32, NULL, false},
    {"i64", IOTOS_INT64, NULL, false},    {"u8", IOTOS_UINT8, NULL, false},    {"u16", IOTOS_UINT16, NULL, false},
    {"u32", IOTOS_UINT32, NULL, false},   {"u64", IOTOS_UINT64, NULL, false},  {"f32", IOTOS_FLOAT, NULL, false},
    {"f64", IOTOS_DOUBLE, NULL, false},   {"flag", IOTOS_BOOLEAN, NULL, false}, {"text", IOTOS_STRING, NULL, false},
    {"when", IOTOS_DATETIME, NULL, false}, {"blob", IOTOS_BYTES, NULL, false},
};
static const iotos_device_type all_type = {"all_datatypes", 1, all_metrics, 14};

void setUp(void) {}
void tearDown(void) {}

static const char *datatype_name(uint32_t datatype)
{
    switch (datatype) {
    case IOTOS_INT8: return "Int8";
    case IOTOS_INT16: return "Int16";
    case IOTOS_INT32: return "Int32";
    case IOTOS_INT64: return "Int64";
    case IOTOS_UINT8: return "UInt8";
    case IOTOS_UINT16: return "UInt16";
    case IOTOS_UINT32: return "UInt32";
    case IOTOS_UINT64: return "UInt64";
    case IOTOS_FLOAT: return "Float";
    case IOTOS_DOUBLE: return "Double";
    case IOTOS_BOOLEAN: return "Boolean";
    case IOTOS_STRING: return "String";
    case IOTOS_DATETIME: return "DateTime";
    case IOTOS_BYTES: return "Bytes";
    default: return "Unknown";
    }
}

static void json_string(const char *text, size_t length)
{
    fputc('"', json);
    for (size_t i = 0; i < length; i++) {
        unsigned char c = (unsigned char)text[i];
        if (c == '"' || c == '\\') {
            fprintf(json, "\\%c", c);
        } else if (c < 0x20) {
            fprintf(json, "\\u%04x", c);
        } else {
            fputc(c, json);
        }
    }
    fputc('"', json);
}

static void json_base64(const char *data, size_t length)
{
    static const char table[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    fputc('"', json);
    for (size_t i = 0; i < length; i += 3) {
        uint32_t chunk = (uint32_t)(unsigned char)data[i] << 16;
        if (i + 1 < length) chunk |= (uint32_t)(unsigned char)data[i + 1] << 8;
        if (i + 2 < length) chunk |= (unsigned char)data[i + 2];
        fputc(table[(chunk >> 18) & 63], json);
        fputc(table[(chunk >> 12) & 63], json);
        fputc(i + 1 < length ? table[(chunk >> 6) & 63] : '=', json);
        fputc(i + 2 < length ? table[chunk & 63] : '=', json);
    }
    fputc('"', json);
}

/* The datatype of an alias-only data metric is the one its birth declared. */
static uint32_t declared(const iotos_device_type *type, uint64_t alias)
{
    if (alias >> 16 == 0) {
        return type && alias >= 1 && alias <= type->metric_count ? (uint32_t)type->metrics[alias - 1].datatype : 0;
    }
    return type ? (uint32_t)type->metrics[alias & 0xFFFFu].datatype : 0;
}

static const char *declared_name(const iotos_device_type *type, uint64_t alias)
{
    uint64_t index = alias >> 16 == 0 ? alias - 1 : (alias & 0xFFFFu);
    return type && index < type->metric_count ? type->metrics[index].name : "";
}

static void json_value(const decoded_metric *m, uint32_t datatype)
{
    if (m->is_null) {
        fputs("null", json);
        return;
    }
    switch (datatype) {
    case IOTOS_INT8:
    case IOTOS_INT16:
    case IOTOS_INT32:
        fprintf(json, "%d", (int)(int32_t)(uint32_t)m->integer);
        break;
    case IOTOS_INT64:
        fprintf(json, "%lld", (long long)(int64_t)m->integer);
        break;
    case IOTOS_UINT8:
    case IOTOS_UINT16:
    case IOTOS_UINT32:
    case IOTOS_UINT64:
    case IOTOS_DATETIME:
        fprintf(json, "%llu", (unsigned long long)m->integer);
        break;
    case IOTOS_FLOAT:
    case IOTOS_DOUBLE:
        fprintf(json, "%.17g", m->number);
        break;
    case IOTOS_BOOLEAN:
        fputs(m->integer ? "true" : "false", json);
        break;
    case IOTOS_STRING:
        json_string(m->text, m->length);
        break;
    case IOTOS_BYTES:
        json_base64(m->text, m->length);
        break;
    default:
        fputs("null", json);
    }
}

/* Saves message index under name and describes it in expected.json. type resolves the
 * aliases of data messages. */
static void save(size_t index, const char *name, const iotos_device_type *type)
{
    char path[1024];
    const fake_message *m = &h.mqtt.published.items[index];
    FILE *f;
    snprintf(path, sizeof(path), "%s/%s", out_dir, name);
    f = fopen(path, "wb");
    TEST_ASSERT_NOT_NULL_MESSAGE(f, path);
    TEST_ASSERT_EQUAL_size_t(m->length, fwrite(m->data, 1, m->length, f));
    fclose(f);
    TEST_ASSERT_TRUE(decode_payload(m->data, m->length, &d));
    fprintf(json, "%s\n    {\"file\": \"%s\", \"topic\": \"%s\", ", written++ ? "," : "", name, m->topic);
    if (d.has_seq) {
        fprintf(json, "\"seq\": %llu, ", (unsigned long long)d.seq);
    } else {
        fputs("\"seq\": null, ", json);
    }
    fputs("\"metrics\": [", json);
    for (size_t i = 0; i < d.count; i++) {
        const decoded_metric *metric = &d.metrics[i];
        uint32_t datatype = metric->has_datatype ? metric->datatype : declared(type, metric->alias);
        fprintf(json, "%s{\"name\": \"%s\", \"alias\": ", i ? ", " : "",
                metric->has_name ? metric->name : declared_name(type, metric->alias));
        if (metric->has_alias) {
            fprintf(json, "%llu", (unsigned long long)metric->alias);
        } else {
            fputs("null", json);
        }
        fprintf(json, ", \"datatype\": \"%s\", \"value\": ", datatype_name(datatype));
        json_value(metric, datatype);
        fputc('}', json);
    }
    fputs("]}", json);
}

static size_t last(void)
{
    return h.mqtt.published.count - 1;
}

static void on_birth(void *ctx, const char *device_id, iotos_writer *w)
{
    static const uint8_t blob[] = {1, 2, 3};
    (void)ctx;
    if (!device_id) {
        return;
    }
    if (strcmp(device_id, "meter-1") == 0) {
        TEST_ASSERT_EQUAL(IOTOS_OK, iotos_put_double(w, "flow_rate", 12.5));
        TEST_ASSERT_EQUAL(IOTOS_OK, iotos_put_double(w, "total_volume", 1043.25));
        TEST_ASSERT_EQUAL(IOTOS_OK, iotos_put_bool(w, "valve_open", true));
        return;
    }
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_put_i64(w, "i8", -8));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_put_i64(w, "i16", -1600));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_put_i64(w, "i32", -320000));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_put_i64(w, "i64", -9007199254740991LL));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_put_u64(w, "u8", 200));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_put_u64(w, "u16", 60000));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_put_u64(w, "u32", 4000000000u));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_put_u64(w, "u64", 9007199254740991ULL));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_put_double(w, "f32", 1.5));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_put_double(w, "f64", -2.25));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_put_bool(w, "flag", true));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_put_string(w, "text", "hello"));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_put_datetime(w, "when", TEST_TIME - 1000));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_put_bytes(w, "blob", blob, sizeof(blob)));
}

static void publish(void (*fill)(iotos_writer *w, int n), int n)
{
    iotos_writer *w;
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_begin(&h.gw, "meter-1", &w));
    fill(w, n);
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_commit(w));
}

static void flow(iotos_writer *w, int n)
{
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_put_double(w, "flow_rate", 3.25 + n));
}

static void volume_unknown(iotos_writer *w, int n)
{
    (void)n;
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_put_null(w, "total_volume"));
}

static void write_fixtures(void)
{
    char path[1024];
    snprintf(path, sizeof(path), "%s/seq-wrap", out_dir);
    TEST_ASSERT_TRUE(mkdir(out_dir, 0755) == 0 || errno == EEXIST);
    TEST_ASSERT_TRUE(mkdir(path, 0755) == 0 || errno == EEXIST);
    snprintf(path, sizeof(path), "%s/expected.json", out_dir);
    json = fopen(path, "w");
    TEST_ASSERT_NOT_NULL(json);
    fprintf(json, "{\n  \"generator\": \"firmware/sdk/tools/fixtures.c\",\n  \"sdk_version\": \"%s\",\n"
                  "  \"timestamp_ms\": %llu,\n  \"group\": \"%s\",\n  \"edge\": \"%s\",\n  \"messages\": [",
            IOTOS_SDK_VERSION, (unsigned long long)TEST_TIME, TEST_GROUP, TEST_EDGE);

    fake_storage_reset();
    harness_init(&h, false);
    h.callbacks.on_birth = on_birth;
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_init(&h.gw, &h.settings, &h.ports, &h.callbacks));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_register_type(&h.gw, &meter_type));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_register_type(&h.gw, &all_type));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_set_firmware_version(&h.gw, "fw-1.0.0"));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_set_connection(&h.gw, IOTOS_CONN_ETHERNET, false, 0));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_device_add(&h.gw, "meter-1", &meter_type));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_device_add(&h.gw, "all-1", &all_type));
    harness_online(&h);
    TEST_ASSERT_EQUAL_size_t(3, h.mqtt.published.count);
    save(0, "nbirth-gateway.bin", &health_type);
    save(1, "dbirth-water-meter.bin", &meter_type);
    save(2, "all-datatypes.bin", &all_type);

    publish(flow, 0);
    save(last(), "ddata-alias.bin", &meter_type);
    publish(volume_unknown, 0);
    save(last(), "ddata-null.bin", &meter_type);

    fake_clock_advance(IOTOS_HEALTH_INTERVAL_S * 1000u);
    harness_poll(&h, 1, 0);
    save(last(), "ndata-health.bin", &health_type);

    for (int i = 0; i < 260; i++) {
        char name[64];
        publish(flow, i + 1);
        snprintf(name, sizeof(name), "seq-wrap/%03d.bin", i);
        save(last(), name, &meter_type);
    }

    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_device_offline(&h.gw, "meter-1"));
    save(last(), "ddeath.bin", NULL);

    /* The will, as the broker would publish it. */
    fake_messages_add(&h.mqtt.published, h.mqtt.will_topic, strlen(h.mqtt.will_topic), h.mqtt.will,
                      h.mqtt.will_length, 1, false);
    save(last(), "ndeath-will.bin", NULL);

    fputs("\n  ]\n}\n", json);
    fclose(json);
    harness_free(&h);
}

int main(int argc, char **argv)
{
    if (argc != 2) {
        fprintf(stderr, "usage: %s <output directory>\n", argv[0]);
        return 2;
    }
    out_dir = argv[1];
    UNITY_BEGIN();
    RUN_TEST(write_fixtures);
    return UNITY_END();
}
