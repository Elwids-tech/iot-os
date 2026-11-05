/* SPDX-License-Identifier: MIT */
/*
 * Modbus RTU over RS-485 (modbus_rtu.h): read holding registers (function 3) from each
 * address in turn, one request at a time, with the transceiver's driver enabled by the
 * UART's RTS while it sends. It is built only into a gateway's program
 * (IOTOS_KIT_ROLE_GATEWAY in generated/iotos_types.h): a direct device has no bus to poll.
 */
#include "iotos_types.h"

#if IOTOS_KIT_ROLE_GATEWAY
#include <string.h>

#include "FreeRTOS.h"
#include "board.h"
#include "fsl_debug_console.h"
#include "fsl_lpuart_freertos.h"
#include "modbus_rtu.h"
#include "task.h"

#define BUS LPUART3
#define BUS_IRQ LPUART3_IRQn
#define READ_HOLDING_REGISTERS 3
#define ANSWER_TIMEOUT_MS 100 /* a device that has not started answering by then is absent */
#define TASK_STACK (1024 / sizeof(StackType_t))

void BOARD_InitRs485Pins(void); /* board/rs485_pins.c */

typedef struct {
    uint16_t registers[APP_MODBUS_REGISTER_COUNT];
    uint32_t answered_ms; /* tick of the last answer */
    bool answered;
} device_state;

static device_state devices[APP_MODBUS_LAST_ADDRESS + 1];
static lpuart_rtos_handle_t bus;
static lpuart_handle_t bus_handle;
static uint8_t ring[256];

static uint16_t crc16(const uint8_t *data, size_t length)
{
    uint16_t crc = 0xFFFF;
    for (size_t i = 0; i < length; i++) {
        crc ^= data[i];
        for (int bit = 0; bit < 8; bit++) {
            crc = (crc & 1u) ? (uint16_t)((crc >> 1) ^ 0xA001u) : (uint16_t)(crc >> 1);
        }
    }
    return crc;
}

/* Reads the registers of one address into out. true when it answered correctly. */
static bool read_registers(uint8_t address, uint16_t *out)
{
    uint8_t request[8] = {address, READ_HOLDING_REGISTERS, APP_MODBUS_FIRST_REGISTER >> 8,
                          APP_MODBUS_FIRST_REGISTER & 0xFF, 0, APP_MODBUS_REGISTER_COUNT, 0, 0};
    uint8_t answer[5 + 2 * APP_MODBUS_REGISTER_COUNT];
    uint16_t crc = crc16(request, 6);
    size_t received = 0;
    request[6] = (uint8_t)(crc & 0xFF);
    request[7] = (uint8_t)(crc >> 8);
    if (LPUART_RTOS_Send(&bus, request, sizeof(request)) != kStatus_Success) {
        return false;
    }
    if (LPUART_RTOS_Receive(&bus, answer, sizeof(answer), &received) != kStatus_Success || received != sizeof(answer)) {
        /* Nothing, or a partial frame: drop what arrived and let the bus fall silent. */
        vTaskDelay(pdMS_TO_TICKS(5));
        while (LPUART_RTOS_Receive(&bus, answer, 1, &received) == kStatus_Success && received) {
        }
        return false;
    }
    crc = crc16(answer, sizeof(answer) - 2);
    if (answer[0] != address || answer[1] != READ_HOLDING_REGISTERS || answer[2] != 2 * APP_MODBUS_REGISTER_COUNT
        || answer[sizeof(answer) - 2] != (crc & 0xFF) || answer[sizeof(answer) - 1] != (crc >> 8)) {
        return false; /* an exception answer (function | 0x80) also ends here */
    }
    for (int i = 0; i < APP_MODBUS_REGISTER_COUNT; i++) {
        out[i] = (uint16_t)((answer[3 + 2 * i] << 8) | answer[4 + 2 * i]);
    }
    return true;
}

static void poll_task(void *arg)
{
    (void)arg;
    for (;;) {
        for (unsigned address = APP_MODBUS_FIRST_ADDRESS; address <= APP_MODBUS_LAST_ADDRESS; address++) {
            uint16_t registers[APP_MODBUS_REGISTER_COUNT];
            /* TODO(integrator): skip addresses that have no device, or read other registers
             * per device type (field_devices in field.c says which address is which). */
            if (read_registers((uint8_t)address, registers)) {
                taskENTER_CRITICAL();
                memcpy(devices[address].registers, registers, sizeof(registers));
                devices[address].answered_ms = (uint32_t)xTaskGetTickCount();
                devices[address].answered = true;
                taskEXIT_CRITICAL();
            }
            vTaskDelay(pdMS_TO_TICKS(5)); /* the silence that ends a Modbus RTU frame */
        }
    }
}

bool modbus_rtu_register(uint8_t address, uint16_t index, uint16_t *value)
{
    bool fresh;
    if (address < APP_MODBUS_FIRST_ADDRESS || address > APP_MODBUS_LAST_ADDRESS || index >= APP_MODBUS_REGISTER_COUNT) {
        return false;
    }
    taskENTER_CRITICAL();
    fresh = devices[address].answered && (uint32_t)(xTaskGetTickCount() - devices[address].answered_ms) < pdMS_TO_TICKS(APP_MODBUS_STALE_MS);
    *value = devices[address].registers[index];
    taskEXIT_CRITICAL();
    return fresh;
}

int modbus_rtu_start(void)
{
    lpuart_rtos_config_t config = {
        .base = BUS,
        .srcclk = BOARD_DebugConsoleSrcFreq(),
        .baudrate = APP_MODBUS_BAUD,
        .parity = kLPUART_ParityDisabled,
        .stopbits = kLPUART_OneStopBit,
        .buffer = ring,
        .buffer_size = sizeof(ring),
        .rx_timeout_constant_ms = ANSWER_TIMEOUT_MS,
        .rx_timeout_multiplier_ms = 2,
        .tx_timeout_constant_ms = 100,
        .tx_timeout_multiplier_ms = 2,
    };
    BOARD_InitRs485Pins();
    NVIC_SetPriority(BUS_IRQ, configLIBRARY_MAX_SYSCALL_INTERRUPT_PRIORITY + 1);
    if (LPUART_RTOS_Init(&bus, &bus_handle, &config) != kStatus_Success) {
        return -1;
    }
    /* RTS drives DE/RE high while a request is sent, and low to listen.
     * TODO(integrator): a transceiver that switches direction by itself needs no RTS. */
    BUS->MODIR |= LPUART_MODIR_TXRTSE_MASK | LPUART_MODIR_TXRTSPOL_MASK;
    PRINTF("app: polling Modbus addresses %u-%u on RS-485 at %u baud\r\n", (unsigned)APP_MODBUS_FIRST_ADDRESS,
           (unsigned)APP_MODBUS_LAST_ADDRESS, (unsigned)APP_MODBUS_BAUD);
    return xTaskCreate(poll_task, "rs485", TASK_STACK, NULL, configMAX_PRIORITIES / 4, NULL) == pdPASS ? 0 : -1;
}

#endif
