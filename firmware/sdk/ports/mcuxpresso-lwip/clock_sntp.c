/* SPDX-License-Identifier: MIT */
/*
 * UTC from lwIP SNTP, valid once the server has answered in this boot. The board has no
 * battery-backed clock in this setup, so UTC is the last SNTP answer plus the ticks since
 * it arrived. Intervals come from the FreeRTOS tick, which never goes back.
 */
#include <stddef.h>
#include <stdint.h>

#include "FreeRTOS.h"
#include "iotos_mcux.h"
#include "lwip/apps/sntp.h"
#include "lwip/tcpip.h"
#include "task.h"

#if configTICK_RATE_HZ != 1000
#error "The IoT OS ports count milliseconds in FreeRTOS ticks: set configTICK_RATE_HZ to 1000"
#endif

/* UTC milliseconds at the tick the time was set. 0 until then. */
static volatile uint64_t utc_at_set;
static volatile uint32_t tick_at_set;

uint64_t iotos__mcux_utc_ms(void);

uint32_t iotos_mcux_monotonic_ms(void)
{
    return (uint32_t)xTaskGetTickCount();
}

void iotos_mcux_sntp_set(unsigned long sec, unsigned long us)
{
    uint64_t utc = (uint64_t)sec * 1000u + (uint64_t)us / 1000u;
    taskENTER_CRITICAL();
    tick_at_set = iotos_mcux_monotonic_ms();
    utc_at_set = utc;
    taskEXIT_CRITICAL();
}

bool iotos_mcux_clock_valid(void)
{
    return utc_at_set != 0;
}

/* UTC milliseconds now, or 0 while the clock is not set. */
uint64_t iotos__mcux_utc_ms(void)
{
    uint64_t utc;
    uint32_t tick;
    taskENTER_CRITICAL();
    utc = utc_at_set;
    tick = tick_at_set;
    taskEXIT_CRITICAL();
    return utc ? utc + (uint32_t)(iotos_mcux_monotonic_ms() - tick) : 0;
}

static uint64_t now_ms(void *ctx, bool *valid)
{
    uint64_t utc = iotos__mcux_utc_ms();
    (void)ctx;
    *valid = utc != 0;
    return utc;
}

iotos_status iotos__mcux_clock(iotos_clock_port *clock, const char *sntp_server)
{
    clock->now_ms = now_ms;
    clock->monotonic_ms = iotos_mcux_monotonic_ms;
    clock->ctx = NULL;
    if (sntp_server) {
        LOCK_TCPIP_CORE();
        sntp_setoperatingmode(SNTP_OPMODE_POLL);
#if SNTP_SERVER_DNS
        sntp_setservername(0, sntp_server);
#else
#error "Set SNTP_SERVER_DNS to 1 in lwipopts.h, so the SNTP server can be a name"
#endif
        sntp_init();
        UNLOCK_TCPIP_CORE();
    }
    return IOTOS_OK;
}
