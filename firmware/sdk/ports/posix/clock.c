/* SPDX-License-Identifier: MIT */
#define _POSIX_C_SOURCE 200809L
#include <time.h>

#include "iotos_posix.h"

/* 2024-01-01T00:00:00Z: anything earlier means the clock was never set. */
#define CLOCK_VALID_AFTER_MS 1704067200000ull

static uint64_t now_ms(void *ctx, bool *valid)
{
    struct timespec ts;
    uint64_t ms;
    (void)ctx;
    clock_gettime(CLOCK_REALTIME, &ts);
    ms = (uint64_t)ts.tv_sec * 1000u + (uint64_t)ts.tv_nsec / 1000000u;
    *valid = ms >= CLOCK_VALID_AFTER_MS;
    return ms;
}

uint32_t iotos_posix_monotonic_ms(void)
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint32_t)((uint64_t)ts.tv_sec * 1000u + (uint64_t)ts.tv_nsec / 1000000u);
}

void iotos_posix_clock(iotos_clock_port *clock)
{
    clock->now_ms = now_ms;
    clock->monotonic_ms = iotos_posix_monotonic_ms;
    clock->ctx = NULL;
}
