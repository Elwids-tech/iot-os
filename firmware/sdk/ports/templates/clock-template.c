/* SPDX-License-Identifier: MIT */
/*
 * Template: the clock port.
 *
 * The SDK stamps every reading with UTC milliseconds and holds births while the time is
 * not valid, so a gateway that boots with a 1970 clock never writes readings into the
 * past. Setting the time is the port's job: SNTP on Ethernet or Wi-Fi, network time
 * (AT+QLTS, AT+CCLK) on a cellular modem, or a battery-backed RTC that was set once.
 *
 * Copy this file, rename the my_ prefix and replace each TODO. ports/posix/clock.c is a
 * complete desktop example.
 */
#include "iotos/iotos.h"

/*
 * UTC milliseconds since 1970. Set *valid to true only once the time came from a trusted
 * source in this boot (SNTP answered, the modem reported network time, or an RTC you know
 * was set). While *valid is false the SDK holds births and data, and after
 * IOTOS_CLOCK_WAIT_S reports IOTOS_E_CLOCK through on_event every minute.
 */
static uint64_t my_now_ms(void *ctx, bool *valid)
{
    (void)ctx;
    *valid = false; /* TODO: true once synchronised */
    return 0;       /* TODO: UTC milliseconds */
}

/*
 * Milliseconds from any fixed point, used for intervals: keepalive, back-off, birth
 * pacing, health. It must never go backwards and must keep counting while UTC is not
 * valid. It wraps at 2^32, which the SDK handles. It takes no context because the MQTT
 * client calls it directly.
 * FreeRTOS: return (uint32_t)(xTaskGetTickCount() * portTICK_PERIOD_MS);
 */
static uint32_t my_monotonic_ms(void)
{
    return 0; /* TODO */
}

const iotos_clock_port my_clock_port = {
    .now_ms = my_now_ms,
    .monotonic_ms = my_monotonic_ms,
    .ctx = NULL,
};
