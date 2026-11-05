/* SPDX-License-Identifier: MIT */
#include <string.h>

#include "iotos_mcux.h"

iotos_status iotos__mcux_clock(iotos_clock_port *clock, const char *sntp_server);
iotos_status iotos__mcux_stream(iotos_mcux *mcux, iotos_stream_port *stream);

iotos_status iotos_mcux_ports_init(iotos_mcux *mcux, const char *sntp_server, iotos_log_level level)
{
    if (!mcux) {
        return IOTOS_E_INVALID;
    }
    memset(mcux, 0, sizeof(*mcux));
    iotos_freertos_log_init(&mcux->console, level, &mcux->log);
    if (iotos_freertos_lock_init(&mcux->mutex, &mcux->lock) != IOTOS_OK) {
        mcux->log.write(mcux->log.ctx, IOTOS_LOG_ERROR, "Could not create the SDK's mutex: set configSUPPORT_STATIC_ALLOCATION to 1.");
        return IOTOS_E_INVALID;
    }
    if (iotos__mcux_stream(mcux, &mcux->stream) != IOTOS_OK) {
        mcux->log.write(mcux->log.ctx, IOTOS_LOG_ERROR, "Could not set up mbedTLS: build with MBEDTLS_PLATFORM_MEMORY.");
        return IOTOS_E_INVALID;
    }
    (void)iotos__mcux_clock(&mcux->clock, sntp_server);
    mcux->ports.stream = &mcux->stream;
    mcux->ports.clock = &mcux->clock;
    mcux->ports.log = &mcux->log;
    mcux->ports.lock = &mcux->lock;
    return IOTOS_OK;
}
