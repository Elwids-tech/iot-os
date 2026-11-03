/* SPDX-License-Identifier: MIT */
/* One file per key in a directory, replaced atomically through a temporary file. */
#define _POSIX_C_SOURCE 200809L
#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>

#include "iotos_posix.h"

static bool path(const iotos_posix *posix, const char *key, const char *suffix, char *out, size_t size)
{
    int n = snprintf(out, size, "%s/%s%s", posix->directory, key, suffix);
    return n > 0 && (size_t)n < size;
}

static bool load(void *ctx, const char *key, void *out, size_t len)
{
    char file[600];
    FILE *f;
    size_t got;
    if (!path((const iotos_posix *)ctx, key, "", file, sizeof(file)) || !(f = fopen(file, "rb"))) {
        return false;
    }
    got = fread(out, 1, len, f);
    fclose(f);
    return got == len;
}

static bool save(void *ctx, const char *key, const void *data, size_t len)
{
    const iotos_posix *posix = (const iotos_posix *)ctx;
    char file[600], temporary[600];
    FILE *f;
    bool ok;
    if (mkdir(posix->directory, 0700) != 0 && errno != EEXIST) {
        return false;
    }
    if (!path(posix, key, "", file, sizeof(file)) || !path(posix, key, ".tmp", temporary, sizeof(temporary))
        || !(f = fopen(temporary, "wb"))) {
        return false;
    }
    ok = fwrite(data, 1, len, f) == len;
    ok = fflush(f) == 0 && ok;
    ok = fclose(f) == 0 && ok;
    return ok && rename(temporary, file) == 0;
}

void iotos__posix_storage(iotos_posix *posix, iotos_storage_port *storage)
{
    storage->load = load;
    storage->save = save;
    storage->ctx = posix;
}
