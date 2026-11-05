/* SPDX-License-Identifier: MIT */
/*
 * LPUART3 for the RS-485 bus on the EVKB: TX on GPIO_AD_B1_06 (Arduino J22-2), RX on
 * GPIO_AD_B1_07 (J22-1) and RTS on GPIO_AD_B1_05 (J23-4), which drives the transceiver's
 * DE/RE. The three pads are shared with the camera connector (J35), so leave it empty.
 * The pad settings match the debug console's in pin_mux.c. Change this file, not
 * pin_mux.c, for another board or header.
 */
#include "fsl_common.h"
#include "fsl_iomuxc.h"

void BOARD_InitRs485Pins(void);

void BOARD_InitRs485Pins(void)
{
    CLOCK_EnableClock(kCLOCK_Iomuxc);
    IOMUXC_SetPinMux(IOMUXC_GPIO_AD_B1_06_LPUART3_TXD, 0U);
    IOMUXC_SetPinMux(IOMUXC_GPIO_AD_B1_07_LPUART3_RXD, 0U);
    IOMUXC_SetPinMux(IOMUXC_GPIO_AD_B1_05_LPUART3_RTS_B, 0U);
    IOMUXC_SetPinConfig(IOMUXC_GPIO_AD_B1_06_LPUART3_TXD, 0x10B0U);
    IOMUXC_SetPinConfig(IOMUXC_GPIO_AD_B1_07_LPUART3_RXD, 0x10B0U);
    IOMUXC_SetPinConfig(IOMUXC_GPIO_AD_B1_05_LPUART3_RTS_B, 0x10B0U);
}
