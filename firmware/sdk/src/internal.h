/* SPDX-License-Identifier: MIT */
/* Shared between the SDK's source files; not part of the API. */
#ifndef IOTOS_INTERNAL_H
#define IOTOS_INTERNAL_H

#include "codec.h"
#include "iotos/iotos.h"

enum { SLOT_FREE, SLOT_OFFLINE, SLOT_BIRTH_PENDING, SLOT_BORN };
enum { STATE_STOPPED, STATE_DISCONNECTED, STATE_WAITING_FOR_HOST, STATE_BIRTHING, STATE_ONLINE };

#define NODE_SLOT (-1)
#define REBIRTH_METRIC "Node Control/Rebirth"
#define BDSEQ_METRIC "bdSeq"
#define BDSEQ_KEY "bdseq"
/* Room kept free in the transmit buffer for the seq field. */
#define SEQ_RESERVE 3u

void iotos__lock(iotos_gateway *gw);
void iotos__unlock(iotos_gateway *gw);
/* Events wait in a queue until the lock is released (iotos__flush_events). */
void iotos__event(iotos_gateway *gw, iotos_event event, iotos_status detail);
void iotos__flush_events(iotos_gateway *gw);
/* Logs the concatenation of up to four parts (NULLs are skipped). */
void iotos__log(iotos_gateway *gw, iotos_log_level level, const char *a, const char *b,
                const char *c, const char *d);
uint32_t iotos__mono(const iotos_gateway *gw);
uint64_t iotos__now(const iotos_gateway *gw, bool *valid);
bool iotos__due(uint32_t now, uint32_t at);

/* Topics, built into gw->topic. False if the result would not fit. */
bool iotos__topic(iotos_gateway *gw, const char *kind, const char *device);

/* The single path every message takes; the lock is held. Losing the connection here
 * starts the reconnect. */
iotos_status iotos__publish(iotos_gateway *gw, const uint8_t *data, size_t length);
bool iotos__can_publish(const iotos_gateway *gw);
void iotos__connection_lost(iotos_gateway *gw, iotos_status why);
uint8_t iotos__next_seq(const iotos_gateway *gw);

/* Devices */
int32_t iotos__find_device(const iotos_gateway *gw, const char *id, size_t length);
const iotos_device_type *iotos__slot_type(const iotos_gateway *gw, int32_t slot);
uint64_t iotos__alias(int32_t slot, uint16_t index);
int32_t iotos__find_metric(const iotos_device_type *type, const char *name, size_t length);
iotos_status iotos__send_death(iotos_gateway *gw, int32_t slot);
void iotos__queue_births(iotos_gateway *gw);
uint16_t iotos__devices_online(const iotos_gateway *gw);

/* Writer: open, add, send and close with the lock held. */
void iotos__writer_open(iotos_gateway *gw, int32_t slot, bool birth);
void iotos__writer_close(iotos_writer *w);
/* Adds a metric: index is its position in the writer's type, or -1 for one written by
 * name only (bdSeq, rebirth), whose name and datatype the caller sets. */
iotos_status iotos__writer_add(iotos_writer *w, int32_t index, iotos__metric *metric);
iotos_status iotos__writer_send(iotos_writer *w);
iotos_status iotos__write_birth(iotos_gateway *gw, int32_t slot);
iotos_status iotos__check_type(const iotos_device_type *type);

/* Births */
void iotos__send_births(iotos_gateway *gw, uint32_t deadline);
void iotos__start_births(iotos_gateway *gw);

/* Health */
void iotos__health_birth(iotos_writer *w);
void iotos__health_tick(iotos_gateway *gw);

/* Inbound: topic and payload as received. The lock is held. */
void iotos__inbound(iotos_gateway *gw, const char *topic, size_t topic_length, const uint8_t *data,
                    size_t length, bool retained);

/* MQTT over the byte-stream port (mqtt_stream.c). */
iotos_status iotos__stream_connect(iotos_gateway *gw, const char *will_topic, const uint8_t *will,
                                   size_t will_length);
iotos_status iotos__stream_subscribe(iotos_gateway *gw, const char *filter);
iotos_status iotos__stream_publish(iotos_gateway *gw, const char *topic, const uint8_t *data,
                                   size_t length);
iotos_status iotos__stream_poll(iotos_gateway *gw, uint32_t deadline);
void iotos__stream_close(iotos_gateway *gw, bool graceful);

#endif
