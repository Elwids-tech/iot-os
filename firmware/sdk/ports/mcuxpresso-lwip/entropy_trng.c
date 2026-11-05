/* SPDX-License-Identifier: MIT */
/*
 * mbedTLS's hardware entropy source (MBEDTLS_ENTROPY_HARDWARE_ALT): the TRNG of the
 * i.MX RT10xx. Build it only when no other part of the project provides
 * mbedtls_hardware_poll, such as the MCUXpresso mbedTLS RNG port or a PSA crypto driver.
 */
#include <stdbool.h>
#include <stddef.h>

#include "FreeRTOS.h"
#include "fsl_trng.h"
#include "semphr.h"

int mbedtls_hardware_poll(void *data, unsigned char *output, size_t len, size_t *olen);

static StaticSemaphore_t guard_storage;
static SemaphoreHandle_t guard;
static bool started;

int mbedtls_hardware_poll(void *data, unsigned char *output, size_t len, size_t *olen)
{
    status_t result;
    (void)data;
    *olen = 0;
    taskENTER_CRITICAL();
    if (!guard) {
        guard = xSemaphoreCreateMutexStatic(&guard_storage);
    }
    taskEXIT_CRITICAL();
    (void)xSemaphoreTake(guard, portMAX_DELAY);
    if (!started) {
        trng_config_t config;
        (void)TRNG_GetDefaultConfig(&config);
        config.sampleMode = kTRNG_SampleModeVonNeumann;
        started = TRNG_Init(TRNG, &config) == kStatus_Success;
    }
    result = started ? TRNG_GetRandomData(TRNG, output, len) : kStatus_Fail;
    (void)xSemaphoreGive(guard);
    if (result != kStatus_Success) {
        return -1; /* MBEDTLS_ERR_ENTROPY_SOURCE_FAILED is reported by the caller */
    }
    *olen = len;
    return 0;
}
