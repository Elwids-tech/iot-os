/* SPDX-License-Identifier: MIT */
/*
 * Template: the lock port (optional for single-task firmware).
 *
 * Needed when more than one task calls the SDK: for example the poll task, plus RS-485
 * tasks that publish readings. The writer calls (iotos_begin to iotos_commit) and the
 * device calls take this lock; iotos_poll takes it around its own work and releases it
 * before on_command and on_event, so those callbacks can publish.
 *
 * Use a plain mutex, not a recursive one. The SDK never takes the lock twice from one
 * task, so a recursive mutex buys nothing, and it would hide a real bug: an SDK call made
 * from on_birth (which runs with the lock held) deadlocks on a plain mutex straight away,
 * where you can see it.
 *
 * Copy this file, rename the my_ prefix and replace each TODO.
 */
#include "iotos/iotos.h"

/* FreeRTOS:
 *   static SemaphoreHandle_t mutex;   created once with xSemaphoreCreateMutex()
 *   lock:   xSemaphoreTake(mutex, portMAX_DELAY);
 *   unlock: xSemaphoreGive(mutex);
 */
static void my_lock(void *ctx)
{
    (void)ctx; /* TODO: take the mutex, waiting as long as needed */
}

static void my_unlock(void *ctx)
{
    (void)ctx; /* TODO: give the mutex */
}

const iotos_lock_port my_lock_port = {
    .lock = my_lock,
    .unlock = my_unlock,
    .ctx = NULL,
};
