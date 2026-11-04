/* SPDX-License-Identifier: MIT */
/*
 * ESP-IDF ports (v5.4): esp-tls over lwIP with the kit's CA, SNTP and esp_timer for the
 * clock, NVS for bdSeq, ESP_LOG for the log and a FreeRTOS mutex for the lock. The SDK
 * runs its own MQTT client over esp-tls, so a project must not also add the
 * espressif/coremqtt component: two copies of coreMQTT give duplicate symbols.
 */
#ifndef IOTOS_ESP_IDF_H
#define IOTOS_ESP_IDF_H

#include "iotos/iotos.h"
#include "iotos_freertos.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    iotos_stream_port stream;
    iotos_clock_port clock;
    iotos_storage_port storage;
    iotos_log_port log;
    iotos_lock_port lock;
    iotos_ports ports; /* points at the members above: pass &esp.ports to iotos_init */

    /* Internal */
    void *tls; /* esp_tls_t, from connect to close */
    iotos_freertos_lock mutex;
    iotos_log_level level;
} iotos_esp_idf;

/*
 * Call once the network interface is set up (esp_netif_init, and nvs_flash_init for
 * bdSeq), before iotos_init.
 * - sntp_server: the clock is valid once this server has answered in this boot. NULL
 *   when the application sets the time itself (its own SNTP, GPS or an RTC): the clock
 *   is then valid once the system time is past 2024.
 * - bdSeq is kept in the NVS namespace "iotos".
 * - Messages above level are not logged; the tag is "iotos".
 * IOTOS_OK, or IOTOS_E_INVALID when the mutex or SNTP could not be set up.
 */
iotos_status iotos_esp_idf_ports_init(iotos_esp_idf *esp, const char *sntp_server, iotos_log_level level);

/* Milliseconds since boot, from esp_timer, wrapping at 2^32. */
uint32_t iotos_esp_idf_monotonic_ms(void);

#ifdef __cplusplus
}
#endif

#endif
