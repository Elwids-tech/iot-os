# SPDX-License-Identifier: MIT
# Adds a starter's generated tables and its connection settings to a target:
# <generated_dir>/iotos_types.c always, and <config_dir>/iotos_settings.c when it exists,
# otherwise settings_missing.c, so a starter builds before its settings are downloaded.
# Adding the settings later re-runs the configuration on the next build.
function(iotos_starter_sources target generated_dir config_dir)
  target_sources(${target} PRIVATE ${generated_dir}/iotos_types.c)
  target_include_directories(${target} PRIVATE ${generated_dir} ${CMAKE_CURRENT_FUNCTION_LIST_DIR})
  if(EXISTS ${config_dir}/iotos_settings.c)
    target_sources(${target} PRIVATE ${config_dir}/iotos_settings.c)
    target_include_directories(${target} PRIVATE ${config_dir})
    target_compile_definitions(${target} PRIVATE IOTOS_KIT_HAVE_SETTINGS=1)
  else()
    target_sources(${target} PRIVATE ${CMAKE_CURRENT_FUNCTION_LIST_DIR}/settings_missing.c)
  endif()
  if(IS_DIRECTORY ${config_dir})
    set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS ${config_dir})
  endif()
endfunction()
