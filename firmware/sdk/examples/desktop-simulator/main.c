/* SPDX-License-Identifier: MIT */
/*
 * Desktop gateway simulator: the same SDK code a board runs, publishing many simulated
 * downstream devices over TLS. Built inside a starter, it uses the starter's generated/
 * and config/; built in the repository, the sample config.
 *
 *   gateway-sim --devices water_meter=500 [--devices <type>=<count> ...]
 *               [--interval <seconds>] [--state-file <directory>]
 *
 * Integers count up, numbers follow a random walk, booleans toggle, strings read
 * sim-<n> and timestamps are now. Metrics that accept commands change only by command:
 * the simulator applies each one and publishes the new state from on_command, which is
 * how the platform confirms a command.
 *
 * A direct-device starter (IOTOS_KIT_ROLE_GATEWAY 0) simulates the node's own metrics
 * instead and refuses --devices. The birth rate is IOTOS_BIRTHS_PER_SECOND, set when building.
 */
#define _POSIX_C_SOURCE 200809L
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "iotos/iotos.h"
#include "iotos_posix.h"
#include "iotos_starter.h"
#include "iotos_types.h"

#ifdef IOTOS_KIT_HAVE_SETTINGS
#include "iotos_settings.h"
#if IOTOS_KIT_SETTINGS_FORMAT != 1
#error "These connection settings need a newer starter"
#endif
#if IOTOS_KIT_GATEWAY != IOTOS_KIT_ROLE_GATEWAY
#error "These connection settings are for the other role: a gateway's settings need a gateway starter, and a direct device's a direct one"
#endif
#endif

#ifdef IOTOS_SIM_SELFTEST
#include "fakes.h"
#include "unity.h"
#endif

typedef struct {
    char id[IOTOS_DEVICE_ID_MAX + 1];
    const iotos_device_type *type;
    double numbers[IOTOS_MAX_METRICS_PER_TYPE];
    int64_t counters[IOTOS_MAX_METRICS_PER_TYPE];
    bool flags[IOTOS_MAX_METRICS_PER_TYPE];
    uint32_t tick;
} sim_device;

typedef struct {
    const iotos_device_type *type;
    int count;
} fleet_entry;

/* The array always has one entry (a single NULL in a direct-device kit), so this never
 * compares an unsigned count with zero. */
#define KIT_TYPES (sizeof(iotos_kit_types) / sizeof(iotos_kit_types[0]))

static iotos_gateway gateway;
static iotos_settings settings; /* iotos_kit_settings with the node type set */
static sim_device *devices;
static int device_count;
static sim_device node; /* a direct device's own metrics */
static volatile sig_atomic_t stopping;
static uint32_t random_state = 2463534242u;

static double next_random(void)
{
    random_state ^= random_state << 13;
    random_state ^= random_state >> 17;
    random_state ^= random_state << 5;
    return (double)(random_state % 10000u) / 10000.0;
}

static uint64_t utc_ms(void)
{
    struct timespec ts;
    clock_gettime(CLOCK_REALTIME, &ts);
    return (uint64_t)ts.tv_sec * 1000u + (uint64_t)ts.tv_nsec / 1000000u;
}

static sim_device *find(const char *id)
{
    if (!id) {
        return &node;
    }
    for (int i = 0; i < device_count; i++) {
        if (strcmp(devices[i].id, id) == 0) {
            return &devices[i];
        }
    }
    return NULL;
}

static void seed(sim_device *d, int index)
{
    for (uint16_t m = 0; m < d->type->metric_count; m++) {
        d->numbers[m] = 20.0 + index % 50 + m;
        d->counters[m] = index;
        d->flags[m] = false;
    }
}

/* Moves every metric that does not accept commands one step. */
static void step(sim_device *d)
{
    d->tick++;
    for (uint16_t m = 0; m < d->type->metric_count; m++) {
        const iotos_metric_def *def = &d->type->metrics[m];
        if (def->writable) {
            continue;
        }
        switch (def->datatype) {
        case IOTOS_BOOLEAN:
            d->flags[m] = !d->flags[m];
            break;
        case IOTOS_FLOAT:
        case IOTOS_DOUBLE:
            d->numbers[m] += next_random() - 0.5;
            break;
        default:
            d->counters[m] = (d->counters[m] + 1) % 100;
            break;
        }
    }
}

