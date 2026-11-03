/* SPDX-License-Identifier: MIT */
/*
 * Inbound messages: the host application's STATE, and NCMD/DCMD commands. Commands are
 * matched by metric name (the platform sends no alias), checked against the device
 * type, and handed to on_command with the lock released.
 */
#include <math.h>
#include <string.h>

#include "internal.h"

#define SAFE_INTEGER IOTOS__SAFE_INTEGER
#define NAME_IN_LOG 48

static bool take(const char **cursor, size_t *left, const char *prefix)
{
    size_t length = strlen(prefix);
    if (length > *left || memcmp(*cursor, prefix, length) != 0) {
        return false;
    }
    *cursor += length;
    *left -= length;
    return true;
}

static bool starts(const uint8_t *data, size_t length, const char *text)
{
    size_t n = strlen(text);
    return length >= n && memcmp(data, text, n) == 0;
}

/* 1 online, 0 offline, -1 unreadable. Sparkplug 3.0 hosts send {"online":true,...};
 * older ones send the text ONLINE or OFFLINE. */
static int host_state(const uint8_t *data, size_t length)
{
    static const char key[] = "\"online\"";
    size_t i = 0;
    while (i < length && (data[i] == ' ' || data[i] == '\t' || data[i] == '\r' || data[i] == '\n')) {
        i++;
    }
    if (starts(data + i, length - i, "ONLINE")) {
        return 1;
    }
    if (starts(data + i, length - i, "OFFLINE")) {
        return 0;
    }
    for (; i + sizeof(key) - 1 <= length; i++) {
        if (memcmp(data + i, key, sizeof(key) - 1) == 0) {
            i += sizeof(key) - 1;
            while (i < length && (data[i] == ' ' || data[i] == '\t')) {
                i++;
            }
            if (i >= length || data[i] != ':') {
                return -1;
            }
            i++;
            while (i < length && (data[i] == ' ' || data[i] == '\t')) {
                i++;
            }
            if (starts(data + i, length - i, "true")) {
                return 1;
            }
            return starts(data + i, length - i, "false") ? 0 : -1;
        }
    }
    return -1;
}

static void handle_state(iotos_gateway *gw, const uint8_t *data, size_t length)
{
    int online;
    if (!gw->connected) {
        return; /* delivered during connect: the retained STATE follows the subscription */
    }
    online = host_state(data, length);
    if (online < 0) {
        iotos__log(gw, IOTOS_LOG_WARN, "Ignored an unreadable host STATE message.", NULL, NULL, NULL);
        return;
    }
    if (online) {
        /* A second online STATE means the host restarted: it needs every birth again. */
        iotos__event(gw, gw->host_online ? IOTOS_EVENT_REBIRTH : IOTOS_EVENT_HOST_ONLINE, IOTOS_OK);
        gw->host_online = true;
        iotos__start_births(gw);
    } else if (gw->host_online) {
        gw->host_online = false;
        gw->node_born = false;
        gw->node_birth_pending = false;
        gw->state = STATE_WAITING_FOR_HOST;
        iotos__event(gw, IOTOS_EVENT_HOST_OFFLINE, IOTOS_OK);
        iotos__log(gw, IOTOS_LOG_WARN, "The host application is offline; publishing paused.", NULL, NULL,
                   NULL);
    }
}

typedef struct {
    iotos_gateway *gw;
    bool node;
} command;

static void reject(iotos_gateway *gw, iotos_status why, const char *device, const iotos__metric_in *m,
                   const char *reason)
{
    char name[NAME_IN_LOG];
    size_t length = m && m->has_name ? m->name_length : 0;
    if (length >= sizeof(name)) {
        length = sizeof(name) - 1;
    }
    if (length) {
        memcpy(name, m->name, length);
    }
    name[length] = '\0';
    iotos__event(gw, IOTOS_EVENT_COMMAND_REJECTED, why);
    iotos__log(gw, IOTOS_LOG_WARN, device ? "Rejected a command for device " : "Rejected a node command",
               device ? device : "", length ? " metric " : "", length ? name : "");
    iotos__log(gw, IOTOS_LOG_WARN, "  Reason: ", reason, ".", NULL);
}

