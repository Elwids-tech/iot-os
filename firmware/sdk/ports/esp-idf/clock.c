/* SPDX-License-Identifier: MIT */
/*
 * UTC from the system time, valid once SNTP has answered in this boot: the RTC keeps
 * counting through a restart, so a time that merely looks right is not trusted.
 * Intervals come from esp_timer, which counts from boot and never goes back.
 */
#include <stddef.h>
#include <sys/time.h>

#include "esp_netif_sntp.h"
#include "esp_timer.h"
#include "iotos_esp_idf.h"

/* 2024-01-01T00:00:00Z: anything earlier means the clock was never set. */
#define CLOCK_VALID_AFTER_MS 1704067200000ull

static volatile bool synced;
static bool use_sntp;

static void time_synced(struct timeval *tv)
{
    (void)tv;
    synced = true;
}

static uint64_t now_ms(void *ctx, bool *valid)
{
    struct timeval tv;
    uint64_t ms;
    (void)ctx;
    gettimeofday(&tv, NULL);
    ms = (uint64_t)tv.tv_sec * 1000u + (uint64_t)tv.tv_usec / 1000u;
    *valid = (synced || !use_sntp) && ms >= CLOCK_VALID_AFTER_MS;
    return ms;
}

uint32_t iotos_esp_idf_monotonic_ms(void)
{
    return (uint32_t)(esp_timer_get_time() / 1000);
}

iotos_status iotos__esp_idf_clock(iotos_clock_port *clock, const char *sntp_server)
{
    clock->now_ms = now_ms;
    clock->monotonic_ms = iotos_esp_idf_monotonic_ms;
    clock->ctx = NULL;
    use_sntp = sntp_server != NULL;
    if (use_sntp) {
        esp_sntp_config_t config = ESP_NETIF_SNTP_DEFAULT_CONFIG(sntp_server);
        config.sync_cb = time_synced;
        if (esp_netif_sntp_init(&config) != ESP_OK) {
            return IOTOS_E_INVALID;
        }
    }
    return IOTOS_OK;
}
