#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

// Bounded Sparkplug protobuf subset: Boolean, Int32, Int64 and String metrics.
// Unsupported command values are rejected rather than interpreted as defaults.
#define WAVE_SP_MAX_METRICS 10
typedef struct {
    char name[40];
    char string_value[64];
    uint64_t alias, datatype, value;
    bool has_alias, has_value;
} wave_sp_metric_t;
typedef struct {
    uint64_t timestamp, seq;
    bool has_timestamp, has_seq;
    char uuid[65];
    size_t count;
    wave_sp_metric_t metrics[WAVE_SP_MAX_METRICS];
} wave_sp_payload_t;

size_t wave_sp_encode(const wave_sp_payload_t *payload, uint8_t *out, size_t capacity);
bool wave_sp_decode(const uint8_t *bytes, size_t length, wave_sp_payload_t *payload);
