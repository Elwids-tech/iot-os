/* SPDX-License-Identifier: MIT */
/* Profile "Energy meter" (energy-meter) revision 1. Metric order is the alias order; do not edit. */
#ifndef IOTOS_TYPE_ENERGY_METER_H
#define IOTOS_TYPE_ENERGY_METER_H

#include "iotos/iotos.h"

static const iotos_metric_def iotos_type_energy_meter_metrics[] = {
    {"power", IOTOS_DOUBLE, "W", false},
    {"energy", IOTOS_DOUBLE, "kWh", false},
    {"pulses", IOTOS_INT64, NULL, false},
    {"relay_on", IOTOS_BOOLEAN, NULL, true}, /* accepts commands */
};
static const iotos_device_type iotos_type_energy_meter = {
    "energy_meter", 1, iotos_type_energy_meter_metrics, 4
};

#endif
