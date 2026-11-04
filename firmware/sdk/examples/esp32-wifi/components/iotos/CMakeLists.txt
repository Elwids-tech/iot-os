# SPDX-License-Identifier: MIT
# The IoT OS SDK as a component. sdk/ports/esp-idf/component.cmake lists what it builds,
# so an SDK update brings new sources with it: the same core and MQTT client as the
# desktop library, the ESP-IDF ports, generated/ and the settings in config/.
#
# The SDK brings its own MQTT client. Do not add the coreMQTT component from the ESP
# Component Registry (its symbols clash with the SDK's copy), and do not connect to the
# platform with ESP-IDF's MQTT client.
get_filename_component(project_dir ${CMAKE_CURRENT_LIST_DIR}/../.. ABSOLUTE)
if(EXISTS ${project_dir}/sdk/CMakeLists.txt)
  # A starter: sdk/, generated/ and config/ sit beside main/.
  set(IOTOS_SDK_DIR ${project_dir}/sdk)
  set(IOTOS_GENERATED_DIR ${project_dir}/generated)
  set(IOTOS_CONFIG_DIR ${project_dir}/config)
else()
  # The SDK repository, where CI builds the example against the simulator's sample tables.
  get_filename_component(IOTOS_SDK_DIR ${project_dir}/../.. ABSOLUTE)
  set(IOTOS_GENERATED_DIR ${IOTOS_SDK_DIR}/examples/desktop-simulator/sample-config)
  set(IOTOS_CONFIG_DIR ${IOTOS_GENERATED_DIR})
endif()
include(${IOTOS_SDK_DIR}/ports/esp-idf/component.cmake)
