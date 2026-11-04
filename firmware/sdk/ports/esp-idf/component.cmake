# SPDX-License-Identifier: MIT
# The SDK as an ESP-IDF component: the core from cmake/iotos_sources.cmake (the desktop
# library's list), these ports, the FreeRTOS lock, a starter's generated tables and its
# connection settings. A project's components/iotos/CMakeLists.txt sets
# IOTOS_GENERATED_DIR and IOTOS_CONFIG_DIR, then includes this file, so an SDK update
# brings its new sources with it.
#
# Never add the espressif/coremqtt component or build ESP-IDF's coreMQTT beside this one:
# two copies give duplicate symbols. ESP-IDF's own MQTT client (esp-mqtt) is not used.
include(${CMAKE_CURRENT_LIST_DIR}/../../cmake/iotos_sources.cmake)
include(${IOTOS_SDK_DIR}/starter/iotos_starter.cmake)

idf_component_register(
  SRCS
    ${IOTOS_CORE_SOURCES}
    ${IOTOS_SDK_DIR}/ports/esp-idf/clock.c
    ${IOTOS_SDK_DIR}/ports/esp-idf/log.c
    ${IOTOS_SDK_DIR}/ports/esp-idf/ports.c
    ${IOTOS_SDK_DIR}/ports/esp-idf/storage.c
    ${IOTOS_SDK_DIR}/ports/esp-idf/stream.c
    ${IOTOS_SDK_DIR}/ports/freertos/lock.c
  INCLUDE_DIRS ${IOTOS_SDK_DIR}/include ${IOTOS_SDK_DIR}/ports/esp-idf ${IOTOS_SDK_DIR}/ports/freertos
  PRIV_INCLUDE_DIRS ${IOTOS_CORE_PRIVATE_INCLUDE_DIRS}
  PRIV_REQUIRES esp-tls esp_netif esp_timer log lwip nvs_flash)

iotos_starter_sources(${COMPONENT_LIB} ${IOTOS_GENERATED_DIR} ${IOTOS_CONFIG_DIR} PUBLIC)
