/* SPDX-License-Identifier: MIT */
/*
 * The field side for the simulator's sample tables, as a starter generates it: every read
 * returns FIELD_UNAVAILABLE and every command FIELD_REJECTED, so nothing is published
 * until it is written from the device brief. Never return a value that was not read.
 */
#include "field.h"

#include <string.h>

/* The devices behind this gateway. Add each above the end marker, for example
 * {"wm-1", "water_meter"}. Types: water_meter, energy_meter. */
const field_device field_devices[] = {
    {NULL, NULL} /* end of the list */
};
const size_t field_device_count = sizeof(field_devices) / sizeof(field_devices[0]) - 1;

int field_init(void)
{
    return 0;
}

/* water_meter, revision 1 */

field_status field_read_water_meter_flow_rate(const char *device_id, iotos_value *out)
{
    /* flow_rate: Double, into out->as.number. */
    (void)device_id;
    (void)out;
    return FIELD_UNAVAILABLE;
}

field_status field_read_water_meter_total_volume(const char *device_id, iotos_value *out)
{
    /* total_volume: Double, into out->as.number. */
    (void)device_id;
    (void)out;
    return FIELD_UNAVAILABLE;
}

field_status field_read_water_meter_valve_open(const char *device_id, iotos_value *out)
{
    /* valve_open: Boolean, into out->as.boolean. */
    (void)device_id;
    (void)out;
    return FIELD_UNAVAILABLE;
}

field_status field_command_water_meter_valve_open(const char *device_id, const iotos_value *value)
{
    /* valve_open: Boolean, in value->as.boolean. */
    (void)device_id;
    (void)value;
    return FIELD_REJECTED;
}

/* energy_meter, revision 1 */

field_status field_read_energy_meter_power(const char *device_id, iotos_value *out)
{
    /* power: Double, into out->as.number. */
    (void)device_id;
    (void)out;
    return FIELD_UNAVAILABLE;
}

field_status field_read_energy_meter_energy(const char *device_id, iotos_value *out)
{
    /* energy: Double, into out->as.number. */
    (void)device_id;
    (void)out;
    return FIELD_UNAVAILABLE;
}

field_status field_read_energy_meter_pulses(const char *device_id, iotos_value *out)
{
    /* pulses: Int64, into out->as.i64. */
    (void)device_id;
    (void)out;
    return FIELD_UNAVAILABLE;
}

field_status field_read_energy_meter_relay_on(const char *device_id, iotos_value *out)
{
    /* relay_on: Boolean, into out->as.boolean. */
    (void)device_id;
    (void)out;
    return FIELD_UNAVAILABLE;
}

field_status field_command_energy_meter_relay_on(const char *device_id, const iotos_value *value)
{
    /* relay_on: Boolean, in value->as.boolean. */
    (void)device_id;
    (void)value;
    return FIELD_REJECTED;
}

/* main.c calls these two. */

field_status field_read(const char *type, const char *metric, const char *device_id, iotos_value *out)
{
    if (strcmp(type, "water_meter") == 0) {
        if (strcmp(metric, "flow_rate") == 0) {
            return field_read_water_meter_flow_rate(device_id, out);
        }
        if (strcmp(metric, "total_volume") == 0) {
            return field_read_water_meter_total_volume(device_id, out);
        }
        if (strcmp(metric, "valve_open") == 0) {
            return field_read_water_meter_valve_open(device_id, out);
        }
    }
    if (strcmp(type, "energy_meter") == 0) {
        if (strcmp(metric, "power") == 0) {
            return field_read_energy_meter_power(device_id, out);
        }
        if (strcmp(metric, "energy") == 0) {
            return field_read_energy_meter_energy(device_id, out);
        }
        if (strcmp(metric, "pulses") == 0) {
            return field_read_energy_meter_pulses(device_id, out);
        }
        if (strcmp(metric, "relay_on") == 0) {
            return field_read_energy_meter_relay_on(device_id, out);
        }
    }
    return FIELD_UNAVAILABLE;
}

field_status field_command(const char *type, const char *metric, const char *device_id, const iotos_value *value)
{
    if (strcmp(type, "water_meter") == 0) {
        if (strcmp(metric, "valve_open") == 0) {
            return field_command_water_meter_valve_open(device_id, value);
        }
    }
    if (strcmp(type, "energy_meter") == 0) {
        if (strcmp(metric, "relay_on") == 0) {
            return field_command_energy_meter_relay_on(device_id, value);
        }
    }
    return FIELD_REJECTED;
}
