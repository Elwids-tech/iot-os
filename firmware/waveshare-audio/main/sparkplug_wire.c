#include "sparkplug_wire.h"
#include <string.h>

typedef struct { uint8_t *data; size_t length, capacity; bool okay; } writer_t;
typedef struct { const uint8_t *data; size_t length, offset; } reader_t;

static void byte(writer_t *w, uint8_t value) {
    if (w->length >= w->capacity) { w->okay=false; return; }
    w->data[w->length++]=value;
}
static void varint(writer_t *w, uint64_t value) {
    while (value >= 128) { byte(w, (uint8_t)value | 128); value >>= 7; }
    byte(w, (uint8_t)value);
}
static void integer(writer_t *w, unsigned field, uint64_t value) {
    varint(w, field << 3); varint(w, value);
}
static void bytes(writer_t *w, unsigned field, const void *data, size_t length) {
    varint(w, (field << 3) | 2); varint(w, length);
    if (length > w->capacity-w->length) { w->okay=false; return; }
    memcpy(w->data+w->length, data, length); w->length+=length;
}
static void string(writer_t *w, unsigned field, const char *value) {
    bytes(w, field, value, strlen(value));
}

size_t wave_sp_encode(const wave_sp_payload_t *p, uint8_t *out, size_t capacity) {
    if (!p || !out || p->count > WAVE_SP_MAX_METRICS) return 0;
    writer_t w={out,0,capacity,true};
    if (p->has_timestamp) integer(&w,1,p->timestamp);
    for (size_t i=0; i<p->count; i++) {
        const wave_sp_metric_t *m=&p->metrics[i];
        uint8_t encoded[256]; writer_t metric={encoded,0,sizeof(encoded),true};
        if (m->name[0]) string(&metric,1,m->name);
        if (m->has_alias) integer(&metric,2,m->alias);
        integer(&metric,4,m->datatype);
        if (m->has_value) {
            if (m->datatype==12) string(&metric,15,m->string_value);
            else if (m->datatype==11 && m->value<=1) integer(&metric,14,m->value);
            else if (m->datatype==3 && m->value<=UINT32_MAX) integer(&metric,10,m->value);
            else if (m->datatype==4) integer(&metric,11,m->value);
            else return 0;
        }
        if (!metric.okay) return 0;
        bytes(&w,2,encoded,metric.length);
    }
    if (p->has_seq) integer(&w,3,p->seq);
    if (p->uuid[0]) string(&w,4,p->uuid);
    return w.okay ? w.length : 0;
}

static bool read_varint(reader_t *r, uint64_t *out) {
    uint64_t value=0;
    for (unsigned shift=0; shift<70; shift+=7) {
        if (r->offset>=r->length) return false;
        uint8_t b=r->data[r->offset++];
        if (shift==63 && (b & 254)) return false;
        value |= (uint64_t)(b & 127) << shift;
        if (!(b & 128)) { *out=value; return true; }
    }
    return false;
}
static bool read_slice(reader_t *r, reader_t *slice) {
    uint64_t length;
    if (!read_varint(r,&length) || length>r->length-r->offset) return false;
    *slice=(reader_t){r->data+r->offset,(size_t)length,0};
    r->offset+=(size_t)length; return true;
}
static bool read_string(reader_t *r, char *out, size_t capacity) {
    reader_t slice;
    if (!read_slice(r,&slice) || slice.length>=capacity || memchr(slice.data,0,slice.length)) return false;
    memcpy(out,slice.data,slice.length); out[slice.length]=0; return true;
}
static bool skip(reader_t *r, unsigned wire) {
    uint64_t ignored; reader_t slice; size_t length;
    if (wire==0) return read_varint(r,&ignored);
    if (wire==2) return read_slice(r,&slice);
    if (wire!=1 && wire!=5) return false;
    length=wire==1 ? 8 : 4;
    if (length>r->length-r->offset) return false;
    r->offset+=length; return true;
}
static bool metric_decode(reader_t *r, wave_sp_metric_t *m) {
    unsigned value_field=0; uint32_t seen=0;
    while (r->offset<r->length) {
        uint64_t tag,value; if (!read_varint(r,&tag) || tag<8 || tag>UINT32_MAX) return false;
        unsigned field=(unsigned)(tag>>3), wire=tag & 7;
        if (field<=16) {
            if (seen & (1u<<field)) return false;
            seen |= 1u<<field;
        }
        if (field==1 || field==15) {
            if (wire!=2 || !read_string(r,field==1?m->name:m->string_value,field==1?sizeof(m->name):sizeof(m->string_value))) return false;
            if (field==15) { if (value_field) return false; value_field=field; }
        } else if (field==2 || field==4 || (field>=5 && field<=7) || field==10 || field==11 || field==14) {
            if (wire!=0 || !read_varint(r,&value)) return false;
            if (field==2) { m->alias=value; m->has_alias=true; }
            else if (field==4) m->datatype=value;
            else if (field>=5 && field<=7) { if (value) return false; }
            else { if (value_field) return false; value_field=field; m->value=value; }
        } else {
            // Other oneof values must never be mistaken for absent/default values.
            if (field>=12 && field<=19 && field!=14 && field!=15) return false;
            if (!skip(r,wire)) return false;
        }
    }
    m->has_value=value_field!=0;
    return m->has_value && ((m->datatype==3 && value_field==10 && m->value<=UINT32_MAX)
        || (m->datatype==4 && value_field==11)
        || (m->datatype==11 && value_field==14 && m->value<=1)
        || (m->datatype==12 && value_field==15));
}
bool wave_sp_decode(const uint8_t *data, size_t length, wave_sp_payload_t *p) {
    if (!data || !p || !length || length>2048) return false;
    memset(p,0,sizeof(*p)); reader_t r={data,length,0}; bool has_uuid=false;
    while (r.offset<r.length) {
        uint64_t tag,value; if (!read_varint(&r,&tag) || tag<8 || tag>UINT32_MAX) return false;
        unsigned field=(unsigned)(tag>>3), wire=tag & 7;
        if (field==1 || field==3) {
            if (wire!=0 || !read_varint(&r,&value)) return false;
            if (field==1) { if(p->has_timestamp) return false; p->timestamp=value; p->has_timestamp=true; }
            else { if(p->has_seq) return false; p->seq=value; p->has_seq=true; }
        } else if (field==2) {
            reader_t metric;
            if (wire!=2 || p->count>=WAVE_SP_MAX_METRICS || !read_slice(&r,&metric)
                || !metric_decode(&metric,&p->metrics[p->count++])) return false;
        } else if (field==4) {
            if (has_uuid || wire!=2 || !read_string(&r,p->uuid,sizeof(p->uuid))) return false;
            has_uuid=true;
        } else if (!skip(&r,wire)) return false;
    }
    return true;
}
