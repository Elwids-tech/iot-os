/* SPDX-License-Identifier: MIT */
/* A quick desktop check of the RAM budget. Pointers are wider here, so SC-003 and FR-005
 * are judged by the arm iotos_size target. */
#include <stdio.h>

#include "iotos/iotos.h"
#include "unity.h"

void setUp(void) {}
void tearDown(void) {}

static void test_the_gateway_fits_in_32_kib(void)
{
    printf("sizeof(iotos_gateway) = %zu bytes with %d devices\n", sizeof(iotos_gateway), IOTOS_MAX_DEVICES);
    TEST_ASSERT_EQUAL_INT(512, IOTOS_MAX_DEVICES);
    TEST_ASSERT_TRUE(sizeof(iotos_gateway) <= 32768u);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_the_gateway_fits_in_32_kib);
    return UNITY_END();
}
