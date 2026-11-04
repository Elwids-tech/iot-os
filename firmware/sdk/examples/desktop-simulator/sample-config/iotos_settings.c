/* SPDX-License-Identifier: MIT */
#include "iotos_settings.h"

/* The node type comes from iotos_types.c: the program copies these settings and sets it. */
const iotos_settings iotos_kit_settings = {
    IOTOS_KIT_BROKER_HOST, IOTOS_KIT_BROKER_PORT, IOTOS_KIT_GROUP_ID, IOTOS_KIT_EDGE_NODE_ID,
    IOTOS_KIT_HOST_ID,     IOTOS_KIT_USERNAME,    IOTOS_KIT_PASSWORD, IOTOS_KIT_CA_PEM,
    NULL,
};
const int iotos_kit_settings_present = 1;