static void write_values(sim_device *d, iotos_writer *w)
{
    char text[32];
    uint8_t bytes[4];
    for (uint16_t m = 0; m < d->type->metric_count; m++) {
        const iotos_metric_def *def = &d->type->metrics[m];
        switch (def->datatype) {
        case IOTOS_BOOLEAN:
            (void)iotos_put_bool(w, def->name, d->flags[m]);
            break;
        case IOTOS_FLOAT:
        case IOTOS_DOUBLE:
            (void)iotos_put_double(w, def->name, d->numbers[m]);
            break;
        case IOTOS_STRING:
            snprintf(text, sizeof(text), "sim-%u", (unsigned)d->tick);
            (void)iotos_put_string(w, def->name, text);
            break;
        case IOTOS_DATETIME:
            (void)iotos_put_datetime(w, def->name, utc_ms());
            break;
        case IOTOS_BYTES:
            memcpy(bytes, &d->tick, sizeof(bytes));
            (void)iotos_put_bytes(w, def->name, bytes, sizeof(bytes));
            break;
        default:
            (void)iotos_put_i64(w, def->name, d->counters[m]);
            break;
        }
    }
}

static void publish(sim_device *d)
{
    iotos_writer *w;
    if (iotos_begin(&gateway, d == &node ? NULL : d->id, &w) != IOTOS_OK) {
        return;
    }
    write_values(d, w);
    (void)iotos_commit(w); /* IOTOS_PENDING_BIRTH or IOTOS_E_OFFLINE: the birth or the next round carries it */
}

static void on_birth(void *ctx, const char *device_id, iotos_writer *w)
{
    sim_device *d = find(device_id);
    (void)ctx;
    if (d && d->type && (device_id || !IOTOS_KIT_ROLE_GATEWAY)) {
        write_values(d, w);
    }
}

static void on_command(void *ctx, const char *device_id, const char *metric, const iotos_value *value)
{
    sim_device *d = find(device_id);
    iotos_writer *w;
    (void)ctx;
    if (!d || !d->type) {
        return;
    }
    for (uint16_t m = 0; m < d->type->metric_count; m++) {
        if (strcmp(d->type->metrics[m].name, metric) != 0) {
            continue;
        }
        switch (value->datatype) {
        case IOTOS_BOOLEAN:
            d->flags[m] = value->as.boolean;
            break;
        case IOTOS_FLOAT:
        case IOTOS_DOUBLE:
            d->numbers[m] = value->as.number;
            break;
        case IOTOS_UINT8:
        case IOTOS_UINT16:
        case IOTOS_UINT32:
        case IOTOS_UINT64:
            d->counters[m] = (int64_t)value->as.u64;
            break;
        default:
            d->counters[m] = value->as.i64;
            break;
        }
        printf("command: %s %s applied\n", device_id ? device_id : "(node)", metric);
        fflush(stdout);
    }
    /* Confirm by publishing the new state straight away. */
    if (iotos_begin(&gateway, device_id, &w) == IOTOS_OK) {
        write_values(d, w);
        (void)iotos_commit(w);
    }
}

static void on_event(void *ctx, iotos_event event, iotos_status detail)
{
    static const char *const names[] = {"connected",      "connect failed", "credentials refused",
                                        "disconnected",   "session takeover", "host online",
                                        "host offline",   "rebirth requested", "online",
                                        "clock not set",  "birth failed", "command rejected"};
    (void)ctx;
    printf("event: %s (%s)\n", (unsigned)event < sizeof(names) / sizeof(names[0]) ? names[event] : "?",
           iotos_status_text(detail));
    fflush(stdout);
}

static const iotos_device_type *type_named(const char *code)
{
    for (size_t i = 0; i < KIT_TYPES; i++) {
        if (iotos_kit_types[i] && strcmp(iotos_kit_types[i]->code, code) == 0) {
            return iotos_kit_types[i];
        }
    }
    return NULL;
}

