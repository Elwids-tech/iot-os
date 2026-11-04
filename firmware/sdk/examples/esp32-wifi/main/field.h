/* SPDX-License-Identifier: MIT */
/*
 * The field side's interface, for the simulator's sample tables. A starter generates this
 * file for its own profiles.
 */
#ifndef FIELD_H
#define FIELD_H

#include <stddef.h>

#include "iotos/iotos.h"

typedef enum {
    FIELD_OK = 0,          /* the value was read, or the command was applied */
    FIELD_UNAVAILABLE = 1, /* no value now: the metric is left out, and births send a null */
    FIELD_OFFLINE = 2,     /* the device did not answer */
    FIELD_REJECTED = 3     /* the command was not applied */
} field_status;

/* A device behind the gateway: its ID (at most IOTOS_DEVICE_ID_MAX characters, unique on
 * this gateway) and the code of its type in iotos_kit_types. */
typedef struct {
    const char *id;
    const char *type;
} field_device;

extern const field_device field_devices[];
extern const size_t field_device_count;

/* Called once before connecting: open buses and ports here. Returns 0 on success. */
int field_init(void);

/* Called by main.c for each metric. out->datatype is already set: fill the matching member
 * of out->as. type is a type's code, metric a metric's name, device_id NULL for the node. */
field_status field_read(const char *type, const char *metric, const char *device_id, iotos_value *out);

/* Called with a validated command. Apply it and return FIELD_OK: main.c then reads the
 * metric back with field_read and publishes it, which is how the platform confirms it. */
field_status field_command(const char *type, const char *metric, const char *device_id, const iotos_value *value);

/* water_meter, revision 1 */
field_status field_read_water_meter_flow_rate(const char *device_id, iotos_value *out);
field_status field_read_water_meter_total_volume(const char *device_id, iotos_value *out);
field_status field_read_water_meter_valve_open(const char *device_id, iotos_value *out);
field_status field_command_water_meter_valve_open(const char *device_id, const iotos_value *value);

/* energy_meter, revision 1 */
field_status field_read_energy_meter_power(const char *device_id, iotos_value *out);
field_status field_read_energy_meter_energy(const char *device_id, iotos_value *out);
field_status field_read_energy_meter_pulses(const char *device_id, iotos_value *out);
field_status field_read_energy_meter_relay_on(const char *device_id, iotos_value *out);
field_status field_command_energy_meter_relay_on(const char *device_id, const iotos_value *value);

#endif
