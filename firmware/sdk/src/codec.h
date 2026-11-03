/* SPDX-License-Identifier: MIT */
/*
 * Sparkplug B payload codec (internal). The writer appends to a caller buffer one field
 * at a time, in field-number order as the reference encoders do: payload timestamp,
 * then each metric, then seq. The reader walks a payload without copying.
 */
#ifndef IOTOS_CODEC_H
#define IOTOS_CODEC_H

#include "iotos/iotos_types.h"

typedef struct {
    uint8_t *data; /* NULL measures without writing */
    size_t capacity;
    size_t length;
} iotos__pb;

/* A metric to write. value holds the wire value for the datatype: a two's complement
 * 32-bit pattern for Int8-32, a 64-bit pattern for Int64, the number for Float and
 * Double, and a slice for String and Bytes. */
typedef struct {
    const char *name; /* NULL = no name (data messages use the alias) */
    bool has_alias;
    uint64_t alias;
    bool has_timestamp;
    uint64_t timestamp;
    bool has_datatype;
    uint32_t datatype; /* also selects how value is encoded */
    bool is_null;
    union {
        uint64_t integer;
        double number;
        bool boolean;
        struct {
            const uint8_t *data;
            size_t length;
        } bytes;
    } value;
} iotos__metric;

void iotos__pb_init(iotos__pb *pb, uint8_t *data, size_t capacity);
iotos_status iotos__pb_timestamp(iotos__pb *pb, uint64_t timestamp);
/* IOTOS_E_INVALID for a value the platform would not accept, IOTOS_E_TOO_LARGE when it
 * does not fit; either way nothing is written. */
iotos_status iotos__pb_metric(iotos__pb *pb, const iotos__metric *metric);
iotos_status iotos__pb_seq(iotos__pb *pb, uint64_t seq);
/* Checks a value without writing it. */
iotos_status iotos__pb_check_value(uint32_t datatype, const iotos__metric *metric);

/* A metric as read. Slices point into the payload. value_field is the protobuf field
 * that carried the value (10 to 16), or 0. */
typedef struct {
    const uint8_t *name;
    size_t name_length;
    bool has_name;
    bool has_alias;
    uint64_t alias;
    bool has_timestamp;
    uint64_t timestamp;
    bool has_datatype;
    uint32_t datatype;
    bool is_null;
    uint8_t value_field;
    uint64_t integer;  /* fields 10, 11 and 14 */
    uint64_t bits;     /* fields 12 and 13, as raw IEEE bits */
    const uint8_t *bytes; /* fields 15 and 16 */
    size_t length;
} iotos__metric_in;

typedef struct {
    bool has_timestamp;
    uint64_t timestamp;
    bool has_seq;
    uint64_t seq;
    uint32_t metric_count;
} iotos__payload_in;

typedef void (*iotos__metric_fn)(void *ctx, const iotos__metric_in *metric);

/* Reads a payload, calling fn (if not NULL) for each metric in order. IOTOS_E_INVALID
 * for bad varints, lengths past the end, unknown wire types and other malformed input;
 * it never reads outside data. */
iotos_status iotos__pb_read(const uint8_t *data, size_t length, iotos__payload_in *info,
                            iotos__metric_fn fn, void *ctx);

double iotos__pb_double(const iotos__metric_in *metric); /* fields 12 and 13 */
/* Two's complement readings of a wire integer. */
int64_t iotos__int64(uint64_t bits);
int32_t iotos__int32(uint64_t bits);

/* The largest integer the platform keeps exactly (2^53 - 1). */
#define IOTOS__SAFE_INTEGER 9007199254740991LL

#endif
