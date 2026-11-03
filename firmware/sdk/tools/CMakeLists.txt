# SPDX-License-Identifier: MIT
get_filename_component(IOTOS_REPO_ROOT "${CMAKE_CURRENT_LIST_DIR}/../../.." ABSOLUTE)

# Regenerate the committed fixtures with:
#   cmake --build <build> --target iotos_fixtures && <build>/tools/iotos_fixtures contracts/sparkplug/fixtures/sdk
add_executable(iotos_fixtures fixtures.c)
target_link_libraries(iotos_fixtures PRIVATE iotos_test_support)
target_compile_options(iotos_fixtures PRIVATE ${IOTOS_WARNINGS})

add_test(NAME fixtures COMMAND ${CMAKE_COMMAND}
  -DGENERATOR=$<TARGET_FILE:iotos_fixtures>
  -DCOMMITTED=${IOTOS_REPO_ROOT}/contracts/sparkplug/fixtures/sdk
  -DSCRATCH=${CMAKE_CURRENT_BINARY_DIR}/fixtures-check
  -P ${CMAKE_CURRENT_LIST_DIR}/check_fixtures.cmake)
