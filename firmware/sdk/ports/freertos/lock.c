/* SPDX-License-Identifier: MIT */
/* A plain, non-recursive mutex: the SDK never takes the lock twice from one task. */
#include "iotos_freertos.h"

static void lock(void *ctx)
{
    (void)xSemaphoreTake(((iotos_freertos_lock *)ctx)->mutex, portMAX_DELAY);
}

static void unlock(void *ctx)
{
    (void)xSemaphoreGive(((iotos_freertos_lock *)ctx)->mutex);
}

iotos_status iotos_freertos_lock_init(iotos_freertos_lock *state, iotos_lock_port *port)
{
    if (!state || !port) {
        return IOTOS_E_INVALID;
    }
    state->mutex = xSemaphoreCreateMutexStatic(&state->storage);
    if (!state->mutex) {
        return IOTOS_E_INVALID;
    }
    port->lock = lock;
    port->unlock = unlock;
    port->ctx = state;
    return IOTOS_OK;
}
