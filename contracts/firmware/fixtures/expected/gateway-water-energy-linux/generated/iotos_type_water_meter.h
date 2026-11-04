/* Profile "Water meter" (water-meter) revision 1. Metric order is the alias order; do not edit. */
#ifndef IOTOS_TYPE_WATER_METER_H
#define IOTOS_TYPE_WATER_METER_H

#include "iotos/iotos.h"

static const iotos_metric_def iotos_type_water_meter_metrics[] = {
    {"flow_rate", IOTOS_DOUBLE, "L/min", false},
    {"total_volume", IOTOS_DOUBLE, "L", false},
    {"valve_open", IOTOS_BOOLEAN, NULL, true}, /* accepts commands */
    {"alarm_state", IOTOS_STRING, NULL, false},
};
static const iotos_device_type iotos_type_water_meter = {
    "water-meter", 1, iotos_type_water_meter_metrics, 4
};

#endif