static bool convert(iotos_gateway *gw, const iotos__metric_in *m, iotos_datatype datatype, iotos_value *v)
{
    memset(v, 0, sizeof(*v));
    v->datatype = datatype;
    switch (datatype) {
    case IOTOS_INT8:
    case IOTOS_INT16:
    case IOTOS_INT32: {
        int32_t x = iotos__int32(m->integer);
        int32_t low = datatype == IOTOS_INT8 ? INT8_MIN : datatype == IOTOS_INT16 ? INT16_MIN : INT32_MIN;
        int32_t high = datatype == IOTOS_INT8 ? INT8_MAX : datatype == IOTOS_INT16 ? INT16_MAX : INT32_MAX;
        v->as.i64 = x;
        return m->value_field == 10 && x >= low && x <= high;
    }
    case IOTOS_UINT8:
    case IOTOS_UINT16:
    case IOTOS_UINT32:
        v->as.u64 = m->integer;
        return m->value_field == 10
               && m->integer <= (datatype == IOTOS_UINT8 ? UINT8_MAX : datatype == IOTOS_UINT16 ? UINT16_MAX : UINT32_MAX);
    case IOTOS_INT64:
        v->as.i64 = iotos__int64(m->integer);
        return m->value_field == 11 && v->as.i64 >= -SAFE_INTEGER && v->as.i64 <= SAFE_INTEGER;
    case IOTOS_UINT64:
        v->as.u64 = m->integer;
        return m->value_field == 11 && m->integer <= (uint64_t)SAFE_INTEGER;
    case IOTOS_DATETIME:
        v->as.utc_ms = m->integer;
        return m->value_field == 11;
    case IOTOS_FLOAT:
    case IOTOS_DOUBLE:
        v->as.number = iotos__pb_double(m);
        return m->value_field == (datatype == IOTOS_FLOAT ? 12 : 13) && isfinite(v->as.number);
    case IOTOS_BOOLEAN:
        v->as.boolean = m->integer != 0;
        return m->value_field == 14;
    case IOTOS_STRING:
        if (m->value_field != 15 || m->length > IOTOS_COMMAND_STRING_MAX || memchr(m->bytes, 0, m->length)) {
            return false;
        }
        memcpy(gw->command_text, m->bytes, m->length);
        gw->command_text[m->length] = '\0';
        v->as.string = gw->command_text;
        return true;
    case IOTOS_BYTES:
        v->as.bytes.data = m->bytes;
        v->as.bytes.length = m->length;
        return m->value_field == 16;
    default:
        return false;
    }
}

