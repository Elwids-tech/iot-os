/* SPDX-License-Identifier: MIT */
/*
 * Writers encode straight into the transmit buffer. Data messages carry aliases only;
 * births carry every metric of the type with its name, alias and datatype, as nulls
 * when on_birth did not write them.
 */
#include <string.h>

#include "internal.h"

#define SAFE_INTEGER IOTOS__SAFE_INTEGER

static bool is_filled(const iotos_writer *w, int32_t index)
{
    return (w->filled[index / 8] >> (index % 8)) & 1u;
}

void iotos__writer_open(iotos_gateway *gw, int32_t slot, bool birth)
{
    iotos_writer *w = &gw->writer;
    iotos__pb pb;
    bool valid;
    uint64_t now = iotos__now(gw, &valid);
    memset(w, 0, sizeof(*w));
    w->gw = gw;
    w->slot = slot;
    w->birth = birth;
    w->open = true;
    w->type = slot == NODE_SLOT ? gw->settings->node_type : iotos__slot_type(gw, slot);
    w->clock_valid = valid;
    w->clock_ms = now;
    iotos__pb_init(&pb, gw->tx, sizeof(gw->tx) - SEQ_RESERVE);
    if (valid) {
        (void)iotos__pb_timestamp(&pb, now);
    }
    w->length = pb.length;
}

void iotos__writer_close(iotos_writer *w)
{
    w->open = false;
}

iotos_status iotos__writer_add(iotos_writer *w, int32_t index, iotos__metric *m)
{
    iotos__pb pb;
    iotos_status status;
    if (index >= 0) {
        if (w->birth && is_filled(w, index)) {
            return IOTOS_E_DUPLICATE;
        }
        m->has_alias = true;
        m->alias = iotos__alias(w->slot, (uint16_t)index);
        m->name = w->birth ? w->type->metrics[index].name : NULL;
        m->has_datatype = w->birth;
        m->datatype = (uint32_t)w->type->metrics[index].datatype;
    }
    if (w->use_at) {
        m->has_timestamp = true;
        m->timestamp = w->at_ms;
    } else if (w->clock_valid) {
        m->has_timestamp = true;
        m->timestamp = w->clock_ms;
    } else {
        return IOTOS_E_CLOCK;
    }
    iotos__pb_init(&pb, w->gw->tx, sizeof(w->gw->tx) - SEQ_RESERVE);
    pb.length = w->length;
    status = iotos__pb_metric(&pb, m);
    if (status == IOTOS_E_TOO_LARGE) {
        w->overflow = true;
    }
    if (status != IOTOS_OK) {
        return status;
    }
    w->length = pb.length;
    w->count++;
    if (index >= 0) {
        w->filled[index / 8] |= (uint8_t)(1u << (index % 8));
    }
    return IOTOS_OK;
}

iotos_status iotos__writer_send(iotos_writer *w)
{
    iotos_gateway *gw = w->gw;
    bool node = w->slot == NODE_SLOT;
    const char *kind = w->birth ? (node ? "NBIRTH" : "DBIRTH") : (node ? "NDATA" : "DDATA");
    uint8_t seq = w->birth && node ? 0 : iotos__next_seq(gw);
    iotos__pb pb;
    iotos_status status;
    iotos__pb_init(&pb, gw->tx, sizeof(gw->tx));
    pb.length = w->length;
    if (iotos__pb_seq(&pb, seq) != IOTOS_OK) {
        return IOTOS_E_TOO_LARGE;
    }
    if (!iotos__topic(gw, kind, node ? NULL : gw->devices[w->slot].id)) {
        return IOTOS_E_INVALID;
    }
    status = iotos__publish(gw, gw->tx, pb.length);
    if (status == IOTOS_OK) {
        gw->seq = seq;
    }
    return status;
}

static iotos__metric by_name(const char *name, iotos_datatype datatype)
{
    iotos__metric m;
    memset(&m, 0, sizeof(m));
    m.name = name;
    m.has_datatype = true;
    m.datatype = (uint32_t)datatype;
    return m;
}

