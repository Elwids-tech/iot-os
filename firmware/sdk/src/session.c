/* SPDX-License-Identifier: MIT */
/*
 * The Sparkplug edge-node session: connect and back-off, host state, paced births, the
 * single publish path, and the helpers every other file shares.
 */
#include <string.h>

#include "internal.h"

#define BACKOFF_FIRST_MS 1000u
#define BACKOFF_CAP_MS 300000u
#define SHORT_SESSION_MS 10000u
#define TAKEOVER_WINDOW_MS 300000u
#define CLOCK_REPORT_EVERY_MS 60000u
#define LOG_LINE 192

/* Helpers */

void iotos__lock(iotos_gateway *gw)
{
    if (gw->lock.lock) {
        gw->lock.lock(gw->lock.ctx);
    }
}

void iotos__unlock(iotos_gateway *gw)
{
    if (gw->lock.unlock) {
        gw->lock.unlock(gw->lock.ctx);
    }
}

uint32_t iotos__mono(const iotos_gateway *gw)
{
    return gw->clock.monotonic_ms();
}

uint64_t iotos__now(const iotos_gateway *gw, bool *valid)
{
    bool ok = false;
    uint64_t now = gw->clock.now_ms(gw->clock.ctx, &ok);
    *valid = ok;
    return now;
}

bool iotos__due(uint32_t now, uint32_t at)
{
    return (uint32_t)(now - at) < 0x80000000u;
}

void iotos__event(iotos_gateway *gw, iotos_event event, iotos_status detail)
{
    if (event == IOTOS_EVENT_COMMAND_REJECTED) {
        /* Repeats merge, and rejections leave room for state changes: one command
         * with many bad metrics must not crowd out DISCONNECTED or ONLINE. */
        if (gw->event_count && gw->events[gw->event_count - 1].event == (uint8_t)event
            && gw->events[gw->event_count - 1].detail == (int8_t)detail) {
            return;
        }
        if (gw->event_count >= IOTOS__EVENT_QUEUE - 3) {
            return;
        }
    }
    if (gw->event_count >= IOTOS__EVENT_QUEUE) {
        return; /* the oldest events are the most useful; later ones are in the log */
    }
    gw->events[gw->event_count].event = (uint8_t)event;
    gw->events[gw->event_count].detail = (int8_t)detail;
    gw->event_count++;
}

void iotos__flush_events(iotos_gateway *gw)
{
    for (;;) {
        iotos_event event;
        iotos_status detail;
        iotos__lock(gw);
        if (!gw->event_count) {
            iotos__unlock(gw);
            return;
        }
        event = (iotos_event)gw->events[0].event;
        detail = (iotos_status)gw->events[0].detail;
        gw->event_count--;
        memmove(&gw->events[0], &gw->events[1], gw->event_count * sizeof(gw->events[0]));
        iotos__unlock(gw);
        if (gw->callbacks.on_event) {
            gw->callbacks.on_event(gw->callbacks.ctx, event, detail);
        }
    }
}

static size_t append(char *out, size_t used, size_t size, const char *text)
{
    while (text && *text && used + 1 < size) {
        out[used++] = *text++;
    }
    out[used] = '\0';
    return used;
}

void iotos__log(iotos_gateway *gw, iotos_log_level level, const char *a, const char *b,
                const char *c, const char *d)
{
    char line[LOG_LINE];
    size_t used = 0;
    if (!gw->log.write) {
        return;
    }
    line[0] = '\0';
    used = append(line, used, sizeof(line), a);
    used = append(line, used, sizeof(line), b);
    used = append(line, used, sizeof(line), c);
    (void)append(line, used, sizeof(line), d);
    gw->log.write(gw->log.ctx, level, line);
}

static uint32_t next_random(iotos_gateway *gw)
{
    uint32_t x = gw->random ? gw->random : 0x9e3779b9u;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    gw->random = x;
    return x;
}

/* Topics */

