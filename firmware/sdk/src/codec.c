/* SPDX-License-Identifier: MIT */
#include "codec.h"

#include <float.h>
#include <math.h>
#include <string.h>

#define SAFE_INTEGER IOTOS__SAFE_INTEGER
#define STRING_MAX 65536u

enum { WIRE_VARINT = 0, WIRE_FIXED64 = 1, WIRE_SLICE = 2, WIRE_FIXED32 = 5 };

void iotos__pb_init(iotos__pb *pb, uint8_t *data, size_t capacity)
{
    pb->data = data;
    pb->capacity = capacity;
    pb->length = 0;
}

static size_t varint_size(uint64_t value)
{
    size_t size = 1;
    while (value >= 0x80u) {
        value >>= 7;
        size++;
    }
    return size;
}

/* The write helpers assume the caller checked the space: in measuring mode (data NULL)
 * they only count. */
static void put(iotos__pb *pb, uint8_t byte)
{
    if (pb->data) {
        pb->data[pb->length] = byte;
    }
    pb->length++;
}

static void varint(iotos__pb *pb, uint64_t value)
{
    while (value >= 0x80u) {
        put(pb, (uint8_t)(value | 0x80u));
        value >>= 7;
    }
    put(pb, (uint8_t)value);
}

static void tag(iotos__pb *pb, unsigned field, unsigned wire)
{
    varint(pb, ((uint64_t)field << 3) | wire);
}

static void fixed(iotos__pb *pb, uint64_t value, unsigned bytes)
{
    for (unsigned i = 0; i < bytes; i++) {
        put(pb, (uint8_t)(value >> (8 * i)));
    }
}

static void slice(iotos__pb *pb, unsigned field, const void *data, size_t length)
{
    tag(pb, field, WIRE_SLICE);
    varint(pb, length);
    if (pb->data && length) {
        memcpy(pb->data + pb->length, data, length);
    }
    pb->length += length;
}

int64_t iotos__int64(uint64_t bits)
{
    return bits <= (uint64_t)INT64_MAX ? (int64_t)bits : -(int64_t)(~bits) - 1;
}

int32_t iotos__int32(uint64_t bits)
{
    uint32_t low = (uint32_t)bits;
    return low <= (uint32_t)INT32_MAX ? (int32_t)low : -(int32_t)(~low) - 1;
}

iotos_status iotos__pb_check_value(uint32_t datatype, const iotos__metric *m)
{
    uint64_t integer = m->value.integer;
    double number = m->value.number;
    switch (datatype) {
    case IOTOS_INT8:
    case IOTOS_INT16:
    case IOTOS_INT32:
    case IOTOS_UINT8:
    case IOTOS_UINT16:
    case IOTOS_UINT32:
    case IOTOS_INT64:
    case IOTOS_UINT64:
    case IOTOS_DATETIME:
    case IOTOS_FLOAT:
    case IOTOS_DOUBLE:
    case IOTOS_BOOLEAN:
    case IOTOS_STRING:
    case IOTOS_BYTES:
        break;
    default:
        return IOTOS_E_INVALID;
    }
    if (m->is_null) {
        return IOTOS_OK;
    }
    switch (datatype) {
    case IOTOS_INT8:
        return integer <= UINT32_MAX && iotos__int32(integer) >= INT8_MIN && iotos__int32(integer) <= INT8_MAX
                   ? IOTOS_OK : IOTOS_E_INVALID;
    case IOTOS_INT16:
        return integer <= UINT32_MAX && iotos__int32(integer) >= INT16_MIN && iotos__int32(integer) <= INT16_MAX
                   ? IOTOS_OK : IOTOS_E_INVALID;
    case IOTOS_INT32:
    case IOTOS_UINT32:
        return integer <= UINT32_MAX ? IOTOS_OK : IOTOS_E_INVALID;
    case IOTOS_UINT8:
        return integer <= UINT8_MAX ? IOTOS_OK : IOTOS_E_INVALID;
    case IOTOS_UINT16:
        return integer <= UINT16_MAX ? IOTOS_OK : IOTOS_E_INVALID;
    case IOTOS_INT64:
        return iotos__int64(integer) >= -SAFE_INTEGER && iotos__int64(integer) <= SAFE_INTEGER
                   ? IOTOS_OK : IOTOS_E_INVALID;
    case IOTOS_UINT64:
        return integer <= (uint64_t)SAFE_INTEGER ? IOTOS_OK : IOTOS_E_INVALID;
    case IOTOS_DATETIME:
        return integer <= (uint64_t)INT64_MAX ? IOTOS_OK : IOTOS_E_INVALID;
    case IOTOS_FLOAT:
        return isfinite(number) && number <= FLT_MAX && number >= -FLT_MAX ? IOTOS_OK : IOTOS_E_INVALID;
    case IOTOS_DOUBLE:
        return isfinite(number) ? IOTOS_OK : IOTOS_E_INVALID;
    case IOTOS_STRING:
        if (m->value.bytes.length > STRING_MAX || (m->value.bytes.length && !m->value.bytes.data)) {
            return IOTOS_E_INVALID;
        }
        return memchr(m->value.bytes.data ? (const void *)m->value.bytes.data : "", 0,
                      m->value.bytes.length)
                   ? IOTOS_E_INVALID : IOTOS_OK;
    case IOTOS_BYTES:
        return m->value.bytes.length && !m->value.bytes.data ? IOTOS_E_INVALID : IOTOS_OK;
    default:
        return IOTOS_OK;
    }
}

