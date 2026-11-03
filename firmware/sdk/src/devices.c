/* SPDX-License-Identifier: MIT */
/* Device types, device slots, aliases and deaths. */
#include <string.h>

#include "internal.h"

static bool valid_id(const char *id, size_t *length)
{
    size_t n = 0;
    if (!id) {
        return false;
    }
    for (; id[n]; n++) {
        char c = id[n];
        bool ok = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_'
                  || c == '.' || c == ':' || c == '-';
        if (!ok || n >= IOTOS_DEVICE_ID_MAX) {
            return false;
        }
    }
    *length = n;
    return n > 0;
}

iotos_status iotos__check_type(const iotos_device_type *type)
{
    iotos__metric probe;
    if (!type || !type->code || (type->metric_count && !type->metrics)) {
        return IOTOS_E_INVALID;
    }
    if (type->metric_count > IOTOS_MAX_METRICS_PER_TYPE) {
        return IOTOS_E_FULL;
    }
    memset(&probe, 0, sizeof(probe));
    probe.is_null = true;
    for (uint16_t i = 0; i < type->metric_count; i++) {
        const char *name = type->metrics[i].name;
        if (!name || !*name || strcmp(name, BDSEQ_METRIC) == 0 || strcmp(name, REBIRTH_METRIC) == 0
            || iotos__pb_check_value((uint32_t)type->metrics[i].datatype, &probe) != IOTOS_OK) {
            return IOTOS_E_INVALID;
        }
        for (uint16_t j = 0; j < i; j++) {
            if (strcmp(name, type->metrics[j].name) == 0) {
                return IOTOS_E_INVALID;
            }
        }
    }
    return IOTOS_OK;
}

iotos_status iotos_register_type(iotos_gateway *gw, const iotos_device_type *type)
{
    iotos_status status = IOTOS_OK;
    if (!gw || !gw->settings) {
        return IOTOS_E_INVALID;
    }
    iotos__lock(gw);
    for (uint8_t i = 0; i < gw->type_count; i++) {
        if (gw->types[i] == type) {
            iotos__unlock(gw);
            return IOTOS_OK;
        }
    }
    if (gw->type_count >= IOTOS_MAX_DEVICE_TYPES) {
        status = IOTOS_E_FULL;
    } else {
        status = iotos__check_type(type);
    }
    if (status == IOTOS_OK) {
        gw->types[gw->type_count++] = type;
    }
    iotos__unlock(gw);
    return status;
}

int32_t iotos__find_device(const iotos_gateway *gw, const char *id, size_t length)
{
    if (length > IOTOS_DEVICE_ID_MAX) {
        return -1;
    }
    for (int32_t slot = 0; slot < IOTOS_MAX_DEVICES; slot++) {
        const iotos__device_slot *d = &gw->devices[slot];
        if (d->state != SLOT_FREE && memcmp(d->id, id, length) == 0 && d->id[length] == '\0') {
            return slot;
        }
    }
    return -1;
}

const iotos_device_type *iotos__slot_type(const iotos_gateway *gw, int32_t slot)
{
    return gw->types[gw->devices[slot].type];
}

uint64_t iotos__alias(int32_t slot, uint16_t index)
{
    /* Unique across the node: node metrics take 1..n, device metrics carry their slot in
     * the high half. */
    return slot == NODE_SLOT ? (uint64_t)index + 1u : ((uint64_t)(slot + 1) << 16) | index;
}

int32_t iotos__find_metric(const iotos_device_type *type, const char *name, size_t length)
{
    if (!type) {
        return -1;
    }
    for (uint16_t i = 0; i < type->metric_count; i++) {
        const char *candidate = type->metrics[i].name;
        if (strlen(candidate) == length && memcmp(candidate, name, length) == 0) {
            return (int32_t)i;
        }
    }
    return -1;
}