bool iotos__topic(iotos_gateway *gw, const char *kind, const char *device)
{
    const iotos_settings *s = gw->settings;
    size_t used = 0;
    const char *parts[8];
    size_t count = 0;
    if (strcmp(kind, "STATE") == 0) {
        parts[count++] = "spBv1.0/STATE/";
        parts[count++] = s->host_id;
    } else {
        parts[count++] = "spBv1.0/";
        parts[count++] = s->group_id;
        parts[count++] = "/";
        parts[count++] = kind;
        parts[count++] = "/";
        parts[count++] = s->edge_node_id;
        if (device) {
            parts[count++] = "/";
            parts[count++] = device;
        }
    }
    for (size_t i = 0; i < count; i++) {
        size_t length = strlen(parts[i]);
        if (length >= sizeof(gw->topic) - used) {
            return false;
        }
        memcpy(gw->topic + used, parts[i], length);
        used += length;
    }
    gw->topic[used] = '\0';
    return true;
}

/* Publishing */

bool iotos__can_publish(const iotos_gateway *gw)
{
    return gw->connected && gw->host_online;
}

uint8_t iotos__next_seq(const iotos_gateway *gw)
{
    return (uint8_t)(gw->seq + 1u);
}

iotos_status iotos__publish(iotos_gateway *gw, const uint8_t *data, size_t length)
{
    iotos_status status;
    if (!gw->connected) {
        return IOTOS_E_OFFLINE;
    }
    if (gw->use_stream) {
        status = iotos__stream_publish(gw, gw->topic, data, length);
    } else {
        if (gw->mqtt.max_payload && length > gw->mqtt.max_payload) {
            return IOTOS_E_TOO_LARGE;
        }
        status = gw->mqtt.publish(gw->mqtt.ctx, gw->topic, data, length, 0, false);
        if (status == IOTOS_E_TOO_LARGE || status == IOTOS_E_INVALID) {
            return status;
        }
    }
    if (status != IOTOS_OK) {
        iotos__connection_lost(gw, IOTOS_E_TRANSPORT);
        return IOTOS_E_TRANSPORT;
    }
    return IOTOS_OK;
}

/* Connecting */

static void schedule_retry(iotos_gateway *gw)
{
    uint32_t delay = gw->backoff_ms;
    /* +/-20% jitter, so gateways that lost the broker together do not return together. */
    uint32_t spread = delay / 5u;
    if (spread) {
        delay = delay - spread + next_random(gw) % (2u * spread + 1u);
    }
    gw->next_attempt_ms = iotos__mono(gw) + delay;
    gw->backoff_ms = gw->backoff_ms >= BACKOFF_CAP_MS / 2u ? BACKOFF_CAP_MS : gw->backoff_ms * 2u;
}

static void forget_session(iotos_gateway *gw)
{
    gw->connected = false;
    gw->host_online = false;
    gw->node_born = false;
    gw->node_birth_pending = false;
    gw->clock_waiting = false;
    gw->state = STATE_DISCONNECTED;
}

void iotos__connection_lost(iotos_gateway *gw, iotos_status why)
{
    uint32_t now;
    if (!gw->connected) {
        return;
    }
    now = iotos__mono(gw);
    if (gw->use_stream) {
        iotos__stream_close(gw, false);
    } else {
        gw->mqtt.disconnect(gw->mqtt.ctx);
    }
    forget_session(gw);
    iotos__event(gw, IOTOS_EVENT_DISCONNECTED, why);
    iotos__log(gw, IOTOS_LOG_WARN, "The broker connection was lost.", NULL, NULL, NULL);

    if ((uint32_t)(now - gw->connected_at_ms) < SHORT_SESSION_MS) {
        /* Closed straight after connecting. Three times in five minutes means another
         * client is using these credentials and the broker keeps replacing us. */
        if (gw->short_close_count == 3u) {
            gw->short_closes[0] = gw->short_closes[1];
            gw->short_closes[1] = gw->short_closes[2];
            gw->short_close_count = 2u;
        }
        gw->short_closes[gw->short_close_count++] = now;
        if (gw->short_close_count == 3u && (uint32_t)(now - gw->short_closes[0]) <= TAKEOVER_WINDOW_MS) {
            gw->short_close_count = 0;
            iotos__event(gw, IOTOS_EVENT_SESSION_TAKEOVER, IOTOS_E_TRANSPORT);
            iotos__log(gw, IOTOS_LOG_ERROR, "The broker keeps closing new connections. ",
                       "Another client may be using this gateway's credentials.", NULL, NULL);
        }
    } else {
        gw->backoff_ms = BACKOFF_FIRST_MS;
    }
    schedule_retry(gw);
}