iotos_status iotos__write_birth(iotos_gateway *gw, int32_t slot)
{
    iotos_writer *w = &gw->writer;
    iotos_status status = IOTOS_OK;
    iotos__writer_open(gw, slot, true);
    if (slot == NODE_SLOT) {
        iotos__metric bd = by_name(BDSEQ_METRIC, IOTOS_INT64);
        iotos__metric rebirth = by_name(REBIRTH_METRIC, IOTOS_BOOLEAN);
        bd.value.integer = gw->bd_seq;
        rebirth.value.boolean = false;
        status = iotos__writer_add(w, -1, &bd);
        if (status == IOTOS_OK) {
            status = iotos__writer_add(w, -1, &rebirth);
        }
        if (status == IOTOS_OK) {
            iotos__health_birth(w);
        }
    }
    if (status == IOTOS_OK && gw->callbacks.on_birth) {
        gw->callbacks.on_birth(gw->callbacks.ctx, slot == NODE_SLOT ? NULL : gw->devices[slot].id, w);
    }
    for (uint16_t i = 0; status == IOTOS_OK && w->type && i < w->type->metric_count; i++) {
        if (!is_filled(w, i)) {
            iotos__metric null_metric;
            memset(&null_metric, 0, sizeof(null_metric));
            null_metric.is_null = true;
            status = iotos__writer_add(w, i, &null_metric);
        }
    }
    if (status == IOTOS_OK && w->overflow) {
        status = IOTOS_E_TOO_LARGE;
    }
    if (status == IOTOS_OK) {
        status = iotos__writer_send(w);
    }
    iotos__writer_close(w);
    return status;
}

/* Public writer */

iotos_status iotos_begin(iotos_gateway *gw, const char *device_id, iotos_writer **out)
{
    int32_t slot = NODE_SLOT;
    if (!gw || !gw->settings || !out) {
        return IOTOS_E_INVALID;
    }
    *out = NULL;
    iotos__lock(gw);
    if (gw->writer.open) {
        iotos__unlock(gw); /* only reachable without a lock port */
        return IOTOS_E_INVALID;
    }
    if (device_id) {
        slot = iotos__find_device(gw, device_id, strlen(device_id));
    }
    if (device_id ? slot < 0 : !gw->settings->node_type) {
        iotos__unlock(gw);
        return IOTOS_E_INVALID;
    }
    iotos__writer_open(gw, slot, false);
    *out = &gw->writer;
    return IOTOS_OK;
}

static iotos_status lookup(iotos_writer *w, const char *metric, int32_t *index, iotos__metric *m)
{
    if (!w || !w->open || !metric) {
        return IOTOS_E_INVALID;
    }
    *index = iotos__find_metric(w->type, metric, strlen(metric));
    if (*index < 0) {
        return IOTOS_E_INVALID;
    }
    memset(m, 0, sizeof(*m));
    m->datatype = (uint32_t)w->type->metrics[*index].datatype;
    return IOTOS_OK;
}

static bool narrow_signed(uint32_t datatype, int64_t value, iotos__metric *m)
{
    switch (datatype) {
    case IOTOS_INT8:
        if (value < INT8_MIN || value > INT8_MAX) {
            return false;
        }
        break;
    case IOTOS_INT16:
        if (value < INT16_MIN || value > INT16_MAX) {
            return false;
        }
        break;
    case IOTOS_INT32:
        if (value < INT32_MIN || value > INT32_MAX) {
            return false;
        }
        break;
    case IOTOS_INT64:
        if (value < -SAFE_INTEGER || value > SAFE_INTEGER) {
            return false;
        }
        m->value.integer = (uint64_t)value;
        return true;
    case IOTOS_UINT8:
    case IOTOS_UINT16:
    case IOTOS_UINT32:
    case IOTOS_UINT64:
        if (value < 0) {
            return false;
        }
        m->value.integer = (uint64_t)value;
        return datatype == IOTOS_UINT8 ? value <= UINT8_MAX
             : datatype == IOTOS_UINT16 ? value <= UINT16_MAX
             : datatype == IOTOS_UINT32 ? value <= (int64_t)UINT32_MAX
                                        : value <= SAFE_INTEGER;
    case IOTOS_FLOAT:
    case IOTOS_DOUBLE:
        if (value < -SAFE_INTEGER || value > SAFE_INTEGER) {
            return false;
        }
        m->value.number = (double)value;
        return true;
    default:
        return false;
    }
    m->value.integer = (uint32_t)(int32_t)value; /* Int8-32 travel as a 32-bit pattern */
    return true;
}

iotos_status iotos_put_i64(iotos_writer *w, const char *metric, int64_t value)
{
    int32_t index;
    iotos__metric m;
    iotos_status status = lookup(w, metric, &index, &m);
    if (status != IOTOS_OK) {
        return status;
    }
    return narrow_signed(m.datatype, value, &m) ? iotos__writer_add(w, index, &m) : IOTOS_E_INVALID;
}

