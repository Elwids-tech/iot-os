# SPDX-License-Identifier: MIT
# The core's sources: the SDK and the vendored coreMQTT, no OS, no heap. The desktop
# library (CMakeLists.txt) and every board's build use this one list, so each target sends
# the same messages through the same client (spec 027 FR-013).
get_filename_component(IOTOS_SDK_DIR ${CMAKE_CURRENT_LIST_DIR}/.. ABSOLUTE)
set(IOTOS_COREMQTT ${IOTOS_SDK_DIR}/third_party/coreMQTT/source)
set(IOTOS_CORE_SOURCES
  ${IOTOS_SDK_DIR}/src/codec.c
  ${IOTOS_SDK_DIR}/src/commands.c
  ${IOTOS_SDK_DIR}/src/devices.c
  ${IOTOS_SDK_DIR}/src/health.c
  ${IOTOS_SDK_DIR}/src/mqtt_stream.c
  ${IOTOS_SDK_DIR}/src/session.c
  ${IOTOS_SDK_DIR}/src/writer.c
  ${IOTOS_COREMQTT}/core_mqtt.c
  ${IOTOS_COREMQTT}/core_mqtt_serializer.c
  ${IOTOS_COREMQTT}/core_mqtt_state.c)
# Only the core's own files include these.
set(IOTOS_CORE_PRIVATE_INCLUDE_DIRS ${IOTOS_SDK_DIR}/src ${IOTOS_COREMQTT}/include ${IOTOS_COREMQTT}/interface)