static iotos_status encode_will(iotos_gateway *gw, size_t *length)
{
    iotos__pb pb;
    iotos__metric bd;
    bool valid;
    uint64_t now = iotos__now(gw, &valid);
    iotos__pb_init(&pb, gw->tx, sizeof(gw->tx));
    memset(&bd, 0, sizeof(bd));
    bd.name = BDSEQ_METRIC;
    bd.has_timestamp = valid;
    bd.timestamp = now;
    bd.has_datatype = true;
    bd.datatype = IOTOS_INT64;
    bd.value.integer = gw->bd_seq;
    if (valid && iotos__pb_timestamp(&pb, now) != IOTOS_OK) {
        return IOTOS_E_TOO_LARGE;
    }
    if (iotos__pb_metric(&pb, &bd) != IOTOS_OK) {
        return IOTOS_E_TOO_LARGE;
    }
    *length = pb.length;
    return IOTOS_OK;
}

static iotos_status subscribe(iotos_gateway *gw, const char *kind, const char *device)
{
    if (!iotos__topic(gw, kind, device)) {
        return IOTOS_E_INVALID;
    }
    return gw->use_stream ? iotos__stream_subscribe(gw, gw->topic)
                          : gw->mqtt.subscribe(gw->mqtt.ctx, gw->topic, 0);
}

static void connect_now(iotos_gateway *gw)
{
    size_t will_length = 0;
    iotos_status status;
    uint8_t stored;

    /* A new bdSeq for every connection, saved first so a reboot never reuses it. */
    gw->bd_seq = (uint8_t)(gw->bd_seq + 1u);
    stored = gw->bd_seq;
    if (gw->storage.save && !gw->storage.save(gw->storage.ctx, BDSEQ_KEY, &stored, 1)) {
        iotos__log(gw, IOTOS_LOG_WARN, "Could not save bdSeq.", NULL, NULL, NULL);
    }
    if (encode_will(gw, &will_length) != IOTOS_OK || !iotos__topic(gw, "NDEATH", NULL)) {
        status = IOTOS_E_INVALID;
    } else if (gw->use_stream) {
        status = iotos__stream_connect(gw, gw->topic, gw->tx, will_length);
    } else {
        iotos_mqtt_connect opts;
        const iotos_settings *s = gw->settings;
        memset(&opts, 0, sizeof(opts));
        opts.host = s->broker_host;
        opts.port = s->broker_port;
        opts.ca_pem = s->ca_pem;
        opts.client_id = s->username;
        opts.username = s->username;
        opts.password = s->password;
        opts.keepalive_s = IOTOS_KEEPALIVE_S;
        opts.clean_session = true;
        opts.will_topic = gw->topic;
        opts.will_payload = gw->tx;
        opts.will_length = will_length;
        opts.will_qos = 1;
        opts.will_retain = false;
        opts.timeout_ms = IOTOS_CONNECT_TIMEOUT_MS;
        status = gw->mqtt.connect(gw->mqtt.ctx, &opts);
    }

    if (status != IOTOS_OK) {
        bool auth = status == IOTOS_E_AUTH;
        iotos__event(gw, auth ? IOTOS_EVENT_AUTH_FAILED : IOTOS_EVENT_CONNECT_FAILED,
                     auth ? IOTOS_E_AUTH : IOTOS_E_TRANSPORT);
        iotos__log(gw, IOTOS_LOG_WARN,
                   auth ? "The broker refused the gateway's credentials."
                        : "Could not connect to the broker.",
                   NULL, NULL, NULL);
        schedule_retry(gw);
        return;
    }

    gw->connected = true;
    gw->connected_at_ms = iotos__mono(gw);
    gw->state = STATE_WAITING_FOR_HOST;
    gw->connects++;
    if (gw->connects > 1u) {
        gw->reconnects++;
    }
    if (subscribe(gw, "NCMD", NULL) != IOTOS_OK || subscribe(gw, "DCMD", "+") != IOTOS_OK
        || subscribe(gw, "STATE", NULL) != IOTOS_OK) {
        iotos__connection_lost(gw, IOTOS_E_TRANSPORT);
        return;
    }
    iotos__event(gw, IOTOS_EVENT_CONNECTED, IOTOS_OK);
    iotos__log(gw, IOTOS_LOG_INFO, "Connected; waiting for the host application.", NULL, NULL, NULL);
}

