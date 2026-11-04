/* Profile "Energy meter" (energy-meter) revision 1. Metric order is the alias order; do not edit. */
#ifndef IOTOS_TYPE_ENERGY_METER_H
#define IOTOS_TYPE_ENERGY_METER_H

#include "iotos/iotos.h"

static const iotos_metric_def iotos_type_energy_meter_metrics[] = {
    {"active_power", IOTOS_DOUBLE, "kW", false},
    {"energy_total", IOTOS_DOUBLE, "kWh", false},
    {"tariff", IOTOS_STRING, NULL, false},
    {"last_reset", IOTOS_DATETIME, NULL, false},
};
static const iotos_device_type iotos_type_energy_meter = {
    "energy-meter", 1, iotos_type_energy_meter_metrics, 4
};

#endif
