/* SPDX-License-Identifier: MIT */
/*
 * Template: the storage port (optional).
 *
 * The SDK stores one value today: "bdseq", one byte, written before every connection.
 * Keeping it across reboots lets the platform tell a reboot from a duplicate session.
 * Without this port bdSeq lives in RAM and starts again after a reboot, which works but
 * can make the first session after a reboot look like a repeat.
 *
 * Later versions may add keys and optional members (store-and-forward), always at the
 * end of iotos_storage_port. Copy this file, rename the my_ prefix and replace each TODO.
 * ports/posix/storage_file.c is a complete example with one file per key.
 */
#include "iotos/iotos.h"

/*
 * Copy exactly len bytes stored under key into out. Return false when the key was never
 * saved, or the stored size differs: the SDK then starts from its default.
 */
static bool my_load(void *ctx, const char *key, void *out, size_t len)
{
    (void)ctx;
    (void)key;
    (void)out;
    (void)len;
    return false; /* TODO */
}

/*
 * Store len bytes under key. The write must be atomic: after a power cut, a load returns
 * either the old value or the new one, never a mix. Use your flash key-value store's
 * transactions, or two slots with a sequence number. Return false on failure; the SDK
 * logs it and carries on.
 */
static bool my_save(void *ctx, const char *key, const void *data, size_t len)
{
    (void)ctx;
    (void)key;
    (void)data;
    (void)len;
    return false; /* TODO */
}

const iotos_storage_port my_storage_port = {
    .load = my_load,
    .save = my_save,
    .ctx = NULL,
};
