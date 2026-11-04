/* SPDX-License-Identifier: MIT */
/* Hand-written sample in the shape a starter generates in generated/. Only these
 * declarations are shared: the SDK matches device types by address, so use
 * iotos_kit_types[] and iotos_kit_node_type, never a type header's own copy. */
#ifndef IOTOS_KIT_TYPES_H
#define IOTOS_KIT_TYPES_H

#include "iotos/iotos.h"

#define IOTOS_KIT_ROLE_GATEWAY 1 /* 0 in a direct-device starter */
#define IOTOS_KIT_TYPE_COUNT 2

/* The node's own metrics: the gateway health table here, a direct device's profile otherwise. */
extern const iotos_device_type iotos_kit_node_type;
/* The downstream device types. A direct device has none, and the array then holds a
 * single NULL, which keeps it valid C99. */
extern const iotos_device_type *const iotos_kit_types[2];

#endif
