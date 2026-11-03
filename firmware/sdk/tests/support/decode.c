/* SPDX-License-Identifier: MIT */
/* Decodes recorded payloads with the SDK's reader, for assertions. The Go runtime's tests
 * decode the same bytes independently with the Tahu protobuf. */
#include <string.h>

#include "codec.h"
#include "fakes.h"

static void collect(void *ctx, const iotos__metric_in *m)
{
    decoded *d = (decoded *)ctx;
    decoded_metric *out;
    if (d->count >= sizeof(d->metrics) / sizeof(d->metrics[0])) {
        return;
    }
    out = &d->metrics[d->count++];
    memset(out, 0, sizeof(*out));
    out->has_name = m->has_name;
    if (m->has_name) {
        size_t n = m->name_length < sizeof(out->name) - 1 ? m->name_length : sizeof(out->name) - 1;
        memcpy(out->name, m->name, n);
    }
    out->has_alias = m->has_alias;
    out->alias = m->alias;
    out->has_timestamp = m->has_timestamp;
    out->timestamp = m->timestamp;
    out->has_datatype = m->has_datatype;
    out->datatype = m->datatype;
    out->is_null = m->is_null;
    out->value_field = m->value_field;
    out->integer = m->integer;
    out->number = iotos__pb_double(m);
    if (m->value_field == 15 || m->value_field == 16) {
        size_t n = m->length < sizeof(out->text) - 1 ? m->length : sizeof(out->text) - 1;
        memcpy(out->text, m->bytes, n);
        out->length = m->length;
    }
}

bool decode_payload(const uint8_t *data, size_t length, decoded *out)
{
    iotos__payload_in info;
    memset(out, 0, sizeof(*out));
    if (iotos__pb_read(data, length, &info, collect, out) != IOTOS_OK) {
        return false;
    }
    out->has_timestamp = info.has_timestamp;
    out->timestamp = info.timestamp;
    out->has_seq = info.has_seq;
    out->seq = info.seq;
    return true;
}

const decoded_metric *decoded_find(const decoded *d, const char *name)
{
    for (size_t i = 0; i < d->count; i++) {
        if (d->metrics[i].has_name && strcmp(d->metrics[i].name, name) == 0) {
            return &d->metrics[i];
        }
    }
    return NULL;
}

const decoded_metric *decoded_alias(const decoded *d, uint64_t alias)
{
    for (size_t i = 0; i < d->count; i++) {
        if (d->metrics[i].has_alias && d->metrics[i].alias == alias) {
            return &d->metrics[i];
        }
    }
    return NULL;
}
