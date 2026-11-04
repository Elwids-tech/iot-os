/* SPDX-License-Identifier: MIT */
/*
 * The program: joins the Wi-Fi network, connects with the settings in config/, registers
 * the device types in generated/, adds the devices listed in field.c and publishes what
 * field.c reads. A direct device publishes its own metrics as the node; a gateway
 * publishes each device behind it, and the SDK fills the node's health metrics.
 *
 * The SDK owns Sparkplug: births, deaths, sequence numbers, aliases and rebirths. This
 * file only decides when to read. The hardware is read in field.c.
 *
 * Settings: APP_POLL_INTERVAL_S (seconds between reads) and APP_OFFLINE_AFTER_POLLS (missed
 * reads before a device is marked offline), set when building. The Wi-Fi network and the
 * SNTP server are set with idf.py menuconfig, under "IoT OS application". bdSeq is kept in
 * NVS between boots.
 */
#include <stdio.h>
#include <string.h>

#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "field.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"
#include "iotos/iotos.h"
#include "iotos_esp_idf.h"
#include "iotos_starter.h"
#include "iotos_types.h"
#include "nvs_flash.h"

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

/* The array always has one entry (a single NULL for a direct device), so this never
 * compares an unsigned count with zero. */
#define KIT_TYPES (sizeof(iotos_kit_types) / sizeof(iotos_kit_types[0]))

#define WIFI_CONNECTED BIT0

static const char *const TAG = "app";
static iotos_gateway gateway;
static iotos_settings settings; /* iotos_kit_settings with the node type set */
static unsigned char missed[IOTOS_MAX_DEVICES]; /* reads in a row a device did not answer */
static EventGroupHandle_t wifi_events;

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
                ESP_LOGW(TAG, "field.c returned a value the SDK refused for %s", type->metrics[m].name);
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
     * last value read when reading the hardware takes long. */
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
        ESP_LOGW(TAG, "field.c did not apply %s on %s", metric, device_id ? device_id : "the node");
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
    ESP_LOGI(TAG, "event: %s (%s)", (unsigned)event < sizeof(names) / sizeof(names[0]) ? names[event] : "?",
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
            ESP_LOGE(TAG, "could not register type %s", iotos_kit_types[i]->code);
            return 1;
        }
    }
    if (field_device_count > IOTOS_MAX_DEVICES) {
        ESP_LOGE(TAG, "field.c lists more than IOTOS_MAX_DEVICES devices");
        return 1;
    }
    for (size_t i = 0; i < field_device_count; i++) {
        const iotos_device_type *type = type_named(field_devices[i].type);
        iotos_status status = type ? iotos_device_add(&gateway, field_devices[i].id, type) : IOTOS_E_INVALID;
        if (status != IOTOS_OK) {
            ESP_LOGE(TAG, "could not add %s (type %s): %s", field_devices[i].id, field_devices[i].type,
                     iotos_status_text(status));
            return 1;
        }
    }
    return 0;
}

/* Reconnects whenever the network drops; the SDK reconnects to the broker by itself. */
static void on_wifi(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    (void)arg;
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        (void)esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        xEventGroupClearBits(wifi_events, WIFI_CONNECTED);
        ESP_LOGW(TAG, "Wi-Fi disconnected (reason %d): reconnecting",
                 ((const wifi_event_sta_disconnected_t *)data)->reason);
        (void)esp_wifi_connect();
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        ESP_LOGI(TAG, "Wi-Fi connected, address " IPSTR, IP2STR(&((const ip_event_got_ip_t *)data)->ip_info.ip));
        xEventGroupSetBits(wifi_events, WIFI_CONNECTED);
    }
}

/* Copies a menuconfig string into a fixed Wi-Fi field, which needs no terminating NUL. */
static void copy_field(uint8_t *out, size_t size, const char *text)
{
    size_t length = strlen(text);
    memcpy(out, text, length < size ? length : size);
}

/* Joins the network set in menuconfig and waits for an address. */
static int start_wifi(void)
{
    wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
    wifi_config_t config;
    if (strlen(CONFIG_IOTOS_WIFI_SSID) == 0) {
        ESP_LOGE(TAG, "No Wi-Fi network: set it with idf.py menuconfig, under IoT OS application");
        return 1;
    }
    memset(&config, 0, sizeof(config));
    copy_field(config.sta.ssid, sizeof(config.sta.ssid), CONFIG_IOTOS_WIFI_SSID);
    copy_field(config.sta.password, sizeof(config.sta.password), CONFIG_IOTOS_WIFI_PASSWORD);
    config.sta.threshold.authmode = strlen(CONFIG_IOTOS_WIFI_PASSWORD) ? WIFI_AUTH_WPA2_PSK : WIFI_AUTH_OPEN;

    wifi_events = xEventGroupCreate();
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();
    ESP_ERROR_CHECK(esp_wifi_init(&init));
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, on_wifi, NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, on_wifi, NULL));
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &config));
    ESP_ERROR_CHECK(esp_wifi_start());
    ESP_LOGI(TAG, "joining Wi-Fi network %s", CONFIG_IOTOS_WIFI_SSID);
    xEventGroupWaitBits(wifi_events, WIFI_CONNECTED, pdFALSE, pdTRUE, portMAX_DELAY);
    return 0;
}

/* The health metrics show the signal the gateway has now. */
static void report_signal(void)
{
    wifi_ap_record_t access_point;
    bool connected = esp_wifi_sta_get_ap_info(&access_point) == ESP_OK;
    (void)iotos_set_connection(&gateway, IOTOS_CONN_WIFI, connected, connected ? access_point.rssi : 0);
}

static const iotos_callbacks callbacks = {on_birth, on_command, on_event, NULL};

void app_main(void)
{
    static iotos_esp_idf esp;
    uint32_t next_read;
    esp_err_t err;

    if (!iotos_kit_settings_present) {
        ESP_LOGE(TAG, "No connection settings: download them from the device's page in IoT OS and put the files in config/");
        return;
    }
    settings = iotos_kit_settings;
    settings.node_type = &iotos_kit_node_type;
    err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    ESP_ERROR_CHECK(err);
    if (field_init() != 0) {
        ESP_LOGE(TAG, "field_init failed");
        return;
    }
    if (start_wifi() != 0) {
        return;
    }
    if (iotos_esp_idf_ports_init(&esp, CONFIG_IOTOS_SNTP_SERVER, IOTOS_LOG_INFO) != IOTOS_OK
        || iotos_init(&gateway, &settings, &esp.ports, &callbacks) != IOTOS_OK) {
        ESP_LOGE(TAG, "could not initialise the SDK: check config/iotos_settings.h");
        return;
    }
    if (add_devices() != 0) {
        return;
    }
    (void)iotos_set_firmware_version(&gateway, APP_FIRMWARE_VERSION);
    report_signal();
    ESP_LOGI(TAG, "connecting %s/%s to %s:%u with %u devices", settings.group_id, settings.edge_node_id,
             settings.broker_host, (unsigned)settings.broker_port, (unsigned)field_device_count);

    (void)iotos_start(&gateway);
    next_read = iotos_esp_idf_monotonic_ms() + APP_POLL_INTERVAL_S * 1000u;
    for (;;) {
        (void)iotos_poll(&gateway, 50);
        if ((uint32_t)(iotos_esp_idf_monotonic_ms() - next_read) < 0x80000000u) {
            next_read += APP_POLL_INTERVAL_S * 1000u;
            report_signal();
            publish_all();
        }
        vTaskDelay(1); /* iotos_poll returns at once while it waits to reconnect: let other tasks run */
    }
}
