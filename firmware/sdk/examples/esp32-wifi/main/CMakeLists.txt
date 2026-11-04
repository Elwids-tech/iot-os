# SPDX-License-Identifier: MIT
# Every .c file in main/ is built, and main can use every ESP-IDF component (UART, GPIO,
# I2C...) as well as iotos, so adding the field code needs no change here.
idf_component_register(SRC_DIRS "." INCLUDE_DIRS ".")
