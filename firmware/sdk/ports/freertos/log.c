/* SPDX-License-Identifier: MIT */
/*
 * The log port through a printf-like macro. The default is the MCUXpresso SDK's PRINTF,
 * which writes to the board's debug console; build with -DIOTOS_FREERTOS_PRINTF=printf
 * (or your own function) on other vendor SDKs.
 */
#include <stdio.h>

#include "iotos_freertos.h"

#ifndef IOTOS_FREERTOS_PRINTF
#include "fsl_debug_console.h"
#define IOTOS_FREERTOS_PRINTF PRINTF
#endif

static void write_line(void *ctx, iotos_log_level level, const char *message)
{
    static const char *const names[] = {"error", "warn", "info", "debug"};
    const iotos_freertos_log *log = (const iotos_freertos_log *)ctx;
    if (level > log->level || (unsigned)level >= sizeof(names) / sizeof(names[0])) {
        return;
    }
    IOTOS_FREERTOS_PRINTF("iotos %s: %s\r\n", names[level], message);
}

void iotos_freertos_log_init(iotos_freertos_log *log, iotos_log_level level, iotos_log_port *port)
{
    if (!log || !port) {
        return;
    }
    log->level = level;
    port->write = write_line;
    port->ctx = log;
}