/* Births */

void iotos__start_births(iotos_gateway *gw)
{
    gw->node_birth_pending = true;
    gw->node_born = false;
    iotos__queue_births(gw);
    gw->state = STATE_BIRTHING;
    gw->next_birth_ms = iotos__mono(gw);
}

static int32_t next_pending(iotos_gateway *gw)
{
    for (uint32_t step = 0; step < IOTOS_MAX_DEVICES; step++) {
        uint32_t slot = (gw->birth_cursor + step) % IOTOS_MAX_DEVICES;
        if (gw->devices[slot].state == SLOT_BIRTH_PENDING) {
            return (int32_t)slot;
        }
    }
    return -1;
}

static void clock_wait(iotos_gateway *gw, uint32_t now)
{
    if (!gw->clock_waiting) {
        gw->clock_waiting = true;
        gw->clock_wait_since_ms = now;
        gw->clock_next_report_ms = now + IOTOS_CLOCK_WAIT_S * 1000u;
    }
    if (iotos__due(now, gw->clock_next_report_ms)) {
        gw->clock_next_report_ms = now + CLOCK_REPORT_EVERY_MS;
        iotos__event(gw, IOTOS_EVENT_CLOCK_INVALID, IOTOS_E_CLOCK);
        iotos__log(gw, IOTOS_LOG_WARN, "Births are waiting for a valid clock. ",
                   "Check the time source (SNTP or network time).", NULL, NULL);
    }
}

static void birth_failed(iotos_gateway *gw, const iotos_device_type *type, iotos_status status)
{
    iotos__event(gw, IOTOS_EVENT_BIRTH_FAILED, status);
    if (status == IOTOS_E_TOO_LARGE) {
        iotos__log(gw, IOTOS_LOG_ERROR, "A birth of device type ", type ? type->code : "(none)",
                   " does not fit the transmit buffer or the transport. ",
                   "Raise IOTOS_TX_BUFFER or split the profile.");
    } else {
        iotos__log(gw, IOTOS_LOG_ERROR, "A birth of device type ", type ? type->code : "(none)",
                   " was refused: ", iotos_status_text(status));
    }
}

