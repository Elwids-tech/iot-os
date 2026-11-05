/* SPDX-License-Identifier: MIT */
/*
 * The program: brings up Ethernet with DHCP, sets the clock with SNTP, connects with the
 * settings in config/, registers the device types in generated/, adds the devices listed
 * in field.c and publishes what field.c reads. A direct device publishes its own metrics
 * as the node; a gateway publishes each device behind it, and the SDK fills the node's
 * health metrics. A gateway also polls the RS-485 bus (modbus_rtu.c).
 *
 * The SDK owns Sparkplug: births, deaths, sequence numbers, aliases and rebirths. This
 * file only decides when to read. The hardware is read in field.c.
 *
 * Tasks: "net" brings up the network and the clock, then starts the others and ends;
 * "iotos" runs the SDK (iotos_poll and every read, so every callback runs on it); "rs485"
 * polls the bus on a gateway. lwIP reports the cable coming and going (on_netif). Settings: APP_POLL_INTERVAL_S (seconds between reads),
 * APP_OFFLINE_AFTER_POLLS (missed reads before a device is marked offline) and
 * APP_SNTP_SERVER, set when building. bdSeq lives in RAM: add a storage port to keep it.
 */
#include <stdio.h>
#include <string.h>

#include "FreeRTOS.h"
#include "app.h"
#include "board.h"
#include "ethernetif.h"
#include "field.h"
#include "fsl_debug_console.h"
#include "fsl_silicon_id.h"
#include "iotos/iotos.h"
#include "iotos_mcux.h"
#include "iotos_starter.h"
#include "iotos_types.h"
#include "lwip/dhcp.h"
#include "lwip/netifapi.h"
#include "lwip/tcpip.h"
#include "modbus_rtu.h"
#include "task.h"

#ifdef IOTOS_KIT_HAVE_SETTINGS
#include "iotos_settings.h"
#if IOTOS_KIT_SETTINGS_FORMAT != 1
#error "These connection settings need a newer starter"
#endif
#if IOTOS_KIT_GATEWAY != IOTOS_KIT_ROLE_GATEWAY
#error "These connection settings are for the other role: a gateway's settings need a gateway starter, and a direct device's a direct one"
#endif
#endif

#ifndef APP_POLL_INTERVAL_S
#define APP_POLL_INTERVAL_S 10
#endif
#ifndef APP_OFFLINE_AFTER_POLLS
#define APP_OFFLINE_AFTER_POLLS 3
#endif
#ifndef APP_FIRMWARE_VERSION
#define APP_FIRMWARE_VERSION "0.1.0"
#endif
#ifndef APP_SNTP_SERVER
#define APP_SNTP_SERVER "pool.ntp.org"
#endif

/* The array always has one entry (a single NULL for a direct device), so this never
 * compares an unsigned count with zero. */
#define KIT_TYPES (sizeof(iotos_kit_types) / sizeof(iotos_kit_types[0]))

#define NET_TASK_STACK (2048 / sizeof(StackType_t))
#define IOTOS_TASK_STACK (8192 / sizeof(StackType_t)) /* the TLS handshake runs here */

static iotos_gateway gateway;
static iotos_mcux mcux;
static iotos_settings settings; /* iotos_kit_settings with the node type set */
static unsigned char missed[IOTOS_MAX_DEVICES]; /* reads in a row a device did not answer */
static phy_handle_t phy;
static struct netif netif;
static volatile bool link_up;

static const iotos_device_type *type_named(const char *code)
{
    for (size_t i = 0; i < KIT_TYPES; i++) {
        if (iotos_kit_types[i] && strcmp(iotos_kit_types[i]->code, code) == 0) {
            return iotos_kit_types[i];
        }
    }
    return NULL;
}

/* The type of the device with this ID; NULL is the node. */
static const iotos_device_type *type_of(const char *device_id)
{
    if (!device_id) {
        return &iotos_kit_node_type;
    }
    for (size_t i = 0; i < field_device_count; i++) {
        if (strcmp(field_devices[i].id, device_id) == 0) {
            return type_named(field_devices[i].type);
        }
    }
    return NULL;
}

