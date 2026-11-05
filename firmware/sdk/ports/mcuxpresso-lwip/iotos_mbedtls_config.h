/* SPDX-License-Identifier: MIT */
/*
 * mbedTLS 3.6 for the IoT OS byte stream: a TLS 1.2 client that verifies the broker's
 * RSA or ECDSA chain against the kit's CA, with ECDHE and AES-GCM or ChaCha20-Poly1305.
 * Build with -DMBEDTLS_CONFIG_FILE='"iotos_mbedtls_config.h"'. Entropy comes from
 * mbedtls_hardware_poll (entropy_trng.c), memory from the FreeRTOS heap (set at run time
 * by the stream port), and certificate dates from the port's clock once it is valid.
 *
 * The broker sends records of up to 16 KiB, so the input buffer stays at the default.
 * Anything not listed here is off; add what a project needs below.
 */
#ifndef IOTOS_MBEDTLS_CONFIG_H
#define IOTOS_MBEDTLS_CONFIG_H

#include <stdint.h>

/* System */
#define MBEDTLS_HAVE_ASM
#define MBEDTLS_HAVE_TIME
#define MBEDTLS_HAVE_TIME_DATE
#define MBEDTLS_PLATFORM_C
#define MBEDTLS_PLATFORM_MEMORY
#define MBEDTLS_PLATFORM_TIME_MACRO iotos_mcux_tls_time
#define MBEDTLS_PLATFORM_MS_TIME_ALT
#define MBEDTLS_NO_PLATFORM_ENTROPY
#define MBEDTLS_ENTROPY_HARDWARE_ALT
#define MBEDTLS_DEPRECATED_REMOVED

/* Seconds since 1970 from the port's clock, 0 until it is valid, and the tick in
 * milliseconds (stream_mbedtls_lwip.c). */
#include <time.h>
time_t iotos_mcux_tls_time(time_t *now);

/* Cipher suites: ECDHE key exchange, RSA or ECDSA certificates */
#define MBEDTLS_KEY_EXCHANGE_ECDHE_RSA_ENABLED
#define MBEDTLS_KEY_EXCHANGE_ECDHE_ECDSA_ENABLED
#define MBEDTLS_ECP_DP_SECP256R1_ENABLED
#define MBEDTLS_ECP_DP_SECP384R1_ENABLED
#define MBEDTLS_ECP_DP_CURVE25519_ENABLED
#define MBEDTLS_ECP_NIST_OPTIM
#define MBEDTLS_PKCS1_V15
#define MBEDTLS_PKCS1_V21

/* TLS */
#define MBEDTLS_SSL_TLS_C
#define MBEDTLS_SSL_CLI_C
#define MBEDTLS_SSL_PROTO_TLS1_2
#define MBEDTLS_SSL_SERVER_NAME_INDICATION
#define MBEDTLS_SSL_ENCRYPT_THEN_MAC
#define MBEDTLS_SSL_EXTENDED_MASTER_SECRET
#define MBEDTLS_SSL_OUT_CONTENT_LEN 4096

/* Certificates */
#define MBEDTLS_X509_USE_C
#define MBEDTLS_X509_CRT_PARSE_C
#define MBEDTLS_X509_RSASSA_PSS_SUPPORT
#define MBEDTLS_PEM_PARSE_C
#define MBEDTLS_BASE64_C
#define MBEDTLS_PK_C
#define MBEDTLS_PK_PARSE_C
#define MBEDTLS_OID_C
#define MBEDTLS_ASN1_PARSE_C
#define MBEDTLS_ASN1_WRITE_C

/* Crypto */
#define MBEDTLS_AES_C
#define MBEDTLS_AES_ROM_TABLES
#define MBEDTLS_GCM_C
#define MBEDTLS_CHACHA20_C
#define MBEDTLS_POLY1305_C
#define MBEDTLS_CHACHAPOLY_C
#define MBEDTLS_CIPHER_C
#define MBEDTLS_MD_C
#define MBEDTLS_SHA1_C /* only to read older CA certificates */
#define MBEDTLS_SHA224_C
#define MBEDTLS_SHA256_C
#define MBEDTLS_SHA384_C
#define MBEDTLS_SHA512_C
#define MBEDTLS_BIGNUM_C
#define MBEDTLS_RSA_C
#define MBEDTLS_ECP_C
#define MBEDTLS_ECDH_C
#define MBEDTLS_ECDSA_C
#define MBEDTLS_ENTROPY_C
#define MBEDTLS_CTR_DRBG_C
#define MBEDTLS_HMAC_DRBG_C
#define MBEDTLS_ERROR_C

#endif