/* Registers the types and adds the devices, IDs sim-<type>-<nnn>. */
static int setup(const fleet_entry *fleet, int fleet_count)
{
    int total = 0;
    for (int i = 0; i < fleet_count; i++) {
        total += fleet[i].count;
    }
    devices = calloc(total ? (size_t)total : 1u, sizeof(*devices));
    if (!devices) {
        return 1;
    }
    for (size_t i = 0; i < KIT_TYPES; i++) {
        if (iotos_kit_types[i] && iotos_register_type(&gateway, iotos_kit_types[i]) != IOTOS_OK) {
            fprintf(stderr, "could not register type %s\n", iotos_kit_types[i]->code);
            return 1;
        }
    }
    for (int i = 0; i < fleet_count; i++) {
        for (int n = 0; n < fleet[i].count; n++) {
            sim_device *d = &devices[device_count];
            iotos_status status;
            snprintf(d->id, sizeof(d->id), "sim-%.14s-%03u", fleet[i].type->code, (unsigned)n % 100000u);
            d->type = fleet[i].type;
            seed(d, device_count);
            status = iotos_device_add(&gateway, d->id, d->type);
            if (status != IOTOS_OK) {
                fprintf(stderr, "could not add %s: %s\n", d->id, iotos_status_text(status));
                return 1;
            }
            device_count++;
        }
    }
    node.type = settings.node_type;
    if (node.type) {
        seed(&node, 0);
    }
    return 0;
}

static void publish_all(void)
{
    for (int i = 0; i < device_count; i++) {
        step(&devices[i]);
        publish(&devices[i]);
    }
    if (!IOTOS_KIT_ROLE_GATEWAY && node.type) {
        step(&node);
        publish(&node);
    }
}

static const iotos_callbacks callbacks = {on_birth, on_command, on_event, NULL};

#ifdef IOTOS_SIM_SELFTEST
/* In-process against the fake level 2 port: an NBIRTH, 500 DBIRTHs in seq order, then data. */
static fake_mqtt selftest_mqtt;

void setUp(void) {}
void tearDown(void) {}

static void selftest(void)
{
    static iotos_mqtt_port port;
    static iotos_ports ports;
    static decoded d;
    static const iotos_callbacks quiet = {on_birth, on_command, NULL, NULL};
    char state_topic[IOTOS_TOPIC_MAX];
    const char *online = "{\"online\":true,\"timestamp\":1712345000000}";
    fleet_entry fleet[2] = {{iotos_kit_types[0], 250}, {iotos_kit_types[1], 250}};
    size_t births;

    fake_clock_reset(TEST_TIME, true);
    fake_lock_reset();
    fake_mqtt_init(&selftest_mqtt, &port);
    ports.mqtt = &port;
    ports.clock = &fake_clock;
    ports.lock = &fake_lock;
    settings = iotos_kit_settings;
    settings.node_type = &iotos_kit_node_type;
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_init(&gateway, &settings, &ports, &quiet));
    selftest_mqtt.gw = &gateway;
    TEST_ASSERT_EQUAL(0, setup(fleet, 2));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_start(&gateway));
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_poll(&gateway, 10));
    snprintf(state_topic, sizeof(state_topic), "spBv1.0/STATE/%s", settings.host_id);
    fake_mqtt_inject(&selftest_mqtt, state_topic, (const uint8_t *)online, strlen(online), true);
    for (int i = 0; i < 1000 && selftest_mqtt.published.count < 501; i++) {
        TEST_ASSERT_EQUAL(IOTOS_OK, iotos_poll(&gateway, 10));
        fake_clock_advance(50);
    }
    births = selftest_mqtt.published.count;
    TEST_ASSERT_EQUAL_size_t(501, births);
    publish_all();
    TEST_ASSERT_EQUAL_size_t(births + 500, selftest_mqtt.published.count);
    for (size_t i = 0; i < selftest_mqtt.published.count; i++) {
        const fake_message *m = &selftest_mqtt.published.items[i];
        const char *kind = i == 0 ? "/NBIRTH/" : i <= 500 ? "/DBIRTH/" : "/DDATA/";
        TEST_ASSERT_NOT_NULL_MESSAGE(strstr(m->topic, kind), m->topic);
        TEST_ASSERT_TRUE(decode_payload(m->data, m->length, &d));
        TEST_ASSERT_EQUAL_UINT64(i % 256, d.seq);
    }
    TEST_ASSERT_EQUAL(IOTOS_OK, iotos_stop(&gateway));
    fake_mqtt_free(&selftest_mqtt);
    free(devices);
}
#endif

