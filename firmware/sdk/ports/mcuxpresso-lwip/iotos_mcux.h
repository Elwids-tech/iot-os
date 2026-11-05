/* SPDX-License-Identifier: MIT */
/*
 * MCUXpresso SDK ports (SDK 26.x, FreeRTOS, lwIP sockets): mbedTLS 3.6 over lwIP with the
 * kit's CA and the broker host checked, entropy from the TRNG, lwIP SNTP for UTC, the
 * FreeRTOS tick for intervals, the debug console for the log and a FreeRTOS mutex for the
 * lock. bdSeq stays in RAM: add a storage port (flash, EEPROM) to keep it across reboots.
 *
 * The SDK runs its own MQTT client over this stream, so a project must not also select
 * the MCUXpresso coreMQTT middleware: two copies of coreMQTT give duplicate symbols.
 *
 * The project's lwipopts.h needs, besides sockets, DNS and DHCP:
 *   #define SNTP_SET_SYSTEM_TIME_US(sec, us) iotos_mcux_sntp_set((sec), (us))
 * and the build defines MBEDTLS_CONFIG_FILE as "iotos_mbedtls_config.h" (or a config of
 * its own with the same TLS client and MBEDTLS_ENTROPY_HARDWARE_ALT). configTICK_RATE_HZ
 * must be 1000, so the tick count is the millisecond count the SDK needs.
 */
#ifndef IOTOS_MCUX_H
#define IOTOS_MCUX_H

#include "iotos/iotos.h"
#include "iotos_freertos.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    iotos_stream_port stream;
    iotos_clock_port clock;
    iotos_log_port log;
    iotos_lock_port lock;
    iotos_ports ports; /* points at the members above: pass &mcux.ports to iotos_init */

    /* Internal */
    void *tls; /* the stream's mbedTLS state; one connection at a time */
    iotos_freertos_lock mutex;
    iotos_freertos_log console;
} iotos_mcux;

/*
 * Call once lwIP is running (tcpip_init) and before iotos_init.
 * - sntp_server: the clock is valid once this server (a name or an address) has answered
 *   in this boot. NULL when the application sets the time itself with
 *   iotos_mcux_sntp_set (GPS, an RTC, its own SNTP).
 * - Messages above level are not logged.
 * IOTOS_OK, or IOTOS_E_INVALID when the mutex or the TLS state could not be set up.
 */
iotos_status iotos_mcux_ports_init(iotos_mcux *mcux, const char *sntp_server, iotos_log_level level);

/* Milliseconds since the scheduler started, from the FreeRTOS tick, wrapping at 2^32. */
uint32_t iotos_mcux_monotonic_ms(void);

/* Sets UTC: lwIP SNTP calls it through SNTP_SET_SYSTEM_TIME_US, and an application that
 * keeps its own time may call it too. The clock is valid from the first call. */
void iotos_mcux_sntp_set(unsigned long sec, unsigned long us);

/* Whether UTC has been set in this boot. */
bool iotos_mcux_clock_valid(void);

#ifdef __cplusplus
}
#endif

#endif
