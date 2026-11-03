/* SPDX-License-Identifier: MIT */
#define _POSIX_C_SOURCE 200809L
#include <stdio.h>

#include "iotos_posix.h"

static void write_line(void *ctx, iotos_log_level level, const char *message)
{
    static const char *const names[] = {"error", "warn", "info", "debug"};
    const iotos_posix *posix = (const iotos_posix *)ctx;
    if (level > posix->level) {
        return;
    }
    fprintf(stderr, "iotos %s: %s\n", names[level], message);
}

void iotos__posix_log(iotos_posix *posix, iotos_log_port *log)
{
    log->write = write_line;
    log->ctx = posix;
}
