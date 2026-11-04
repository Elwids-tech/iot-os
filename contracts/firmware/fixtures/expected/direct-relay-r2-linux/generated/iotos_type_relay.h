/* Profile "Relay" (relay) revision 2. Metric order is the alias order; do not edit. */
#ifndef IOTOS_TYPE_RELAY_H
#define IOTOS_TYPE_RELAY_H

#include "iotos/iotos.h"

static const iotos_metric_def iotos_type_relay_metrics[] = {
    {"relay_state", IOTOS_BOOLEAN, NULL, true}, /* accepts commands */
    {"coil_current", IOTOS_DOUBLE, "mA", false},
    {"trip_count", IOTOS_INT64, NULL, false},
};
static const iotos_device_type iotos_type_relay = {
    "relay", 2, iotos_type_relay_metrics, 3
};

#endif
