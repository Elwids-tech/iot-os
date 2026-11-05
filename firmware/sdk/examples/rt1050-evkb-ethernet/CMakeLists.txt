# SPDX-License-Identifier: MIT
# An i.MX RT1050 program on the IoT OS SDK, for the MIMXRT1050-EVKB over Ethernet, built
# with the MCUXpresso SDK 26.09.00 as a freestanding project. In a starter:
#   export MCUXSDK_ROOT=<workspace>/mcuxsdk ARMGCC_DIR=<Arm GNU Toolchain 14.2>
#   cmake -S . -B build -G Ninja && cmake --build build
# The developer's code is in app/, the board's pins and clocks in board/. sdk/, generated/
# and config/ are found beside this file. The MCUXpresso SDK is not included: point
# MCUXSDK_ROOT at the mcuxsdk/ folder of a west workspace (see the README).
#
# The SDK brings its own MQTT client. Do not select the MCUXpresso coreMQTT middleware: two
# copies give duplicate symbols.
cmake_minimum_required(VERSION 3.30.0)

if(NOT DEFINED SdkRootDirPath)
  if(NOT DEFINED ENV{MCUXSDK_ROOT})
    message(FATAL_ERROR "Set MCUXSDK_ROOT to the mcuxsdk/ folder of an MCUXpresso SDK 26.09.00 workspace.")
  endif()
  set(SdkRootDirPath $ENV{MCUXSDK_ROOT})
endif()
set(board evkbimxrt1050 CACHE STRING "The MCUXpresso board")
set(CONFIG_TOOLCHAIN armgcc CACHE STRING "The MCUXpresso toolchain")
# Code runs from the board's flash; data and the heap sit in its SDRAM.
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE flexspi_nor_sdram_debug CACHE STRING "The MCUXpresso build target" FORCE)
endif()

include(${SdkRootDirPath}/cmake/extension/mcux.cmake)
project(iotos_app LANGUAGES C CXX ASM)
include(${SdkRootDirPath}/CMakeLists.txt)

if(EXISTS ${CMAKE_CURRENT_LIST_DIR}/sdk/CMakeLists.txt)
  # A starter: the SDK, the generated tables and the connection settings sit beside this file.
  set(IOTOS_SDK_DIR ${CMAKE_CURRENT_LIST_DIR}/sdk)
  set(APP_GENERATED_DIR ${CMAKE_CURRENT_LIST_DIR}/generated)
  set(APP_CONFIG_DIR ${CMAKE_CURRENT_LIST_DIR}/config)
else()
  # The SDK repository, where CI builds the example against the simulator's sample tables.
  get_filename_component(IOTOS_SDK_DIR ${CMAKE_CURRENT_LIST_DIR}/../.. ABSOLUTE)
  set(APP_GENERATED_DIR ${IOTOS_SDK_DIR}/examples/desktop-simulator/sample-config)
  set(APP_CONFIG_DIR ${APP_GENERATED_DIR})
endif()
include(${IOTOS_SDK_DIR}/ports/mcuxpresso-lwip/iotos_mcux.cmake)

# Every .c file in app/ is built, so adding the field code needs no change here.
file(GLOB APP_SOURCES CONFIGURE_DEPENDS ${CMAKE_CURRENT_LIST_DIR}/app/*.c)
set(APP_BOARD_SOURCES
  ${CMAKE_CURRENT_LIST_DIR}/board/hardware_init.c
  ${CMAKE_CURRENT_LIST_DIR}/board/pin_mux.c
  ${CMAKE_CURRENT_LIST_DIR}/board/rs485_pins.c)
target_sources(${MCUX_SDK_PROJECT_NAME} PRIVATE ${APP_SOURCES} ${APP_BOARD_SOURCES})
target_include_directories(${MCUX_SDK_PROJECT_NAME} PRIVATE ${CMAKE_CURRENT_LIST_DIR} ${CMAKE_CURRENT_LIST_DIR}/app
  ${CMAKE_CURRENT_LIST_DIR}/board)
set_source_files_properties(${APP_SOURCES} PROPERTIES COMPILE_OPTIONS "-Wall;-Wextra")
iotos_mcux_sources(${MCUX_SDK_PROJECT_NAME} ${APP_GENERATED_DIR} ${APP_CONFIG_DIR})

# The board's ENET PHY runs from the 50 MHz RMII clock; drivers keep the cache in step
# with DMA buffers in SDRAM.
mcux_add_macro(CC "-DFSL_FEATURE_PHYKSZ8081_USE_RMII50M_MODE -DFSL_SDK_ENABLE_DRIVER_CACHE_CONTROL=1 -DUSE_RTOS=1")
mcux_add_macro(TOOLCHAINS armgcc CC "-D_POSIX_SOURCE")
mcux_add_linker_symbol(SYMBOLS "__stack_size__=0x1000 __heap_size__=0x40000")

mcux_convert_binary(BINARY ${APPLICATION_BINARY_DIR}/${MCUX_SDK_PROJECT_NAME}.bin)
