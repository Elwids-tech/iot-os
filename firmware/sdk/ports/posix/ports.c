/* SPDX-License-Identifier: MIT */
#define _POSIX_C_SOURCE 200809L
#include <string.h>

#include "iotos_posix.h"

void iotos__posix_lock(iotos_posix *posix, iotos_lock_port *port);
void iotos__posix_storage(iotos_posix *posix, iotos_storage_port *storage);
void iotos__posix_log(iotos_posix *posix, iotos_log_port *log);
void iotos__posix_stream(iotos_posix *posix, iotos_stream_port *stream);
void iotos__posix_stream_free(iotos_posix *posix);

iotos_status iotos_posix_ports_init(iotos_posix *posix, const char *state_directory, iotos_log_level level)
{
    memset(posix, 0, sizeof(*posix));
    posix->level = level;
    if (state_directory && strlen(state_directory) >= sizeof(posix->directory)) {
        return IOTOS_E_INVALID;
    }
    if (pthread_mutex_init(&posix->mutex, NULL) != 0) {
        return IOTOS_E_INVALID;
    }
    iotos__posix_lock(posix, &posix->lock);
    iotos_posix_clock(&posix->clock);
    iotos__posix_log(posix, &posix->log);
    iotos__posix_stream(posix, &posix->stream);
    posix->ports.stream = &posix->stream;
    posix->ports.clock = &posix->clock;
    posix->ports.log = &posix->log;
    posix->ports.lock = &posix->lock;
    if (state_directory) {
        strcpy(posix->directory, state_directory);
        iotos__posix_storage(posix, &posix->storage);
        posix->ports.storage = &posix->storage;
    }
    return posix->tls ? IOTOS_OK : IOTOS_E_INVALID;
}

void iotos_posix_ports_free(iotos_posix *posix)
{
    iotos__posix_stream_free(posix);
    pthread_mutex_destroy(&posix->mutex);
}
