/* SPDX-License-Identifier: MIT */
/* A plain pthread mutex: the SDK never takes the lock twice from one thread. */
#define _POSIX_C_SOURCE 200809L
#include "iotos_posix.h"

static void lock(void *ctx)
{
    pthread_mutex_lock(&((iotos_posix *)ctx)->mutex);
}

static void unlock(void *ctx)
{
    pthread_mutex_unlock(&((iotos_posix *)ctx)->mutex);
}

void iotos__posix_lock(iotos_posix *posix, iotos_lock_port *port)
{
    port->lock = lock;
    port->unlock = unlock;
    port->ctx = posix;
}
