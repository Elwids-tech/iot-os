/* SPDX-License-Identifier: MIT */
/*
 * What a starter's program needs from its connection settings. They come from
 * config/iotos_settings.c when the settings have been downloaded, and from
 * settings_missing.c until then, so a starter always builds.
 */
#ifndef IOTOS_STARTER_H
#define IOTOS_STARTER_H

#include "iotos/iotos.h"

/* node_type is NULL: the program copies the settings and points node_type at
 * iotos_kit_node_type from generated/iotos_types.c, because the node's metrics come
 * from a profile and the settings from a device. */
extern const iotos_settings iotos_kit_settings;

/* 0 until config/iotos_settings.c exists. The program then says where to get the
 * settings and stops without connecting. */
extern const int iotos_kit_settings_present;

#endif
