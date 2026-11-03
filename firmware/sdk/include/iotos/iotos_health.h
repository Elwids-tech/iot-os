/* SPDX-License-Identifier: MIT */
/*
 * The gateway health metrics. When the node type has a metric with one of these names,
 * the SDK fills it in every node birth and, for the changing ones, every
 * IOTOS_HEALTH_INTERVAL_S. The SDK owns metrics with these names.
 */
#ifndef IOTOS_HEALTH_H
#define IOTOS_HEALTH_H

#define IOTOS_HEALTH_UPTIME "uptime"                         /* integer, seconds since iotos_start */
#define IOTOS_HEALTH_CONNECTION_TYPE "connection_type"       /* ethernet, wifi, cellular or other */
#define IOTOS_HEALTH_SIGNAL_STRENGTH "signal_strength"       /* dBm, null when unknown */
#define IOTOS_HEALTH_FIRMWARE_VERSION "firmware_version"     /* from iotos_set_firmware_version */
#define IOTOS_HEALTH_SDK_VERSION "sdk_version"               /* this SDK's version */
#define IOTOS_HEALTH_DEVICES_CONFIGURED "devices_configured" /* devices added */
#define IOTOS_HEALTH_DEVICES_ONLINE "devices_online"         /* devices not marked offline */
#define IOTOS_HEALTH_RECONNECTS "reconnects"                 /* since iotos_start */

#endif