static iotos_status put(iotos_writer *w, const iotos_metric_def *metric, const iotos_value *value)
{
    if (value->is_null) {
        return iotos_put_null(w, metric->name);
    }
    switch (metric->datatype) {
    case IOTOS_BOOLEAN:
        return iotos_put_bool(w, metric->name, value->as.boolean);
    case IOTOS_UINT8:
    case IOTOS_UINT16:
    case IOTOS_UINT32:
    case IOTOS_UINT64:
        return iotos_put_u64(w, metric->name, value->as.u64);
    case IOTOS_FLOAT:
    case IOTOS_DOUBLE:
        return iotos_put_double(w, metric->name, value->as.number);
    case IOTOS_STRING:
        return iotos_put_string(w, metric->name, value->as.string);
    case IOTOS_DATETIME:
        return iotos_put_datetime(w, metric->name, value->as.utc_ms);
    case IOTOS_BYTES:
        return iotos_put_bytes(w, metric->name, value->as.bytes.data, value->as.bytes.length);
    default:
        return iotos_put_i64(w, metric->name, value->as.i64);
    }
}

/* Puts every metric field.c can read now. Returns how many were put, or -1 when the
 * device did not answer. A metric that is unavailable is left out: births send it as a
 * null, and data messages skip it. */
static int put_readings(iotos_writer *w, const iotos_device_type *type, const char *device_id)
{
    int count = 0;
    bool answered = false, offline = false;
    for (uint16_t m = 0; m < type->metric_count; m++) {
        iotos_value value;
        field_status status;
        memset(&value, 0, sizeof(value));
        value.datatype = type->metrics[m].datatype;
        status = field_read(type->code, type->metrics[m].name, device_id, &value);
        if (status == FIELD_OK) {
            answered = true;
            if (put(w, &type->metrics[m], &value) == IOTOS_OK) {
                count++;
            } else {
                PRINTF("app: field.c returned a value the SDK refused for %s\r\n", type->metrics[m].name);
            }
        } else if (status == FIELD_OFFLINE) {
            offline = true;
        }
    }
    return offline && !answered ? -1 : count;
}

static void on_birth(void *ctx, const char *device_id, iotos_writer *w)
{
    const iotos_device_type *type = type_of(device_id);
    (void)ctx;
    /* This runs with the SDK's lock held, so field_read must be quick here: return the
     * last value read (modbus_rtu.c keeps them) when reading the hardware takes long. */
    if (type) {
        (void)put_readings(w, type, device_id);
    }
}

static void on_command(void *ctx, const char *device_id, const char *metric, const iotos_value *value)
{
    const iotos_device_type *type = type_of(device_id);
    iotos_writer *w;
    (void)ctx;
    if (!type) {
        return;
    }
    if (field_command(type->code, metric, device_id, value) != FIELD_OK) {
        PRINTF("app: field.c did not apply %s on %s\r\n", metric, device_id ? device_id : "the node");
        return;
    }
    /* The platform confirms a command when it sees the new state: read it back now. */
    for (uint16_t m = 0; m < type->metric_count; m++) {
        iotos_value state;
        if (strcmp(type->metrics[m].name, metric) != 0) {
            continue;
        }
        memset(&state, 0, sizeof(state));
        state.datatype = type->metrics[m].datatype;
        if (field_read(type->code, metric, device_id, &state) == FIELD_OK
            && iotos_begin(&gateway, device_id, &w) == IOTOS_OK) {
            if (put(w, &type->metrics[m], &state) == IOTOS_OK) {
                (void)iotos_commit(w);
            } else {
                iotos_abort(w);
            }
        }
    }
}

static void on_event(void *ctx, iotos_event event, iotos_status detail)
{
    static const char *const names[] = {"connected",      "connect failed",    "credentials refused",
                                        "disconnected",   "session takeover",  "host online",
                                        "host offline",   "rebirth requested", "online",
                                        "clock not set",  "birth failed",      "command rejected"};
    (void)ctx;
    PRINTF("app: event: %s (%s)\r\n", (unsigned)event < sizeof(names) / sizeof(names[0]) ? names[event] : "?",
           iotos_status_text(detail));
}

