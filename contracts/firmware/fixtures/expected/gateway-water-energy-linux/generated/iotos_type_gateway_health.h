/* The SDK's default gateway health table (iotos_health.h). Metric order is the alias order; do not edit. */
#ifndef IOTOS_TYPE_GATEWAY_HEALTH_H
#define IOTOS_TYPE_GATEWAY_HEALTH_H

#include "iotos/iotos.h"

static const iotos_metric_def iotos_type_gateway_health_metrics[] = {
    {"uptime", IOTOS_INT64, "s", false},
    {"connection_type", IOTOS_STRING, NULL, false},
    {"signal_strength", IOTOS_DOUBLE, "dBm", false},
    {"firmware_version", IOTOS_STRING, NULL, false},
    {"sdk_version", IOTOS_STRING, NULL, false},
    {"devices_configured", IOTOS_INT64, NULL, false},
    {"devices_online", IOTOS_INT64, NULL, false},
    {"reconnects", IOTOS_INT64, NULL, false},
};
static const iotos_device_type iotos_type_gateway_health = {
    "gateway-health", 1, iotos_type_gateway_health_metrics, 8
};

#endif