void iotos__queue_births(iotos_gateway *gw)
{
    for (uint32_t slot = 0; slot < IOTOS_MAX_DEVICES; slot++) {
        if (gw->devices[slot].state == SLOT_BORN) {
            gw->devices[slot].state = SLOT_BIRTH_PENDING;
        }
    }
    gw->birth_cursor = 0;
}

uint16_t iotos__devices_online(const iotos_gateway *gw)
{
    uint16_t count = 0;
    for (uint32_t slot = 0; slot < IOTOS_MAX_DEVICES; slot++) {
        uint8_t state = gw->devices[slot].state;
        if (state == SLOT_BORN || state == SLOT_BIRTH_PENDING) {
            count++;
        }
    }
    return count;
}

iotos_status iotos__send_death(iotos_gateway *gw, int32_t slot)
{
    iotos__pb pb;
    bool valid;
    uint64_t now = iotos__now(gw, &valid);
    uint8_t seq = iotos__next_seq(gw);
    iotos_status status;
    iotos__pb_init(&pb, gw->tx, sizeof(gw->tx));
    if (valid) {
        (void)iotos__pb_timestamp(&pb, now);
    }
    (void)iotos__pb_seq(&pb, seq);
    if (!iotos__topic(gw, "DDEATH", gw->devices[slot].id)) {
        return IOTOS_E_INVALID;
    }
    status = iotos__publish(gw, gw->tx, pb.length);
    if (status == IOTOS_OK) {
        gw->seq = seq;
    }
    return status;
}

iotos_status iotos_device_add(iotos_gateway *gw, const char *id, const iotos_device_type *type)
{
    size_t length;
    int32_t free_slot = -1;
    uint8_t type_index = 0;
    bool known = false;
    if (!gw || !gw->settings || !valid_id(id, &length)) {
        return IOTOS_E_INVALID;
    }
    iotos__lock(gw);
    for (uint8_t i = 0; i < gw->type_count; i++) {
        if (gw->types[i] == type) {
            type_index = i;
            known = true;
        }
    }
    if (!known) {
        iotos__unlock(gw);
        return IOTOS_E_INVALID;
    }
    if (iotos__find_device(gw, id, length) >= 0) {
        iotos__unlock(gw);
        return IOTOS_E_DUPLICATE;
    }
    for (int32_t slot = 0; slot < IOTOS_MAX_DEVICES && free_slot < 0; slot++) {
        if (gw->devices[slot].state == SLOT_FREE) {
            free_slot = slot;
        }
    }
    if (free_slot < 0) {
        iotos__unlock(gw);
        return IOTOS_E_FULL;
    }
    memcpy(gw->devices[free_slot].id, id, length + 1);
    gw->devices[free_slot].type = type_index;
    gw->devices[free_slot].state = SLOT_BIRTH_PENDING;
    gw->device_count++;
    iotos__unlock(gw);
    return IOTOS_OK;
}

static iotos_status take_offline(iotos_gateway *gw, const char *id, bool remove)
{
    size_t length;
    int32_t slot;
    if (!gw || !gw->settings || !valid_id(id, &length)) {
        return IOTOS_E_INVALID;
    }
    iotos__lock(gw);
    slot = iotos__find_device(gw, id, length);
    if (slot < 0 || gw->writer.open) {
        iotos__unlock(gw);
        return IOTOS_E_INVALID;
    }
    if (gw->devices[slot].state == SLOT_BORN && iotos__can_publish(gw) && gw->node_born) {
        (void)iotos__send_death(gw, slot);
    }
    if (remove) {
        memset(&gw->devices[slot], 0, sizeof(gw->devices[slot]));
        gw->device_count--;
    } else {
        gw->devices[slot].state = SLOT_OFFLINE;
    }
    iotos__unlock(gw);
    return IOTOS_OK;
}

iotos_status iotos_device_offline(iotos_gateway *gw, const char *id)
{
    return take_offline(gw, id, false);
}

iotos_status iotos_device_remove(iotos_gateway *gw, const char *id)
{
    return take_offline(gw, id, true);
}
