/* SPDX-License-Identifier: MIT */
/*
 * A gateway's RS-485 bus: a Modbus RTU poller on LPUART3 (the EVKB's Arduino header,
 * J22-1 RX and J22-2 TX, with LPUART3_RTS on J23-4 driving the transceiver's DE/RE). It
 * reads the same holding registers from every address in turn and keeps the last answer, so
 * field.c can return it without waiting on the bus.
 *
 * Register map, as tooling/hardware/modbus_simulator.py answers it:
 *   0  status (1 = healthy)
 *   1  reading, high word } a 32-bit counter, such as litres or watt-hours
 *   2  reading, low word  }
 *   3  temperature in tenths of a degree Celsius, signed
 *
 * The parts to change for a real bus are marked TODO(integrator).
 */
#ifndef MODBUS_RTU_H
#define MODBUS_RTU_H

#include <stdbool.h>
#include <stdint.h>

/* TODO(integrator): the bus's speed and the addresses on it. */
#ifndef APP_MODBUS_BAUD
#define APP_MODBUS_BAUD 9600
#endif
#ifndef APP_MODBUS_FIRST_ADDRESS
#define APP_MODBUS_FIRST_ADDRESS 1
#endif
#ifndef APP_MODBUS_LAST_ADDRESS
#define APP_MODBUS_LAST_ADDRESS 247
#endif
/* TODO(integrator): the registers each device answers, starting at APP_MODBUS_FIRST_REGISTER. */
#ifndef APP_MODBUS_FIRST_REGISTER
#define APP_MODBUS_FIRST_REGISTER 0
#endif
#ifndef APP_MODBUS_REGISTER_COUNT
#define APP_MODBUS_REGISTER_COUNT 4
#endif
/* A device whose last answer is older than this is treated as offline. */
#ifndef APP_MODBUS_STALE_MS
#define APP_MODBUS_STALE_MS 60000u
#endif

/* Sets up LPUART3 and starts the "rs485" task. 0, or -1 when the UART or the task could
 * not be created. */
int modbus_rtu_start(void);

/* The last value of register (APP_MODBUS_FIRST_REGISTER + index) from address. false
 * when the device has not answered within APP_MODBUS_STALE_MS. */
bool modbus_rtu_register(uint8_t address, uint16_t index, uint16_t *value);

#endif
