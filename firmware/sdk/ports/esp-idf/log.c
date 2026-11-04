/* SPDX-License-Identifier: MIT */
#include "esp_log.h"
#include "iotos_esp_idf.h"

static const char *const TAG = "iotos";

static void write_line(void *ctx, iotos_log_level level, const char *message)
{
    const iotos_esp_idf *esp = (const iotos_esp_idf *)ctx;
    if (level > esp->level) {
        return;
    }
    switch (level) {
    case IOTOS_LOG_ERROR:
        ESP_LOGE(TAG, "%s", message);
        break;
    case IOTOS_LOG_WARN:
        ESP_LOGW(TAG, "%s", message);
        break;
    case IOTOS_LOG_INFO:
        ESP_LOGI(TAG, "%s", message);
        break;
    default:
        ESP_LOGD(TAG, "%s", message);
        break;
    }
}

void iotos__esp_idf_log(iotos_esp_idf *esp, iotos_log_port *log)
{
    log->write = write_line;
    log->ctx = esp;
}
