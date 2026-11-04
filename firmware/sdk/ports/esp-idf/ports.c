/* SPDX-License-Identifier: MIT */
#include <string.h>

#include "iotos_esp_idf.h"

iotos_status iotos__esp_idf_clock(iotos_clock_port *clock, const char *sntp_server);
void iotos__esp_idf_storage(iotos_storage_port *storage);
void iotos__esp_idf_log(iotos_esp_idf *esp, iotos_log_port *log);
void iotos__esp_idf_stream(iotos_esp_idf *esp, iotos_stream_port *stream);

iotos_status iotos_esp_idf_ports_init(iotos_esp_idf *esp, const char *sntp_server, iotos_log_level level)
{
    if (!esp) {
        return IOTOS_E_INVALID;
    }
    memset(esp, 0, sizeof(*esp));
    esp->level = level;
    iotos__esp_idf_log(esp, &esp->log);
    if (iotos_freertos_lock_init(&esp->mutex, &esp->lock) != IOTOS_OK) {
        esp->log.write(esp, IOTOS_LOG_ERROR, "Could not create the SDK's mutex.");
        return IOTOS_E_INVALID;
    }
    if (iotos__esp_idf_clock(&esp->clock, sntp_server) != IOTOS_OK) {
        esp->log.write(esp, IOTOS_LOG_ERROR, "Could not start SNTP: call esp_netif_init first, or pass NULL when the application sets the time.");
        return IOTOS_E_INVALID;
    }
    iotos__esp_idf_storage(&esp->storage);
    iotos__esp_idf_stream(esp, &esp->stream);
    esp->ports.stream = &esp->stream;
    esp->ports.clock = &esp->clock;
    esp->ports.storage = &esp->storage;
    esp->ports.log = &esp->log;
    esp->ports.lock = &esp->lock;
    return IOTOS_OK;
}
