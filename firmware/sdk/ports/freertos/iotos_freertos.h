/* SPDX-License-Identifier: MIT */
/*
 * FreeRTOS helpers shared by the board ports: the lock port as a plain mutex, created
 * statically so it needs no heap. Builds with ESP-IDF's FreeRTOS and with the kernel as
 * vendor SDKs ship it; configSUPPORT_STATIC_ALLOCATION must be 1.
 */
#ifndef IOTOS_FREERTOS_H
#define IOTOS_FREERTOS_H

#ifdef ESP_PLATFORM
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#else
#include "FreeRTOS.h"
#include "semphr.h"
#endif

#include "iotos/iotos.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    SemaphoreHandle_t mutex;
    StaticSemaphore_t storage; /* the mutex itself */
} iotos_freertos_lock;

/* Creates the mutex in lock and points port at it. lock must outlive the gateway.
 * IOTOS_OK, or IOTOS_E_INVALID when the mutex could not be created. */
iotos_status iotos_freertos_lock_init(iotos_freertos_lock *lock, iotos_lock_port *port);

#ifdef __cplusplus
}
#endif

#endif