void iotos__send_births(iotos_gateway *gw, uint32_t deadline)
{
    const uint32_t interval = IOTOS_BIRTHS_PER_SECOND >= 1000 ? 1u : 1000u / IOTOS_BIRTHS_PER_SECOND;
    if (gw->writer.open) {
        return; /* single-task misuse: a writer is open across iotos_poll */
    }
    while (gw->connected && gw->host_online && (gw->node_birth_pending || gw->node_born)) {
        uint32_t now = iotos__mono(gw);
        int32_t slot = NODE_SLOT;
        iotos_status status;
        bool valid;
        if (!gw->node_birth_pending) {
            slot = next_pending(gw);
            if (slot < 0) {
                /* Idle: keep the pacing timer current, so a birth after weeks online
                 * goes at once instead of the timer looking 2^31 ms in the future. */
                gw->state = STATE_ONLINE;
                gw->next_birth_ms = now;
                return;
            }
        }
        if (!iotos__due(now, gw->next_birth_ms)) {
            return;
        }
        if (slot != NODE_SLOT) {
            gw->birth_cursor = (uint16_t)slot; /* the scan resumes here */
        }
        (void)iotos__now(gw, &valid);
        if (!valid) {
            clock_wait(gw, now);
            return;
        }
        gw->clock_waiting = false;

        status = iotos__write_birth(gw, slot);
        if (status == IOTOS_E_TRANSPORT || status == IOTOS_E_OFFLINE || status == IOTOS_E_CLOCK) {
            return; /* lost the connection, or the clock went invalid: retried later */
        }
        if (slot == NODE_SLOT) {
            gw->node_birth_pending = false;
            if (status == IOTOS_OK) {
                gw->node_born = true;
                gw->next_health_ms = now + IOTOS_HEALTH_INTERVAL_S * 1000u;
                iotos__event(gw, IOTOS_EVENT_ONLINE, IOTOS_OK);
            } else {
                birth_failed(gw, gw->settings->node_type, status);
            }
        } else if (status == IOTOS_OK) {
            gw->devices[slot].state = SLOT_BORN;
        } else {
            /* Too large, or refused by the port: never born, so no death. Its next
             * commit queues it again; the others carry on. */
            gw->devices[slot].state = SLOT_OFFLINE;
            birth_failed(gw, iotos__slot_type(gw, slot), status);
        }
        gw->next_birth_ms += interval;
        if (iotos__due(now, gw->next_birth_ms + 1000u)) {
            gw->next_birth_ms = now + interval; /* fell behind: no catch-up burst */
        }
        if (iotos__due(iotos__mono(gw), deadline)) {
            return;
        }
    }
}

/* Lifecycle */

static bool topic_safe(const char *id)
{
    if (!id || !*id) {
        return false;
    }
    for (; *id; id++) {
        if (*id == '/' || *id == '+' || *id == '#') {
            return false;
        }
    }
    return true;
}

iotos_status iotos_init(iotos_gateway *gw, const iotos_settings *settings, const iotos_ports *ports,
                        const iotos_callbacks *callbacks)
{
    size_t longest;
    uint8_t stored = 0;
    if (!gw || !settings || !ports) {
        return IOTOS_E_INVALID;
    }
    memset(gw, 0, sizeof(*gw));
    if (!topic_safe(settings->group_id) || !topic_safe(settings->edge_node_id) || !topic_safe(settings->host_id)
        || !settings->broker_host || !*settings->broker_host || !settings->username || !*settings->username
        || !settings->password || strlen(settings->username) > UINT16_MAX || strlen(settings->password) > UINT16_MAX) {
        return IOTOS_E_INVALID;
    }
    longest = strlen("spBv1.0//DBIRTH//") + strlen(settings->group_id) + strlen(settings->edge_node_id)
              + IOTOS_DEVICE_ID_MAX;
    if (longest >= IOTOS_TOPIC_MAX || strlen("spBv1.0/STATE/") + strlen(settings->host_id) >= IOTOS_TOPIC_MAX) {
        return IOTOS_E_INVALID;
    }
    if (settings->node_type && iotos__check_type(settings->node_type) != IOTOS_OK) {
        return IOTOS_E_INVALID;
    }
    if ((ports->stream == NULL) == (ports->mqtt == NULL) || !ports->clock || !ports->clock->now_ms
        || !ports->clock->monotonic_ms) {
        return IOTOS_E_INVALID;
    }
    if (ports->stream) {
        if (!ports->stream->connect || !ports->stream->send || !ports->stream->recv || !ports->stream->close) {
            return IOTOS_E_INVALID;
        }
        gw->stream = *ports->stream;
        gw->use_stream = true;
    } else {
        if (!ports->mqtt->connect || !ports->mqtt->publish || !ports->mqtt->subscribe || !ports->mqtt->poll
            || !ports->mqtt->disconnect) {
            return IOTOS_E_INVALID;
        }
        gw->mqtt = *ports->mqtt;
    }
    gw->clock = *ports->clock;
    if (ports->storage && ports->storage->load && ports->storage->save) {
        gw->storage = *ports->storage;
    }
    if (ports->log && ports->log->write) {
        gw->log = *ports->log;
    }
    if (ports->lock && ports->lock->lock && ports->lock->unlock) {
        gw->lock = *ports->lock;
    }
    if (callbacks) {
        gw->callbacks = *callbacks;
    }
    gw->settings = settings;
    gw->state = STATE_STOPPED;
    gw->backoff_ms = BACKOFF_FIRST_MS;
    if (gw->storage.load && gw->storage.load(gw->storage.ctx, BDSEQ_KEY, &stored, 1)) {
        gw->bd_seq = stored;
    }
    return IOTOS_OK;
}

