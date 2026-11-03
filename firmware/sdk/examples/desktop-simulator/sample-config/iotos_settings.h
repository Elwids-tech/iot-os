/* SPDX-License-Identifier: MIT */
/* Hand-written sample in the shape a downloaded kit generates. A real kit's copy holds the
 * gateway's credentials: keep that one private and out of version control. */
#ifndef IOTOS_KIT_SETTINGS_H
#define IOTOS_KIT_SETTINGS_H

#include "iotos/iotos.h"

#define IOTOS_KIT_BROKER_HOST "mqtt.example.test"
#define IOTOS_KIT_BROKER_PORT 8883
#define IOTOS_KIT_GROUP_ID "example-group"
#define IOTOS_KIT_EDGE_NODE_ID "example-gateway"
#define IOTOS_KIT_HOST_ID "example-host"
#define IOTOS_KIT_USERNAME "edge-example" /* also the MQTT client ID */
#define IOTOS_KIT_PASSWORD "replace-with-the-kit-password"
#define IOTOS_KIT_CA_PEM                                                                                    \
    "-----BEGIN CERTIFICATE-----\n"                                                                         \
    "The kit puts the broker's CA certificate here.\n"                                                      \
    "-----END CERTIFICATE-----\n"
#define IOTOS_KIT_GATEWAY 1 /* 0 in a direct-device kit */

extern const iotos_settings iotos_kit_settings; /* defined in iotos_settings.c */

#endif
