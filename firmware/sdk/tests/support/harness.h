/* SPDX-License-Identifier: MIT */
/* A gateway on the fake level 2 port with sample types and recorded callbacks. */
#ifndef IOTOS_TEST_HARNESS_H
#define IOTOS_TEST_HARNESS_H

#include "fakes.h"

extern const iotos_device_type health_type; /* the eight health metrics */
extern const iotos_device_type meter_type;  /* flow_rate, total_volume, valve_open (writable) */
extern const iotos_device_type light_type;  /* on, Brightness (Int32), mode (String), scale (Double) writable; label read-only */

typedef struct {
    iotos_event event;
    iotos_status detail;
} recorded_event;

typedef struct {
    char device[IOTOS_DEVICE_ID_MAX + 1];
    bool node;
    char metric[64];
    iotos_value value;
    char text[IOTOS_COMMAND_STRING_MAX + 1];
} recorded_command;

typedef struct harness {
    iotos_gateway gw;
    fake_mqtt mqtt;
    iotos_mqtt_port mqtt_port;
    fake_stream stream;
    iotos_stream_port stream_port;
    iotos_ports ports;
    iotos_callbacks callbacks;
    iotos_settings settings;
    recorded_event events[64];
    size_t event_count;
    recorded_command commands[16];
    size_t command_count;
    size_t birth_calls;
    bool publish_on_command; /* confirm commands by publishing the new state from on_command */
    bool stop_on_command;    /* call iotos_stop from on_command, like a reboot command */
    iotos_status command_publish_result;
    void (*on_event_extra)(struct harness *h, iotos_event event);
    double meter_flow; /* what on_birth writes for meters */
} harness;

/* stream false: the fake level 2 port; true: the scripted broker behind a level 1 port. */
void harness_init(harness *h, bool stream);
void harness_free(harness *h);
/* Starts, connects and brings the host online, then polls until the node and every
 * device are born. */
void harness_online(harness *h);
/* Polls with the clock advancing step_ms each time. */
void harness_poll(harness *h, int times, uint32_t step_ms);
bool harness_has_event(const harness *h, iotos_event event);
size_t harness_count_events(const harness *h, iotos_event event);
fake_messages *harness_published(harness *h);
void harness_state(harness *h, bool online);
void harness_inject(harness *h, const char *topic, const uint8_t *data, size_t length, bool retained);

#endif
