/* SPDX-License-Identifier: MIT */
#include "iotos_types.h"

#include "iotos_type_energy_meter.h"
#include "iotos_type_gateway_health.h"
#include "iotos_type_water_meter.h"

const iotos_device_type iotos_kit_node_type = {"gateway_health", 1, iotos_type_gateway_health_metrics, 8};
const iotos_device_type *const iotos_kit_types[2] = {
    &iotos_type_water_meter,
    &iotos_type_energy_meter,
};
