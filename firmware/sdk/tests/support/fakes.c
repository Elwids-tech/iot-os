/* SPDX-License-Identifier: MIT */
/* Clock, storage, lock, log and message-list doubles. Tests may use the heap. */
#include <stdlib.h>
#include <string.h>

#include "fakes.h"
#include "unity.h"

/* Clock */

static uint64_t clock_utc;
static uint32_t clock_mono;
static bool clock_valid;

static uint64_t clock_now(void *ctx, bool *valid)
{
    (void)ctx;
    *valid = clock_valid;
    return clock_utc;
}

static uint32_t clock_monotonic(void)
{
    return clock_mono;
}

const iotos_clock_port fake_clock = {clock_now, clock_monotonic, NULL};

void fake_clock_reset(uint64_t utc_ms, bool valid)
{
    clock_utc = utc_ms;
    clock_mono = 0xFFFF0000u; /* near the wrap, so wrapping bugs show up */
    clock_valid = valid;
}

void fake_clock_advance(uint32_t ms)
{
    clock_utc += ms;
    clock_mono += ms;
}

void fake_clock_set_valid(bool valid)
{
    clock_valid = valid;
}

uint64_t fake_clock_utc(void)
{
    return clock_utc;
}

/* Storage */

static struct {
    char key[32];
    uint8_t value[16];
    size_t length;
} stored[8];
static size_t stored_count;

static bool storage_load(void *ctx, const char *key, void *out, size_t len)
{
    (void)ctx;
    for (size_t i = 0; i < stored_count; i++) {
        if (strcmp(stored[i].key, key) == 0 && stored[i].length == len) {
            memcpy(out, stored[i].value, len);
            return true;
        }
    }
    return false;
}

static bool storage_save(void *ctx, const char *key, const void *data, size_t len)
{
    size_t i;
    (void)ctx;
    TEST_ASSERT_TRUE(len <= sizeof(stored[0].value));
    for (i = 0; i < stored_count && strcmp(stored[i].key, key) != 0; i++) {
    }
    if (i == stored_count) {
        TEST_ASSERT_TRUE(stored_count < 8);
        stored_count++;
        strncpy(stored[i].key, key, sizeof(stored[i].key) - 1);
    }
    memcpy(stored[i].value, data, len);
    stored[i].length = len;
    return true;
}

const iotos_storage_port fake_storage = {storage_load, storage_save, NULL};

void fake_storage_reset(void)
{
    memset(stored, 0, sizeof(stored));
    stored_count = 0;
}

bool fake_storage_byte(const char *key, uint8_t *value)
{
    return storage_load(NULL, key, value, 1);
}

/* Lock */

static bool lock_held;

static void lock_take(void *ctx)
{
    (void)ctx;
    TEST_ASSERT_FALSE_MESSAGE(lock_held, "the SDK took its lock twice");
    lock_held = true;
}

static void lock_give(void *ctx)
{
    (void)ctx;
    TEST_ASSERT_TRUE_MESSAGE(lock_held, "the SDK released a lock it did not hold");
    lock_held = false;
}

const iotos_lock_port fake_lock = {lock_take, lock_give, NULL};

void fake_lock_reset(void)
{
    lock_held = false;
}

bool fake_lock_held(void)
{
    return lock_held;
}

/* Log */

static char log_lines[32][192];
static size_t log_count;

static void log_write(void *ctx, iotos_log_level level, const char *message)
{
    (void)ctx;
    (void)level;
    strncpy(log_lines[log_count % 32], message, sizeof(log_lines[0]) - 1);
    log_count++;
}

const iotos_log_port fake_log = {log_write, NULL};

void fake_log_reset(void)
{
    memset(log_lines, 0, sizeof(log_lines));
    log_count = 0;
}

bool fake_log_contains(const char *text)
{
    for (size_t i = 0; i < 32; i++) {
        if (strstr(log_lines[i], text)) {
            return true;
        }
    }
    return false;
}

/* Messages */

void fake_messages_add(fake_messages *list, const char *topic, size_t topic_length, const uint8_t *data,
                       size_t length, uint8_t qos, bool retain)
{
    fake_message *m;
    if (list->count == list->capacity) {
        list->capacity = list->capacity ? list->capacity * 2 : 64;
        list->items = realloc(list->items, list->capacity * sizeof(*list->items));
        TEST_ASSERT_NOT_NULL(list->items);
    }
    m = &list->items[list->count++];
    memset(m, 0, sizeof(*m));
    TEST_ASSERT_TRUE(topic_length < sizeof(m->topic));
    memcpy(m->topic, topic, topic_length);
    m->data = malloc(length ? length : 1);
    TEST_ASSERT_NOT_NULL(m->data);
    if (length) {
        memcpy(m->data, data, length);
    }
    m->length = length;
    m->qos = qos;
    m->retain = retain;
}

void fake_messages_clear(fake_messages *list)
{
    for (size_t i = 0; i < list->count; i++) {
        free(list->items[i].data);
    }
    free(list->items);
    memset(list, 0, sizeof(*list));
}

long fake_messages_find(const fake_messages *list, const char *text, size_t start)
{
    for (size_t i = start; i < list->count; i++) {
        if (strstr(list->items[i].topic, text)) {
            return (long)i;
        }
    }
    return -1;
}
