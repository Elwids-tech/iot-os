/* SPDX-License-Identifier: MIT */
/*
 * Gateway health. Metrics are filled by name, so a node type without them (a direct
 * device's profile) is left alone, and a put that does not match the type is skipped.
 */
#include "internal.h"

static const char *connection_name(uint8_t type)
{
    switch (type) {
    case IOTOS_CONN_ETHERNET:
        return "ethernet";
    case IOTOS_CONN_WIFI:
        return "wifi";
    case IOTOS_CONN_CELLULAR:
        return "cellular";
    default:
        return "other";
    }
}

iotos_status iotos_set_firmware_version(iotos_gateway *gw, const char *version)
{
    if (!gw || !gw->settings) {
        return IOTOS_E_INVALID;
    }
    iotos__lock(gw);
    gw->firmware_version = version;
    iotos__unlock(gw);
    return IOTOS_OK;
}

iotos_status iotos_set_connection(iotos_gateway *gw, iotos_connection_type type, bool has_signal,
                                  double signal_dbm)
{
    /* Unsigned: bare-metal ARM uses short, unsigned enums. */
    if (!gw || !gw->settings || (unsigned)type > (unsigned)IOTOS_CONN_OTHER) {
        return IOTOS_E_INVALID;
    }
    iotos__lock(gw);
    gw->connection_type = (uint8_t)type;
    gw->connection_set = true;
    gw->has_signal = has_signal;
    gw->signal_dbm = signal_dbm;
    iotos__unlock(gw);
    return IOTOS_OK;
}

/* The values that change; sent in every node birth and every health interval. */
static void changing(iotos_writer *w)
{
    iotos_gateway *gw = w->gw;
    (void)iotos_put_i64(w, IOTOS_HEALTH_UPTIME, (int64_t)(gw->uptime_ms / 1000u));
    if (gw->connection_set) {
        (void)iotos_put_string(w, IOTOS_HEALTH_CONNECTION_TYPE, connection_name(gw->connection_type));
        if (gw->has_signal) {
            (void)iotos_put_double(w, IOTOS_HEALTH_SIGNAL_STRENGTH, gw->signal_dbm);
        } else {
            (void)iotos_put_null(w, IOTOS_HEALTH_SIGNAL_STRENGTH);
        }
    }
    (void)iotos_put_i64(w, IOTOS_HEALTH_DEVICES_CONFIGURED, gw->device_count);
    (void)iotos_put_i64(w, IOTOS_HEALTH_DEVICES_ONLINE, iotos__devices_online(gw));
    (void)iotos_put_i64(w, IOTOS_HEALTH_RECONNECTS, gw->reconnects);
}

void iotos__health_birth(iotos_writer *w)
{
    if (!w->type) {
        return;
    }
    changing(w);
    (void)iotos_put_string(w, IOTOS_HEALTH_SDK_VERSION, IOTOS_SDK_VERSION);
    if (w->gw->firmware_version) {
        (void)iotos_put_string(w, IOTOS_HEALTH_FIRMWARE_VERSION, w->gw->firmware_version);
    }
}

void iotos__health_tick(iotos_gateway *gw)
{
    uint32_t now;
    if (!gw->node_born || !iotos__can_publish(gw) || gw->writer.open || !gw->settings->node_type) {
        return;
    }
    now = iotos__mono(gw);
    if (!iotos__due(now, gw->next_health_ms)) {
        return;
    }
    gw->next_health_ms = now + IOTOS_HEALTH_INTERVAL_S * 1000u;
    iotos__writer_open(gw, NODE_SLOT, false);
    changing(&gw->writer);
    if (gw->writer.count) {
        (void)iotos__writer_send(&gw->writer);
    }
    iotos__writer_close(&gw->writer);
}