static void on_metric(void *ctx, const iotos__metric_in *m)
{
    command *c = (command *)ctx;
    iotos_gateway *gw = c->gw;
    const char *device = c->node ? NULL : gw->command_device;
    const iotos_device_type *type = gw->settings->node_type;
    const iotos_metric_def *def;
    iotos_value value;
    int32_t index;

    if (!gw->connected) {
        return; /* lost while an earlier metric was handled */
    }
    if (!m->has_name || !m->name_length || memchr(m->name, 0, m->name_length)) {
        reject(gw, IOTOS_E_INVALID, device, m, "commands must name the metric");
        return;
    }
    if (c->node && m->name_length == strlen(REBIRTH_METRIC) && memcmp(m->name, REBIRTH_METRIC, m->name_length) == 0) {
        if (m->value_field == 14 && m->integer && gw->host_online) {
            iotos__event(gw, IOTOS_EVENT_REBIRTH, IOTOS_OK);
            iotos__start_births(gw);
        }
        return;
    }
    if (!gw->host_online || !gw->node_born) {
        /* Before this session's births, born states are stale. */
        reject(gw, IOTOS_E_OFFLINE, device, m, "the gateway is not born yet");
        return;
    }
    if (!c->node) {
        int32_t slot = iotos__find_device(gw, device, strlen(device));
        if (slot < 0) {
            reject(gw, IOTOS_E_INVALID, device, m, "unknown device");
            return;
        }
        if (gw->devices[slot].state != SLOT_BORN) {
            reject(gw, IOTOS_E_OFFLINE, device, m, "the device is offline or not born yet");
            return;
        }
        type = iotos__slot_type(gw, slot);
    }
    index = iotos__find_metric(type, (const char *)m->name, m->name_length);
    if (index < 0) {
        reject(gw, IOTOS_E_INVALID, device, m, "unknown metric");
        return;
    }
    def = &type->metrics[index];
    if (!def->writable) {
        reject(gw, IOTOS_E_INVALID, device, m, "the metric does not accept commands");
        return;
    }
    if (!m->has_datatype || m->datatype != (uint32_t)def->datatype) {
        reject(gw, IOTOS_E_INVALID, device, m, "wrong datatype");
        return;
    }
    if (m->is_null || !convert(gw, m, def->datatype, &value)) {
        reject(gw, IOTOS_E_INVALID, device, m, "the value is missing or out of range");
        return;
    }
    /* Released, so on_command can publish the new state straight away. */
    iotos__unlock(gw);
    if (gw->callbacks.on_command) {
        gw->callbacks.on_command(gw->callbacks.ctx, device, def->name, &value);
    }
    iotos__lock(gw);
}

void iotos__inbound(iotos_gateway *gw, const char *topic, size_t topic_length, const uint8_t *data,
                    size_t length, bool retained)
{
    const iotos_settings *s = gw->settings;
    const char *cursor = topic;
    size_t left = topic_length;
    command c;

    if (take(&cursor, &left, "spBv1.0/STATE/")) {
        if (left == strlen(s->host_id) && memcmp(cursor, s->host_id, left) == 0) {
            handle_state(gw, data, length);
        }
        return;
    }
    if (!take(&cursor, &left, "spBv1.0/") || !take(&cursor, &left, s->group_id) || !take(&cursor, &left, "/")) {
        return;
    }
    if (take(&cursor, &left, "NCMD/")) {
        c.node = true;
    } else if (take(&cursor, &left, "DCMD/")) {
        c.node = false;
    } else {
        return;
    }
    if (!take(&cursor, &left, s->edge_node_id)) {
        return;
    }
    if (c.node ? left != 0 : (!take(&cursor, &left, "/") || left == 0)) {
        return;
    }
    if (!c.node) {
        if (left > IOTOS_DEVICE_ID_MAX) {
            reject(gw, IOTOS_E_INVALID, "(ID too long)", NULL, "unknown device");
            return;
        }
        memcpy(gw->command_device, cursor, left);
        gw->command_device[left] = '\0';
    }
    if (retained) {
        iotos__log(gw, IOTOS_LOG_DEBUG, "Ignored a retained command.", NULL, NULL, NULL);
        return;
    }
    if (length > IOTOS_RX_BUFFER || iotos__pb_read(data, length, NULL, NULL, NULL) != IOTOS_OK) {
        reject(gw, IOTOS_E_INVALID, c.node ? NULL : gw->command_device, NULL, "the payload is not valid Sparkplug");
        return;
    }
    c.gw = gw;
    gw->in_inbound = true;
    (void)iotos__pb_read(data, length, NULL, on_metric, &c);
    gw->in_inbound = false;
}

void iotos_mqtt_inbound(iotos_gateway *gw, const char *topic, const uint8_t *data, size_t len, bool retained)
{
    bool take_lock;
    if (!gw || !gw->settings || !topic || (!data && len)) {
        return;
    }
    /* Ports call this from inside their poll, where iotos_poll already holds the lock. */
    take_lock = !gw->polling;
    if (take_lock) {
        iotos__lock(gw);
    }
    iotos__inbound(gw, topic, strlen(topic), data, len, retained);
    if (take_lock) {
        iotos__unlock(gw);
        iotos__flush_events(gw);
    }
}