static void publish(const char *device_id, const iotos_device_type *type, unsigned char *misses)
{
    iotos_writer *w;
    int count;
    if (iotos_begin(&gateway, device_id, &w) != IOTOS_OK) {
        return;
    }
    count = put_readings(w, type, device_id);
    if (count > 0) {
        (void)iotos_commit(w); /* IOTOS_PENDING_BIRTH or IOTOS_E_OFFLINE: the birth or the next round carries it */
    } else {
        iotos_abort(w);
    }
    if (!misses) {
        return;
    }
    if (count >= 0) {
        *misses = 0;
    } else if (*misses < APP_OFFLINE_AFTER_POLLS && ++*misses == APP_OFFLINE_AFTER_POLLS) {
        (void)iotos_device_offline(&gateway, device_id); /* its next answer brings a new birth */
    }
}

static void publish_all(void)
{
    if (!IOTOS_KIT_ROLE_GATEWAY) {
        publish(NULL, &iotos_kit_node_type, NULL);
    }
    for (size_t i = 0; i < field_device_count; i++) {
        const iotos_device_type *type = type_named(field_devices[i].type);
        if (type) {
            publish(field_devices[i].id, type, &missed[i]);
        }
    }
}

static int add_devices(void)
{
    for (size_t i = 0; i < KIT_TYPES; i++) {
        if (iotos_kit_types[i] && iotos_register_type(&gateway, iotos_kit_types[i]) != IOTOS_OK) {
            PRINTF("app: could not register type %s\r\n", iotos_kit_types[i]->code);
            return 1;
        }
    }
    if (field_device_count > IOTOS_MAX_DEVICES) {
        PRINTF("app: field.c lists more than IOTOS_MAX_DEVICES devices\r\n");
        return 1;
    }
    for (size_t i = 0; i < field_device_count; i++) {
        const iotos_device_type *type = type_named(field_devices[i].type);
        iotos_status status = type ? iotos_device_add(&gateway, field_devices[i].id, type) : IOTOS_E_INVALID;
        if (status != IOTOS_OK) {
            PRINTF("app: could not add %s (type %s): %s\r\n", field_devices[i].id, field_devices[i].type,
                   iotos_status_text(status));
            return 1;
        }
    }
    return 0;
}

/* The SDK's task: every callback runs here. The SDK reconnects to the broker by itself
 * when the cable comes back. */
static void iotos_task(void *arg)
{
    uint32_t next_read;
    (void)arg;
    (void)iotos_start(&gateway);
    next_read = iotos_mcux_monotonic_ms() + APP_POLL_INTERVAL_S * 1000u;
    for (;;) {
        (void)iotos_poll(&gateway, 50);
        if ((uint32_t)(iotos_mcux_monotonic_ms() - next_read) < 0x80000000u) {
            next_read += APP_POLL_INTERVAL_S * 1000u;
            (void)iotos_set_connection(&gateway, IOTOS_CONN_ETHERNET, link_up, 0);
            publish_all();
        }
        vTaskDelay(1); /* iotos_poll returns at once while it waits to reconnect: let other tasks run */
    }
}

static void on_netif(struct netif *n, netif_nsc_reason_t reason, const netif_ext_callback_args_t *args)
{
    (void)args;
    if (reason & LWIP_NSC_LINK_CHANGED) {
        link_up = netif_is_link_up(n);
        PRINTF("app: Ethernet link %s\r\n", link_up ? "up" : "down: reconnecting when it returns");
    }
    if ((reason & LWIP_NSC_IPV4_ADDRESS_CHANGED) && !ip4_addr_isany_val(*netif_ip4_addr(n))) {
        PRINTF("app: address %s\r\n", ip4addr_ntoa(netif_ip4_addr(n)));
    }
}