static void metric_fields(iotos__pb *pb, const iotos__metric *m)
{
    if (m->name) {
        slice(pb, 1, m->name, strlen(m->name));
    }
    if (m->has_alias) {
        tag(pb, 2, WIRE_VARINT);
        varint(pb, m->alias);
    }
    if (m->has_timestamp) {
        tag(pb, 3, WIRE_VARINT);
        varint(pb, m->timestamp);
    }
    if (m->has_datatype) {
        tag(pb, 4, WIRE_VARINT);
        varint(pb, m->datatype);
    }
    if (m->is_null) {
        tag(pb, 7, WIRE_VARINT);
        varint(pb, 1);
        return;
    }
    switch (m->datatype) {
    case IOTOS_INT8:
    case IOTOS_INT16:
    case IOTOS_INT32:
    case IOTOS_UINT8:
    case IOTOS_UINT16:
    case IOTOS_UINT32:
        tag(pb, 10, WIRE_VARINT);
        varint(pb, (uint32_t)m->value.integer);
        break;
    case IOTOS_INT64:
    case IOTOS_UINT64:
    case IOTOS_DATETIME:
        tag(pb, 11, WIRE_VARINT);
        varint(pb, m->value.integer);
        break;
    case IOTOS_FLOAT: {
        float narrow = (float)m->value.number;
        uint32_t bits;
        memcpy(&bits, &narrow, sizeof(bits));
        tag(pb, 12, WIRE_FIXED32);
        fixed(pb, bits, 4);
        break;
    }
    case IOTOS_DOUBLE: {
        uint64_t bits;
        memcpy(&bits, &m->value.number, sizeof(bits));
        tag(pb, 13, WIRE_FIXED64);
        fixed(pb, bits, 8);
        break;
    }
    case IOTOS_BOOLEAN:
        tag(pb, 14, WIRE_VARINT);
        varint(pb, m->value.boolean ? 1 : 0);
        break;
    case IOTOS_STRING:
        slice(pb, 15, m->value.bytes.data, m->value.bytes.length);
        break;
    case IOTOS_BYTES:
        slice(pb, 16, m->value.bytes.data, m->value.bytes.length);
        break;
    default:
        break;
    }
}

static bool fits(const iotos__pb *pb, size_t bytes)
{
    return bytes <= pb->capacity - pb->length;
}

iotos_status iotos__pb_timestamp(iotos__pb *pb, uint64_t timestamp)
{
    if (!fits(pb, 1 + varint_size(timestamp))) {
        return IOTOS_E_TOO_LARGE;
    }
    tag(pb, 1, WIRE_VARINT);
    varint(pb, timestamp);
    return IOTOS_OK;
}

iotos_status iotos__pb_metric(iotos__pb *pb, const iotos__metric *metric)
{
    iotos__pb measure;
    size_t body;
    iotos_status status = iotos__pb_check_value(metric->datatype, metric);
    if (status != IOTOS_OK) {
        return status;
    }
    iotos__pb_init(&measure, NULL, 0);
    metric_fields(&measure, metric);
    body = measure.length;
    if (!fits(pb, 1 + varint_size(body) + body)) {
        return IOTOS_E_TOO_LARGE;
    }
    tag(pb, 2, WIRE_SLICE);
    varint(pb, body);
    metric_fields(pb, metric);
    return IOTOS_OK;
}

iotos_status iotos__pb_seq(iotos__pb *pb, uint64_t seq)
{
    if (!fits(pb, 1 + varint_size(seq))) {
        return IOTOS_E_TOO_LARGE;
    }
    tag(pb, 3, WIRE_VARINT);
    varint(pb, seq);
    return IOTOS_OK;
}

/* Reader */

typedef struct {
    const uint8_t *data;
    size_t length, offset;
} reader;

static bool read_varint(reader *r, uint64_t *out)
{
    uint64_t value = 0;
    for (unsigned shift = 0; shift < 64; shift += 7) {
        uint8_t byte;
        if (r->offset >= r->length) {
            return false;
        }
        byte = r->data[r->offset++];
        if (shift == 63 && byte > 1) {
            return false;
        }
        value |= (uint64_t)(byte & 0x7fu) << shift;
        if (!(byte & 0x80u)) {
            *out = value;
            return true;
        }
    }
    return false;
}

static bool read_fixed(reader *r, unsigned bytes, uint64_t *out)
{
    uint64_t value = 0;
    if (bytes > r->length - r->offset) {
        return false;
    }
    for (unsigned i = 0; i < bytes; i++) {
        value |= (uint64_t)r->data[r->offset + i] << (8 * i);
    }
    r->offset += bytes;
    *out = value;
    return true;
}