iotos_status iotos_start(iotos_gateway *gw)
{
    bool valid;
    if (!gw || !gw->settings) {
        return IOTOS_E_INVALID;
    }
    iotos__lock(gw);
    if (!gw->started) {
        uint32_t now = iotos__mono(gw);
        gw->started = true;
        gw->state = STATE_DISCONNECTED;
        gw->backoff_ms = BACKOFF_FIRST_MS;
        gw->next_attempt_ms = now;
        gw->last_ms = now;
        gw->uptime_ms = 0;
        gw->connects = 0;
        gw->reconnects = 0;
        gw->random = now ^ ((uint32_t)iotos__now(gw, &valid) * 2654435761u) ^ gw->bd_seq;
    }
    iotos__unlock(gw);
    return IOTOS_OK;
}

iotos_status iotos_poll(iotos_gateway *gw, uint32_t budget_ms)
{
    uint32_t now, deadline;
    if (!gw || !gw->settings) {
        return IOTOS_E_INVALID;
    }
    iotos__lock(gw);
    gw->polling = true;
    now = iotos__mono(gw);
    deadline = now + budget_ms;
    gw->uptime_ms += (uint32_t)(now - gw->last_ms);
    gw->last_ms = now;
    if (gw->started) {
        if (!gw->connected && iotos__due(now, gw->next_attempt_ms)) {
            connect_now(gw);
        }
        if (gw->connected) {
            iotos_status status = gw->use_stream ? iotos__stream_poll(gw, deadline)
                                                 : gw->mqtt.poll(gw->mqtt.ctx, budget_ms);
            if (status != IOTOS_OK) {
                iotos__connection_lost(gw, IOTOS_E_TRANSPORT);
            }
        }
        iotos__send_births(gw, deadline);
        iotos__health_tick(gw);
    }
    gw->polling = false;
    iotos__unlock(gw);
    iotos__flush_events(gw);
    return IOTOS_OK;
}

iotos_status iotos_stop(iotos_gateway *gw)
{
    if (!gw || !gw->settings) {
        return IOTOS_E_INVALID;
    }
    iotos__lock(gw);
    if (gw->connected) {
        size_t length = 0;
        if (encode_will(gw, &length) == IOTOS_OK && iotos__topic(gw, "NDEATH", NULL)) {
            (void)iotos__publish(gw, gw->tx, length);
        }
        if (gw->connected) {
            if (gw->use_stream) {
                iotos__stream_close(gw, true);
            } else {
                gw->mqtt.disconnect(gw->mqtt.ctx);
            }
        }
    }
    forget_session(gw);
    gw->started = false;
    gw->state = STATE_STOPPED;
    iotos__unlock(gw);
    iotos__flush_events(gw);
    return IOTOS_OK;
}

const char *iotos_status_text(iotos_status status)
{
    switch (status) {
    case IOTOS_OK:
        return "OK";
    case IOTOS_PENDING_BIRTH:
        return "The device's birth is queued; its values go out with it";
    case IOTOS_E_INVALID:
        return "Invalid argument, unknown device or metric, wrong datatype or value out of range";
    case IOTOS_E_DUPLICATE:
        return "Already added";
    case IOTOS_E_FULL:
        return "A compile-time limit would be exceeded";
    case IOTOS_E_TOO_LARGE:
        return "The message is larger than the transmit buffer or the transport allows";
    case IOTOS_E_OFFLINE:
        return "Not connected, or the host application is offline";
    case IOTOS_E_CLOCK:
        return "The clock is not valid yet";
    case IOTOS_E_TRANSPORT:
        return "The network port reported an error";
    case IOTOS_E_AUTH:
        return "The broker refused the credentials";
    default:
        return "Unknown status";
    }
}
