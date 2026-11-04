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

/* A direct device has no devices behind it: it publishes its own metrics. */
const field_device field_devices[] = {
    {NULL, NULL} /* end of the list */
};
const size_t field_device_count = sizeof(field_devices) / sizeof(field_devices[0]) - 1;

int field_init(void)
{
    return 0;
}

/* Relay (relay), revision 2: this device */

field_status field_read_relay_relay_state(const char *device_id, iotos_value *out)
{
    /* relay_state: Boolean, out->as.boolean. */
    (void)device_id;
    (void)out;
    return FIELD_UNAVAILABLE;
}

field_status field_command_relay_relay_state(const char *device_id, const iotos_value *value)
{
    /* relay_state: Boolean, value->as.boolean. Apply it, then return FIELD_OK. */
    (void)device_id;
    (void)value;
    return FIELD_REJECTED;
}

field_status field_read_relay_coil_current(const char *device_id, iotos_value *out)
{
    /* coil_current: Double in mA, out->as.number. */
    (void)device_id;
    (void)out;
    return FIELD_UNAVAILABLE;
}

field_status field_read_relay_trip_count(const char *device_id, iotos_value *out)
{
    /* trip_count: Int64, out->as.i64. */
    (void)device_id;
    (void)out;
    return FIELD_UNAVAILABLE;
}

/* main.c calls these two. */

field_status field_read(const char *type, const char *metric, const char *device_id, iotos_value *out)
{
    if (strcmp(type, "relay") == 0) {
        if (strcmp(metric, "relay_state") == 0) {
            return field_read_relay_relay_state(device_id, out);
        }
        if (strcmp(metric, "coil_current") == 0) {
            return field_read_relay_coil_current(device_id, out);
        }
        if (strcmp(metric, "trip_count") == 0) {
            return field_read_relay_trip_count(device_id, out);
        }
    }
    return FIELD_UNAVAILABLE;
}

field_status field_command(const char *type, const char *metric, const char *device_id, const iotos_value *value)
{
    if (strcmp(type, "relay") == 0) {
        if (strcmp(metric, "relay_state") == 0) {
            return field_command_relay_relay_state(device_id, value);
        }
    }
    return FIELD_REJECTED;
}