static bool read_slice(reader *r, const uint8_t **data, size_t *length)
{
    uint64_t size;
    if (!read_varint(r, &size) || size > r->length - r->offset) {
        return false;
    }
    *data = r->data + r->offset;
    *length = (size_t)size;
    r->offset += (size_t)size;
    return true;
}

static bool read_tag(reader *r, unsigned *field, unsigned *wire)
{
    uint64_t key;
    if (!read_varint(r, &key) || key >> 3 == 0 || key >> 3 > 536870911u) {
        return false;
    }
    *field = (unsigned)(key >> 3);
    *wire = (unsigned)(key & 7u);
    return *wire == WIRE_VARINT || *wire == WIRE_FIXED64 || *wire == WIRE_SLICE || *wire == WIRE_FIXED32;
}

static bool skip(reader *r, unsigned wire)
{
    uint64_t ignored;
    const uint8_t *data;
    size_t length;
    switch (wire) {
    case WIRE_VARINT:
        return read_varint(r, &ignored);
    case WIRE_FIXED64:
        return read_fixed(r, 8, &ignored);
    case WIRE_FIXED32:
        return read_fixed(r, 4, &ignored);
    case WIRE_SLICE:
        return read_slice(r, &data, &length);
    default:
        return false;
    }
}

static bool read_metric(const uint8_t *data, size_t length, iotos__metric_in *m)
{
    reader r = {data, length, 0};
    memset(m, 0, sizeof(*m));
    while (r.offset < r.length) {
        unsigned field, wire;
        uint64_t value;
        if (!read_tag(&r, &field, &wire)) {
            return false;
        }
        switch (field) {
        case 1:
            if (wire != WIRE_SLICE || !read_slice(&r, &m->name, &m->name_length)) {
                return false;
            }
            m->has_name = true;
            break;
        case 2:
        case 3:
        case 4:
        case 7:
            if (wire != WIRE_VARINT || !read_varint(&r, &value)) {
                return false;
            }
            if (field == 2) {
                m->has_alias = true;
                m->alias = value;
            } else if (field == 3) {
                m->has_timestamp = true;
                m->timestamp = value;
            } else if (field == 4) {
                if (value > UINT32_MAX) {
                    return false;
                }
                m->has_datatype = true;
                m->datatype = (uint32_t)value;
            } else {
                m->is_null = value != 0;
            }
            break;
        case 10:
        case 11:
        case 14:
            if (wire != WIRE_VARINT || !read_varint(&r, &m->integer)) {
                return false;
            }
            if (field == 10 && m->integer > UINT32_MAX) {
                return false;
            }
            m->value_field = (uint8_t)field;
            break;
        case 12:
            if (wire != WIRE_FIXED32 || !read_fixed(&r, 4, &m->bits)) {
                return false;
            }
            m->value_field = 12;
            break;
        case 13:
            if (wire != WIRE_FIXED64 || !read_fixed(&r, 8, &m->bits)) {
                return false;
            }
            m->value_field = 13;
            break;
        case 15:
        case 16:
            if (wire != WIRE_SLICE || !read_slice(&r, &m->bytes, &m->length)) {
                return false;
            }
            m->value_field = (uint8_t)field;
            break;
        default:
            /* Flags, metadata, properties and complex values: not used by the SDK. */
            if (!skip(&r, wire)) {
                return false;
            }
        }
    }
    return true;
}

iotos_status iotos__pb_read(const uint8_t *data, size_t length, iotos__payload_in *info,
                            iotos__metric_fn fn, void *ctx)
{
    reader r = {data, length, 0};
    iotos__payload_in local;
    if (!info) {
        info = &local;
    }
    memset(info, 0, sizeof(*info));
    if (!data && length) {
        return IOTOS_E_INVALID;
    }
    while (r.offset < r.length) {
        unsigned field, wire;
        if (!read_tag(&r, &field, &wire)) {
            return IOTOS_E_INVALID;
        }
        if (field == 1 || field == 3) {
            uint64_t value;
            if (wire != WIRE_VARINT || !read_varint(&r, &value)) {
                return IOTOS_E_INVALID;
            }
            if (field == 1) {
                info->has_timestamp = true;
                info->timestamp = value;
            } else {
                info->has_seq = true;
                info->seq = value;
            }
        } else if (field == 2) {
            const uint8_t *body;
            size_t size;
            iotos__metric_in metric;
            if (wire != WIRE_SLICE || !read_slice(&r, &body, &size) || !read_metric(body, size, &metric)) {
                return IOTOS_E_INVALID;
            }
            info->metric_count++;
            if (fn) {
                fn(ctx, &metric);
            }
        } else if (!skip(&r, wire)) {
            return IOTOS_E_INVALID;
        }
    }
    return IOTOS_OK;
}

double iotos__pb_double(const iotos__metric_in *metric)
{
    if (metric->value_field == 12) {
        uint32_t bits = (uint32_t)metric->bits;
        float narrow;
        memcpy(&narrow, &bits, sizeof(narrow));
        return narrow;
    }
    if (metric->value_field == 13) {
        double wide;
        memcpy(&wide, &metric->bits, sizeof(wide));
        return wide;
    }
    return 0;
}
