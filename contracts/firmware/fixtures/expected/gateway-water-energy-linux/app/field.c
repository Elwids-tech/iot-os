/*
 * The field side: how each metric is read from the hardware and how each command is applied,
 * written from device-brief.yaml. Generated as stubs: every read returns FIELD_UNAVAILABLE
 * and every command FIELD_REJECTED, so nothing is published until it is implemented. Never
 * return a value that was not read from the device.
 *
 * Yours from now on: updates never replace it. A newer starter's field.c has the stubs for
 * metrics added since; copy the ones you need.
 */
#include "field.h"

#include <string.h>

/* The devices behind this gateway, from the device brief's addressing. Add each one above
 * the end marker, for example {"water-meter-1", "water-meter"}. Types: water-meter, energy-meter. */
const field_device field_devices[] = {
    {NULL, NULL} /* end of the list */
};
const size_t field_device_count = sizeof(field_devices) / sizeof(field_devices[0]) - 1;

int field_init(void)
{
    return 0;
}

/* Water meter (water-meter), revision 1: devices behind this gateway */

field_status field_read_water_meter_flow_rate(const char *device_id, iotos_value *out)
{
    /* flow_rate: Double in L/min, out->as.number. */
    (void)device_id;
    (void)out;
    return FIELD_UNAVAILABLE;
}

field_status field_read_water_meter_total_volume(const char *device_id, iotos_value *out)
{
    /* total_volume: Double in L, out->as.number. */
    (void)device_id;
    (void)out;
    return FIELD_UNAVAILABLE;
}

field_status field_read_water_meter_valve_open(const char *device_id, iotos_value *out)
{
    /* valve_open: Boolean, out->as.boolean. */
    (void)device_id;
    (void)out;
    return FIELD_UNAVAILABLE;
}

field_status field_command_water_meter_valve_open(const char *device_id, const iotos_value *value)
{
    /* valve_open: Boolean, value->as.boolean. Apply it, then return FIELD_OK. */
    (void)device_id;
    (void)value;
    return FIELD_REJECTED;
}

field_status field_read_water_meter_alarm_state(const char *device_id, iotos_value *out)
{
    /* alarm_state: String, out->as.string. One of: ok, leak, fault. */
    (void)device_id;
    (void)out;
    return FIELD_UNAVAILABLE;
}

/* Energy meter (energy-meter), revision 1: devices behind this gateway */

field_status field_read_energy_meter_active_power(const char *device_id, iotos_value *out)
{
    /* active_power: Double in kW, out->as.number. */
    (void)device_id;
    (void)out;
    return FIELD_UNAVAILABLE;
}

field_status field_read_energy_meter_energy_total(const char *device_id, iotos_value *out)
{
    /* energy_total: Double in kWh, out->as.number. */
    (void)device_id;
    (void)out;
    return FIELD_UNAVAILABLE;
}

field_status field_read_energy_meter_tariff(const char *device_id, iotos_value *out)
{
    /* tariff: String, out->as.string. */
    (void)device_id;
    (void)out;
    return FIELD_UNAVAILABLE;
}

field_status field_read_energy_meter_last_reset(const char *device_id, iotos_value *out)
{
    /* last_reset: DateTime, out->as.utc_ms. */
    (void)device_id;
    (void)out;
    return FIELD_UNAVAILABLE;
}

/* main.c calls these two. */

field_status field_read(const char *type, const char *metric, const char *device_id, iotos_value *out)
{
    if (strcmp(type, "water-meter") == 0) {
        if (strcmp(metric, "flow_rate") == 0) {
            return field_read_water_meter_flow_rate(device_id, out);
        }
        if (strcmp(metric, "total_volume") == 0) {
            return field_read_water_meter_total_volume(device_id, out);
        }
        if (strcmp(metric, "valve_open") == 0) {
            return field_read_water_meter_valve_open(device_id, out);
        }
        if (strcmp(metric, "alarm_state") == 0) {
            return field_read_water_meter_alarm_state(device_id, out);
        }
    }
    if (strcmp(type, "energy-meter") == 0) {
        if (strcmp(metric, "active_power") == 0) {
            return field_read_energy_meter_active_power(device_id, out);
        }
        if (strcmp(metric, "energy_total") == 0) {
            return field_read_energy_meter_energy_total(device_id, out);
        }
        if (strcmp(metric, "tariff") == 0) {
            return field_read_energy_meter_tariff(device_id, out);
        }
        if (strcmp(metric, "last_reset") == 0) {
            return field_read_energy_meter_last_reset(device_id, out);
        }
    }
    return FIELD_UNAVAILABLE;
}

field_status field_command(const char *type, const char *metric, const char *device_id, const iotos_value *value)
{
    if (strcmp(type, "water-meter") == 0) {
        if (strcmp(metric, "valve_open") == 0) {
            return field_command_water_meter_valve_open(device_id, value);
        }
    }
    return FIELD_REJECTED;
}
