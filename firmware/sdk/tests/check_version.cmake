# SPDX-License-Identifier: MIT
file(STRINGS "${VERSION_FILE}" version LIMIT_COUNT 1)
file(STRINGS "${HEADER}" line REGEX "#define IOTOS_SDK_VERSION ")
if(NOT line MATCHES "\"${version}\"")
  message(FATAL_ERROR "IOTOS_SDK_VERSION in iotos.h does not match VERSION (${version})")
endif()
