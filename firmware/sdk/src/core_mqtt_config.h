/* SPDX-License-Identifier: MIT */
/* coreMQTT settings for the SDK. Logging stays off: the SDK reports through its own log port. */
#ifndef CORE_MQTT_CONFIG_H
#define CORE_MQTT_CONFIG_H

/* How long a CONNACK may trickle in once its first byte arrived. */
#define MQTT_RECV_POLLING_TIMEOUT_MS 1000U

#endif
