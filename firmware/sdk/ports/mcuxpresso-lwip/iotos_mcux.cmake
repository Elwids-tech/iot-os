# SPDX-License-Identifier: MIT
# The SDK in an MCUXpresso SDK 26.x project: the core from cmake/iotos_sources.cmake (the
# desktop library's list), these ports, the FreeRTOS lock and log, a starter's generated
# tables and its connection settings. A project's CMakeLists.txt includes this file after
# the MCUXpresso SDK's own CMakeLists.txt, then calls
#   iotos_mcux_sources(<target> <generated_dir> <config_dir>)
# so an SDK update brings new sources with it. The project's prj.conf selects lwIP (with
# sockets, DNS, DHCP and the SNTP app), FreeRTOS, mbedTLS 3.x without PSA
# (middleware.mbedtls3x.ssl.no_psa) and the TRNG driver.
#
# Never select the MCUXpresso coreMQTT middleware as well: two copies of coreMQTT give
# duplicate symbols.
include(${CMAKE_CURRENT_LIST_DIR}/../../cmake/iotos_sources.cmake)
include(${IOTOS_SDK_DIR}/starter/iotos_starter.cmake)

set(IOTOS_MCUX_SOURCES
  ${IOTOS_SDK_DIR}/ports/mcuxpresso-lwip/clock_sntp.c
  ${IOTOS_SDK_DIR}/ports/mcuxpresso-lwip/entropy_trng.c
  ${IOTOS_SDK_DIR}/ports/mcuxpresso-lwip/ports.c
  ${IOTOS_SDK_DIR}/ports/mcuxpresso-lwip/stream_mbedtls_lwip.c
  ${IOTOS_SDK_DIR}/ports/freertos/lock.c
  ${IOTOS_SDK_DIR}/ports/freertos/log.c)

function(iotos_mcux_sources target generated_dir config_dir)
  target_sources(${target} PRIVATE ${IOTOS_CORE_SOURCES} ${IOTOS_MCUX_SOURCES})
  target_include_directories(${target} PRIVATE ${IOTOS_SDK_DIR}/include ${IOTOS_SDK_DIR}/ports/mcuxpresso-lwip
    ${IOTOS_SDK_DIR}/ports/freertos)
  # The core's own headers stay private to the core's files.
  set_source_files_properties(${IOTOS_CORE_SOURCES} PROPERTIES INCLUDE_DIRECTORIES "${IOTOS_CORE_PRIVATE_INCLUDE_DIRS}")
  set_source_files_properties(${IOTOS_CORE_SOURCES} ${IOTOS_MCUX_SOURCES} PROPERTIES COMPILE_OPTIONS "-Wall;-Wextra")
  # Every mbedTLS file in the project builds with the stream port's configuration.
  target_compile_definitions(${target} PRIVATE "MBEDTLS_CONFIG_FILE=\"iotos_mbedtls_config.h\"")
  iotos_starter_sources(${target} ${generated_dir} ${config_dir})
endfunction()
