/* SPDX-License-Identifier: MIT */
/* The downstream device types. The node's own type is iotos_kit_settings.node_type. */
#ifndef IOTOS_KIT_TYPES_H
#define IOTOS_KIT_TYPES_H

#include "iotos_type_energy_meter.h"
#include "iotos_type_water_meter.h"

#define IOTOS_KIT_TYPE_COUNT 2
static const iotos_device_type *const iotos_kit_types[] = {
    &iotos_type_water_meter,
    &iotos_type_energy_meter,
};

#endif