static void request_stop(int signal_number)
{
    (void)signal_number;
    stopping = 1;
}

static int usage(const char *program)
{
    fprintf(stderr,
            "usage: %s [--devices <type>=<count> ...] [--interval <seconds>] [--state-file <directory>]\n",
            program);
    fprintf(stderr, "types:");
    for (size_t i = 0; i < KIT_TYPES; i++) {
        if (iotos_kit_types[i]) {
            fprintf(stderr, " %s", iotos_kit_types[i]->code);
        }
    }
    fprintf(stderr, "\n");
    return 2;
}

int main(int argc, char **argv)
{
    fleet_entry fleet[IOTOS_MAX_DEVICE_TYPES];
    int fleet_count = 0;
    int interval_s = 10;
    const char *state_directory = NULL;
    static iotos_posix posix;
    uint32_t next_publish;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--selftest") == 0) {
#ifdef IOTOS_SIM_SELFTEST
            UNITY_BEGIN();
            RUN_TEST(selftest);
            return UNITY_END();
#else
            fprintf(stderr, "--selftest is only built in the SDK repository\n");
            return 2;
#endif
        } else if (strcmp(argv[i], "--devices") == 0 && i + 1 < argc) {
            char code[64];
            const char *equals = strchr(argv[++i], '=');
            size_t length = equals ? (size_t)(equals - argv[i]) : 0;
            if (!IOTOS_KIT_ROLE_GATEWAY) {
                fprintf(stderr, "this is a direct-device starter: it simulates its own metrics and takes no --devices\n");
                return 2;
            }
            if (!equals || length >= sizeof(code) || fleet_count == IOTOS_MAX_DEVICE_TYPES) {
                return usage(argv[0]);
            }
            memcpy(code, argv[i], length);
            code[length] = '\0';
            fleet[fleet_count].type = type_named(code);
            fleet[fleet_count].count = atoi(equals + 1);
            if (!fleet[fleet_count].type || fleet[fleet_count].count < 0) {
                fprintf(stderr, "unknown device type %s\n", code);
                return usage(argv[0]);
            }
            fleet_count++;
        } else if (strcmp(argv[i], "--interval") == 0 && i + 1 < argc) {
            interval_s = atoi(argv[++i]);
            if (interval_s < 1) {
                return usage(argv[0]);
            }
        } else if (strcmp(argv[i], "--state-file") == 0 && i + 1 < argc) {
            state_directory = argv[++i];
        } else {
            return usage(argv[0]);
        }
    }

    if (!iotos_kit_settings_present) {
        fprintf(stderr, "No connection settings: download them from the device's page in IoT OS and put the files in config/\n");
        return 2;
    }
    settings = iotos_kit_settings;
    settings.node_type = &iotos_kit_node_type;
    if (iotos_posix_ports_init(&posix, state_directory, IOTOS_LOG_INFO) != IOTOS_OK
        || iotos_init(&gateway, &settings, &posix.ports, &callbacks) != IOTOS_OK) {
        fprintf(stderr, "could not initialise the SDK: check config/iotos_settings.h\n");
        return 1;
    }
    if (setup(fleet, fleet_count) != 0) {
        return 1;
    }
    (void)iotos_set_firmware_version(&gateway, "desktop-simulator " IOTOS_SDK_VERSION);
    (void)iotos_set_connection(&gateway, IOTOS_CONN_ETHERNET, false, 0);
    signal(SIGINT, request_stop);
    signal(SIGTERM, request_stop);
    printf("simulating %d devices for %s/%s at %s:%u\n", device_count, settings.group_id, settings.edge_node_id,
           settings.broker_host, (unsigned)settings.broker_port);
    fflush(stdout);

    (void)iotos_start(&gateway);
    next_publish = iotos_posix_monotonic_ms() + (uint32_t)interval_s * 1000u;
    while (!stopping) {
        (void)iotos_poll(&gateway, 50);
        if ((uint32_t)(iotos_posix_monotonic_ms() - next_publish) < 0x80000000u) {
            next_publish += (uint32_t)interval_s * 1000u;
            publish_all();
        }
    }
    printf("stopping\n");
    (void)iotos_stop(&gateway);
    iotos_posix_ports_free(&posix);
    free(devices);
    return 0;
}
