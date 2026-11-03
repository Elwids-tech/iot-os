/* SPDX-License-Identifier: MIT */
/*
 * Desktop ports for macOS and Linux: mbedTLS over BSD sockets, the system clock, file
 * storage, stderr logging and a pthread mutex. Used by the tests and the desktop
 * simulator, and a working reference for writing board ports.
 */
#ifndef IOTOS_POSIX_H
#define IOTOS_POSIX_H

#include <pthread.h>

#include "iotos/iotos.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    iotos_stream_port stream;
    iotos_clock_port clock;
    iotos_storage_port storage;
    iotos_log_port log;
    iotos_lock_port lock;
    iotos_ports ports; /* points at the members above: pass &posix.ports to iotos_init */

    /* Internal */
    void *tls;
    char directory[512];
    iotos_log_level level;
    pthread_mutex_t mutex;
} iotos_posix;

/* state_directory holds one file per key (bdSeq); NULL keeps it in RAM. Messages above
 * level are not logged. */
iotos_status iotos_posix_ports_init(iotos_posix *posix, const char *state_directory, iotos_log_level level);
void iotos_posix_ports_free(iotos_posix *posix);

/* The individual ports, for tests and mixed setups. */
void iotos_posix_clock(iotos_clock_port *clock);
uint32_t iotos_posix_monotonic_ms(void);

#ifdef __cplusplus
}
#endif

#endif