iotos_status iotos_put_u64(iotos_writer *w, const char *metric, uint64_t value)
{
    int32_t index;
    iotos__metric m;
    iotos_status status = lookup(w, metric, &index, &m);
    if (status != IOTOS_OK) {
        return status;
    }
    if (value > (uint64_t)SAFE_INTEGER) {
        return IOTOS_E_INVALID;
    }
    return narrow_signed(m.datatype, (int64_t)value, &m) ? iotos__writer_add(w, index, &m) : IOTOS_E_INVALID;
}

iotos_status iotos_put_double(iotos_writer *w, const char *metric, double value)
{
    int32_t index;
    iotos__metric m;
    iotos_status status = lookup(w, metric, &index, &m);
    if (status != IOTOS_OK) {
        return status;
    }
    if (m.datatype != IOTOS_FLOAT && m.datatype != IOTOS_DOUBLE) {
        return IOTOS_E_INVALID;
    }
    m.value.number = value;
    return iotos__writer_add(w, index, &m);
}

static iotos_status put_typed(iotos_writer *w, const char *metric, iotos_datatype datatype, iotos__metric *value)
{
    int32_t index;
    iotos__metric m;
    iotos_status status = lookup(w, metric, &index, &m);
    if (status != IOTOS_OK) {
        return status;
    }
    if (m.datatype != (uint32_t)datatype) {
        return IOTOS_E_INVALID;
    }
    value->datatype = m.datatype;
    return iotos__writer_add(w, index, value);
}

iotos_status iotos_put_bool(iotos_writer *w, const char *metric, bool value)
{
    iotos__metric m;
    memset(&m, 0, sizeof(m));
    m.value.boolean = value;
    return put_typed(w, metric, IOTOS_BOOLEAN, &m);
}

iotos_status iotos_put_string(iotos_writer *w, const char *metric, const char *value)
{
    iotos__metric m;
    if (!value) {
        return IOTOS_E_INVALID;
    }
    memset(&m, 0, sizeof(m));
    m.value.bytes.data = (const uint8_t *)value;
    m.value.bytes.length = strlen(value);
    return put_typed(w, metric, IOTOS_STRING, &m);
}

iotos_status iotos_put_datetime(iotos_writer *w, const char *metric, uint64_t utc_ms)
{
    iotos__metric m;
    memset(&m, 0, sizeof(m));
    m.value.integer = utc_ms;
    return put_typed(w, metric, IOTOS_DATETIME, &m);
}

iotos_status iotos_put_bytes(iotos_writer *w, const char *metric, const uint8_t *data, size_t len)
{
    iotos__metric m;
    memset(&m, 0, sizeof(m));
    m.value.bytes.data = data;
    m.value.bytes.length = len;
    return put_typed(w, metric, IOTOS_BYTES, &m);
}

iotos_status iotos_put_null(iotos_writer *w, const char *metric)
{
    int32_t index;
    iotos__metric m;
    iotos_status status = lookup(w, metric, &index, &m);
    if (status != IOTOS_OK) {
        return status;
    }
    m.is_null = true;
    return iotos__writer_add(w, index, &m);
}

iotos_status iotos_put_at(iotos_writer *w, uint64_t utc_ms)
{
    if (!w || !w->open) {
        return IOTOS_E_INVALID;
    }
    w->use_at = true;
    w->at_ms = utc_ms;
    return IOTOS_OK;
}

iotos_status iotos_commit(iotos_writer *w)
{
    iotos_gateway *gw;
    iotos_status status;
    if (!w || !w->open || w->birth) {
        return IOTOS_E_INVALID; /* birth writers are sent by the SDK */
    }
    gw = w->gw;
    if (w->slot != NODE_SLOT && gw->devices[w->slot].state != SLOT_BORN) {
        /* Not born: its birth (queued now if it was offline) carries the current values. */
        if (gw->devices[w->slot].state == SLOT_OFFLINE) {
            gw->devices[w->slot].state = SLOT_BIRTH_PENDING;
        }
        status = IOTOS_PENDING_BIRTH;
    } else if (!iotos__can_publish(gw)) {
        status = IOTOS_E_OFFLINE;
    } else if (!gw->node_born) {
        status = IOTOS_PENDING_BIRTH;
    } else if (!w->count) {
        status = IOTOS_OK;
    } else {
        status = iotos__writer_send(w);
    }
    iotos__writer_close(w);
    iotos__unlock(gw);
    return status;
}

void iotos_abort(iotos_writer *w)
{
    if (!w || !w->open || w->birth) {
        return;
    }
    iotos__writer_close(w);
    iotos__unlock(w->gw);
}
