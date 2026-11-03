# SPDX-License-Identifier: MIT
get_filename_component(IOTOS_REPO_ROOT "${CMAKE_CURRENT_LIST_DIR}/../../.." ABSOLUTE)

add_library(iotos_test_support STATIC
  support/decode.c
  support/fake_mqtt_port.c
  support/fake_stream.c
  support/fakes.c
  support/harness.c)
target_include_directories(iotos_test_support PUBLIC support ${CMAKE_CURRENT_LIST_DIR}/../src)
target_link_libraries(iotos_test_support PUBLIC iotos unity)
target_compile_options(iotos_test_support PRIVATE ${IOTOS_WARNINGS})
target_compile_definitions(iotos_test_support PUBLIC
  IOTOS_FIXTURES_DIR="${IOTOS_REPO_ROOT}/contracts/sparkplug/fixtures")

foreach(name codec session mqtt_stream devices writer commands size ports)
  add_executable(test_${name} test_${name}.c)
  target_link_libraries(test_${name} PRIVATE iotos_test_support)
  target_compile_options(test_${name} PRIVATE ${IOTOS_WARNINGS})
  add_test(NAME ${name} COMMAND test_${name})
endforeach()

# The version in iotos.h must match VERSION.
add_test(NAME version COMMAND ${CMAKE_COMMAND}
  -DHEADER=${CMAKE_CURRENT_LIST_DIR}/../include/iotos/iotos.h
  -DVERSION_FILE=${CMAKE_CURRENT_LIST_DIR}/../VERSION
  -P ${CMAKE_CURRENT_LIST_DIR}/check_version.cmake)

# Every port template compiles against the current headers.
file(GLOB IOTOS_TEMPLATES ${CMAKE_CURRENT_LIST_DIR}/../ports/templates/*.c)
foreach(template ${IOTOS_TEMPLATES})
  get_filename_component(template_name ${template} NAME_WE)
  add_test(NAME templates_${template_name}
    COMMAND ${CMAKE_C_COMPILER} -std=c99 -Wall -Wextra -Werror -fsyntax-only
      -I${CMAKE_CURRENT_LIST_DIR}/../include ${template})
endforeach()