/* Brings up Ethernet with DHCP and waits for an address. */
static void start_network(void)
{
    static netif_ext_callback_t watch;
    ethernetif_config_t config = {
        .phyHandle = &phy,
        .phyAddr = EXAMPLE_PHY_ADDRESS,
        .phyOps = EXAMPLE_PHY_OPS,
        .phyResource = EXAMPLE_PHY_RESOURCE,
        .srcClockHz = EXAMPLE_CLOCK_FREQ,
    };
    (void)SILICONID_ConvertToMacAddr(&config.macAddress);
    tcpip_init(NULL, NULL);
    LOCK_TCPIP_CORE();
    netif_add_ext_callback(&watch, on_netif);
    UNLOCK_TCPIP_CORE();
    (void)netifapi_netif_add(&netif, NULL, NULL, NULL, &config, ethernetif0_init, tcpip_input);
    (void)netifapi_netif_set_default(&netif);
    (void)netifapi_netif_set_up(&netif);
    (void)netifapi_dhcp_start(&netif);
    while (ethernetif_wait_linkup(&netif, 5000) != ERR_OK) {
        PRINTF("app: no Ethernet link: check the cable\r\n");
    }
    link_up = true;
    PRINTF("app: getting an address from DHCP\r\n");
    (void)ethernetif_wait_ipv4_valid(&netif, ETHERNETIF_WAIT_FOREVER);
}

static const iotos_callbacks callbacks = {on_birth, on_command, on_event, NULL};

static void net_task(void *arg)
{
    (void)arg;
    if (field_init() != 0) {
        PRINTF("app: field_init failed\r\n");
        vTaskDelete(NULL);
    }
    start_network();
    if (iotos_mcux_ports_init(&mcux, APP_SNTP_SERVER, IOTOS_LOG_INFO) != IOTOS_OK
        || iotos_init(&gateway, &settings, &mcux.ports, &callbacks) != IOTOS_OK) {
        PRINTF("app: could not initialise the SDK: check config/iotos_settings.h\r\n");
        vTaskDelete(NULL);
    }
    if (add_devices() != 0) {
        vTaskDelete(NULL);
    }
    (void)iotos_set_firmware_version(&gateway, APP_FIRMWARE_VERSION);
    (void)iotos_set_connection(&gateway, IOTOS_CONN_ETHERNET, true, 0);
    PRINTF("app: connecting %s/%s to %s:%u with %u devices\r\n", settings.group_id, settings.edge_node_id,
           settings.broker_host, (unsigned)settings.broker_port, (unsigned)field_device_count);
    if (xTaskCreate(iotos_task, "iotos", IOTOS_TASK_STACK, NULL, DEFAULT_THREAD_PRIO, NULL) != pdPASS) {
        PRINTF("app: not enough memory for the SDK's task\r\n");
    }
#if IOTOS_KIT_ROLE_GATEWAY
    if (modbus_rtu_start() != 0) {
        PRINTF("app: could not start the RS-485 poller\r\n");
    }
#endif
    vTaskDelete(NULL);
}

int main(void)
{
    BOARD_InitHardware();
    if (!iotos_kit_settings_present) {
        PRINTF("No connection settings: download them from the device's page in IoT OS and put the files in config/\r\n");
        for (;;) {
        }
    }
    settings = iotos_kit_settings;
    settings.node_type = &iotos_kit_node_type;
    if (xTaskCreate(net_task, "net", NET_TASK_STACK, NULL, DEFAULT_THREAD_PRIO, NULL) != pdPASS) {
        PRINTF("app: not enough memory to start\r\n");
        for (;;) {
        }
    }
    vTaskStartScheduler();
    return 0;
}

void vApplicationMallocFailedHook(void)
{
    PRINTF("app: out of heap memory: raise __heap_size__ in CMakeLists.txt\r\n");
    taskDISABLE_INTERRUPTS();
    for (;;) {
    }
}

void vApplicationStackOverflowHook(TaskHandle_t task, char *name)
{
    (void)task;
    PRINTF("app: task %s overflowed its stack\r\n", name);
    taskDISABLE_INTERRUPTS();
    for (;;) {
    }
}
