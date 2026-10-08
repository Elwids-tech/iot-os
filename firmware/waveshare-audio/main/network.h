#pragma once
#include <stdbool.h>
#include <stddef.h>
void wave_network_start(void);
bool wave_network_ready(void);
void wave_network_report(const char *json);
bool wave_network_command(char *json, size_t capacity);
const char *wave_network_state(void);
int wave_network_disconnect_reason(void);
