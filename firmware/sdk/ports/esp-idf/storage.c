/* SPDX-License-Identifier: MIT */
/* One NVS blob per key in the namespace "iotos". NVS replaces an entry atomically, so a
 * power cut leaves the old value or the new one. Keys are at most 15 characters. */
#include "iotos_esp_idf.h"
#include "nvs.h"

#define NAMESPACE "iotos"

static bool load(void *ctx, const char *key, void *out, size_t len)
{
    nvs_handle_t nvs;
    size_t stored = len;
    esp_err_t err;
    (void)ctx;
    if (nvs_open(NAMESPACE, NVS_READONLY, &nvs) != ESP_OK) {
        return false; /* nothing saved yet, or NVS is not initialised */
    }
    err = nvs_get_blob(nvs, key, out, &stored);
    nvs_close(nvs);
    return err == ESP_OK && stored == len;
}

static bool save(void *ctx, const char *key, const void *data, size_t len)
{
    nvs_handle_t nvs;
    bool ok;
    (void)ctx;
    if (nvs_open(NAMESPACE, NVS_READWRITE, &nvs) != ESP_OK) {
        return false;
    }
    ok = nvs_set_blob(nvs, key, data, len) == ESP_OK && nvs_commit(nvs) == ESP_OK;
    nvs_close(nvs);
    return ok;
}

void iotos__esp_idf_storage(iotos_storage_port *storage)
{
    storage->load = load;
    storage->save = save;
    storage->ctx = NULL;
}
