/* SPDX-License-Identifier: MIT */
/*
 * Template: the log port (optional).
 *
 * The SDK explains connection problems, refused commands and oversized births here, in
 * short sentences without a trailing newline. Copy this file, rename the my_ prefix and
 * send the lines to your console, a ring buffer or a debug UART.
 */
#include "iotos/iotos.h"

/*
 * Write one line. The SDK may call this while it holds its lock, so return quickly and
 * never call back into the SDK from here. Messages above the level you want can be
 * dropped: IOTOS_LOG_DEBUG is verbose.
 */
static void my_write(void *ctx, iotos_log_level level, const char *message)
{
    (void)ctx;
    (void)level;
    (void)message; /* TODO: e.g. PRINTF("iotos: %s\r\n", message) */
}

const iotos_log_port my_log_port = {
    .write = my_write,
    .ctx = NULL,
};
