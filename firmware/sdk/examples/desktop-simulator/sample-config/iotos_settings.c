/* SPDX-License-Identifier: MIT */
#include "iotos_settings.h"

#include "iotos_type_gateway_health.h"

const iotos_settings iotos_kit_settings = {
    IOTOS_KIT_BROKER_HOST,  IOTOS_KIT_BROKER_PORT, IOTOS_KIT_GROUP_ID, IOTOS_KIT_EDGE_NODE_ID,
    IOTOS_KIT_HOST_ID,      IOTOS_KIT_USERNAME,    IOTOS_KIT_PASSWORD, IOTOS_KIT_CA_PEM,
    &iotos_type_gateway_health,
};
