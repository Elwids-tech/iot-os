/* SPDX-License-Identifier: MIT */
/*
 * Compile-time limits. Override any of them with a compiler definition or before
 * including iotos.h. Every limit sizes iotos_gateway, which is the SDK's whole RAM use.
 * The library and the application must be built with the same values.
 */
#ifndef IOTOS_CONFIG_DEFAULTS_H
#define IOTOS_CONFIG_DEFAULTS_H

/* Downstream devices one gateway can hold. */
#ifndef IOTOS_MAX_DEVICES
#define IOTOS_MAX_DEVICES 512
#endif

/* Device types that can be registered, not counting the node's own type. */
#ifndef IOTOS_MAX_DEVICE_TYPES
#define IOTOS_MAX_DEVICE_TYPES 8
#endif

/* Metrics in one device type, including the node's own type. */
#ifndef IOTOS_MAX_METRICS_PER_TYPE
#define IOTOS_MAX_METRICS_PER_TYPE 64
#endif

/* Characters in a device ID, from [A-Za-z0-9_.:-]. */
#ifndef IOTOS_DEVICE_ID_MAX
#define IOTOS_DEVICE_ID_MAX 24
#endif

/* Largest message the SDK encodes, births included. */
#ifndef IOTOS_TX_BUFFER
#define IOTOS_TX_BUFFER 4096
#endif

/* Largest message the SDK receives; at the stream level, also the MQTT client's buffer. */
#ifndef IOTOS_RX_BUFFER
#define IOTOS_RX_BUFFER 1024
#endif

/* Longest topic, which bounds the group, edge node and host IDs. */
#ifndef IOTOS_TOPIC_MAX
#define IOTOS_TOPIC_MAX 192
#endif

/* Longest String value a command can carry; longer ones are rejected. */
#ifndef IOTOS_COMMAND_STRING_MAX
#define IOTOS_COMMAND_STRING_MAX 128
#endif

/* Births sent per second after a connect or a rebirth request. */
#ifndef IOTOS_BIRTHS_PER_SECOND
#define IOTOS_BIRTHS_PER_SECOND 20
#endif

/* MQTT keepalive. */
#ifndef IOTOS_KEEPALIVE_S
#define IOTOS_KEEPALIVE_S 20
#endif

/* How often the gateway's health metrics are published. */
#ifndef IOTOS_HEALTH_INTERVAL_S
#define IOTOS_HEALTH_INTERVAL_S 60
#endif

/* How long births wait for a valid clock before on_event reports IOTOS_E_CLOCK. */
#ifndef IOTOS_CLOCK_WAIT_S
#define IOTOS_CLOCK_WAIT_S 300
#endif

/* Longest a connection attempt (TLS handshake and CONNACK) may block iotos_poll. */
#ifndef IOTOS_CONNECT_TIMEOUT_MS
#define IOTOS_CONNECT_TIMEOUT_MS 10000
#endif

#endif
