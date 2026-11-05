/* SPDX-License-Identifier: MIT */
/*
 * The byte-stream port: an lwIP TCP socket with a connect timeout, then mbedTLS with the
 * kit's CA, SNI and hostname verification, seeded from the TRNG (entropy_trng.c).
 * recv waits at most READ_WAIT_MS, so iotos_poll stays responsive.
 *
 * Certificate dates are checked once the clock is valid. Before the first SNTP answer
 * the board cannot tell an expired certificate from a good one, so the dates are not
 * held against the broker then; the CA and the host name always are.
 */
#include <stdio.h>
#include <string.h>

#include "FreeRTOS.h"
#include "iotos_mcux.h"
#include "lwip/errno.h"
#include "lwip/netdb.h"
#include "lwip/sockets.h"
#include "mbedtls/ctr_drbg.h"
#include "mbedtls/entropy.h"
#include "mbedtls/error.h"
#include "mbedtls/net_sockets.h" /* the MBEDTLS_ERR_NET_ codes; the sockets are lwIP's */
#include "mbedtls/platform.h"
#include "mbedtls/ssl.h"
#include "mbedtls/x509_crt.h"

#define READ_WAIT_MS 20
#define SEND_WAIT_S 5

typedef struct {
    int fd;
    mbedtls_ssl_context ssl;
    mbedtls_ssl_config conf;
    mbedtls_x509_crt ca;
    mbedtls_entropy_context entropy;
    mbedtls_ctr_drbg_context drbg;
    bool open;
} tls_state;

static tls_state state; /* one connection at a time */

uint64_t iotos__mcux_utc_ms(void);

time_t iotos_mcux_tls_time(time_t *now)
{
    time_t seconds = (time_t)(iotos__mcux_utc_ms() / 1000u);
    if (now) {
        *now = seconds;
    }
    return seconds;
}

mbedtls_ms_time_t mbedtls_ms_time(void)
{
    return (mbedtls_ms_time_t)iotos_mcux_monotonic_ms();
}

static void say(iotos_mcux *mcux, iotos_log_level level, const char *what, int code)
{
    char reason[100] = "";
    char line[200];
    if (code) {
        mbedtls_strerror(code, reason, sizeof(reason));
    }
    snprintf(line, sizeof(line), "%s%s%s", what, code ? ": " : "", reason);
    mcux->log.write(mcux->log.ctx, level, line);
}

/* mbedTLS allocates its handshake and record buffers from the FreeRTOS heap. */
static void *tls_calloc(size_t count, size_t size)
{
    void *block;
    if (size && count > (size_t)-1 / size) {
        return NULL;
    }
    block = pvPortMalloc(count * size);
    if (block) {
        memset(block, 0, count * size);
    }
    return block;
}

static void release(tls_state *t)
{
    if (!t->open) {
        return;
    }
    mbedtls_ssl_free(&t->ssl);
    mbedtls_ssl_config_free(&t->conf);
    mbedtls_x509_crt_free(&t->ca);
    mbedtls_ctr_drbg_free(&t->drbg);
    mbedtls_entropy_free(&t->entropy);
    if (t->fd >= 0) {
        (void)lwip_close(t->fd);
        t->fd = -1;
    }
    t->open = false;
}

static int net_send(void *ctx, const unsigned char *data, size_t len)
{
    int sent = lwip_send(((tls_state *)ctx)->fd, data, len, 0);
    if (sent >= 0) {
        return sent;
    }
    return errno == EWOULDBLOCK || errno == EAGAIN ? MBEDTLS_ERR_SSL_WANT_WRITE : MBEDTLS_ERR_NET_SEND_FAILED;
}

static int net_recv(void *ctx, unsigned char *data, size_t len)
{
    int got = lwip_recv(((tls_state *)ctx)->fd, data, len, 0);
    if (got > 0) {
        return got;
    }
    if (got == 0) {
        return MBEDTLS_ERR_SSL_PEER_CLOSE_NOTIFY; /* the broker closed the connection */
    }
    return errno == EWOULDBLOCK || errno == EAGAIN ? MBEDTLS_ERR_SSL_WANT_READ : MBEDTLS_ERR_NET_RECV_FAILED;
}

static int check_dates(void *ctx, mbedtls_x509_crt *crt, int depth, uint32_t *flags)
{
    (void)ctx;
    (void)crt;
    (void)depth;
    if (!iotos_mcux_clock_valid()) {
        *flags &= ~(uint32_t)(MBEDTLS_X509_BADCERT_EXPIRED | MBEDTLS_X509_BADCERT_FUTURE);
    }
    return 0;
}

static int tcp_connect(const char *host, uint16_t port, uint32_t timeout_ms)
{
    struct addrinfo hints, *found = NULL, *a;
    char service[8];
    int fd = -1;
    memset(&hints, 0, sizeof(hints));
    hints.ai_family = AF_UNSPEC;
    hints.ai_socktype = SOCK_STREAM;
    snprintf(service, sizeof(service), "%u", (unsigned)port);
    if (lwip_getaddrinfo(host, service, &hints, &found) != 0) {
        return -1;
    }
    for (a = found; a && fd < 0; a = a->ai_next) {
        struct timeval wait = {(long)(timeout_ms / 1000u), (long)(timeout_ms % 1000u) * 1000};
        fd_set writable;
        int flags, error = 0;
        socklen_t length = sizeof(error);
        fd = lwip_socket(a->ai_family, a->ai_socktype, a->ai_protocol);
        if (fd < 0) {
            continue;
        }
        flags = lwip_fcntl(fd, F_GETFL, 0);
        (void)lwip_fcntl(fd, F_SETFL, flags | O_NONBLOCK);
        if (lwip_connect(fd, a->ai_addr, a->ai_addrlen) != 0) {
            FD_ZERO(&writable);
            FD_SET(fd, &writable);
            if (errno != EINPROGRESS || lwip_select(fd + 1, NULL, &writable, NULL, &wait) != 1
                || lwip_getsockopt(fd, SOL_SOCKET, SO_ERROR, &error, &length) != 0 || error) {
                (void)lwip_close(fd);
                fd = -1;
                continue;
            }
        }
        (void)lwip_fcntl(fd, F_SETFL, flags);
    }
    lwip_freeaddrinfo(found);
    if (fd >= 0) {
        struct timeval read_wait = {0, READ_WAIT_MS * 1000};
        struct timeval send_wait = {SEND_WAIT_S, 0};
        if (lwip_setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &read_wait, sizeof(read_wait)) != 0
            || lwip_setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &send_wait, sizeof(send_wait)) != 0) {
            (void)lwip_close(fd);
            fd = -1;
        }
    }
    return fd;
}

static iotos_status stream_connect(void *ctx, const char *host, uint16_t port, const char *ca_pem,
                                   uint32_t timeout_ms)
{
    iotos_mcux *mcux = (iotos_mcux *)ctx;
    tls_state *t = (tls_state *)mcux->tls;
    uint32_t start = iotos_mcux_monotonic_ms();
    int r;
    release(t);
    mbedtls_ssl_init(&t->ssl);
    mbedtls_ssl_config_init(&t->conf);
    mbedtls_x509_crt_init(&t->ca);
    mbedtls_entropy_init(&t->entropy);
    mbedtls_ctr_drbg_init(&t->drbg);
    t->fd = -1;
    t->open = true;

    if ((r = mbedtls_ctr_drbg_seed(&t->drbg, mbedtls_entropy_func, &t->entropy, (const unsigned char *)"iotos", 5)) != 0) {
        say(mcux, IOTOS_LOG_ERROR, "Could not seed the random generator from the TRNG", r);
        release(t);
        return IOTOS_E_TRANSPORT;
    }
    if ((r = mbedtls_x509_crt_parse(&t->ca, (const unsigned char *)ca_pem, strlen(ca_pem) + 1)) != 0) {
        say(mcux, IOTOS_LOG_ERROR, "TLS setup failed (check the CA certificate)", r);
        release(t);
        return IOTOS_E_TRANSPORT;
    }
    t->fd = tcp_connect(host, port, timeout_ms);
    if (t->fd < 0) {
        say(mcux, IOTOS_LOG_WARN, "Could not reach the broker (check the network, DNS and the broker address)", 0);
        release(t);
        return IOTOS_E_TRANSPORT;
    }
    if ((r = mbedtls_ssl_config_defaults(&t->conf, MBEDTLS_SSL_IS_CLIENT, MBEDTLS_SSL_TRANSPORT_STREAM,
                                         MBEDTLS_SSL_PRESET_DEFAULT)) != 0) {
        say(mcux, IOTOS_LOG_ERROR, "TLS setup failed", r);
        release(t);
        return IOTOS_E_TRANSPORT;
    }
    mbedtls_ssl_conf_authmode(&t->conf, MBEDTLS_SSL_VERIFY_REQUIRED);
    mbedtls_ssl_conf_ca_chain(&t->conf, &t->ca, NULL);
    mbedtls_ssl_conf_verify(&t->conf, check_dates, NULL);
    mbedtls_ssl_conf_rng(&t->conf, mbedtls_ctr_drbg_random, &t->drbg);
    if ((r = mbedtls_ssl_setup(&t->ssl, &t->conf)) != 0 || (r = mbedtls_ssl_set_hostname(&t->ssl, host)) != 0) {
        say(mcux, IOTOS_LOG_ERROR, "TLS setup failed (not enough memory?)", r);
        release(t);
        return IOTOS_E_TRANSPORT;
    }
    mbedtls_ssl_set_bio(&t->ssl, t, net_send, net_recv, NULL);
    while ((r = mbedtls_ssl_handshake(&t->ssl)) != 0) {
        bool waiting = r == MBEDTLS_ERR_SSL_WANT_READ || r == MBEDTLS_ERR_SSL_WANT_WRITE;
        if (!waiting || (uint32_t)(iotos_mcux_monotonic_ms() - start) > timeout_ms) {
            say(mcux, IOTOS_LOG_ERROR, "TLS handshake with the broker failed (check the CA certificate and the broker address)", r);
            release(t);
            return IOTOS_E_TRANSPORT;
        }
    }
    return IOTOS_OK;
}

static int32_t stream_send(void *ctx, const uint8_t *data, size_t len)
{
    tls_state *t = (tls_state *)((iotos_mcux *)ctx)->tls;
    int r;
    if (!t->open) {
        return -1;
    }
    r = mbedtls_ssl_write(&t->ssl, data, len);
    if (r >= 0) {
        return (int32_t)r;
    }
    return r == MBEDTLS_ERR_SSL_WANT_WRITE || r == MBEDTLS_ERR_SSL_WANT_READ ? 0 : -1;
}

static int32_t stream_recv(void *ctx, uint8_t *data, size_t len)
{
    tls_state *t = (tls_state *)((iotos_mcux *)ctx)->tls;
    int r;
    if (!t->open) {
        return -1;
    }
    r = mbedtls_ssl_read(&t->ssl, data, len);
    if (r > 0) {
        return (int32_t)r;
    }
    if (r == MBEDTLS_ERR_SSL_WANT_READ || r == MBEDTLS_ERR_SSL_WANT_WRITE) {
        return 0; /* the socket's read wait passed with nothing to read */
    }
    return -1; /* 0 and close-notify mean the broker closed the connection */
}

static void stream_close(void *ctx)
{
    tls_state *t = (tls_state *)((iotos_mcux *)ctx)->tls;
    if (t->open) {
        (void)mbedtls_ssl_close_notify(&t->ssl);
        release(t);
    }
}

iotos_status iotos__mcux_stream(iotos_mcux *mcux, iotos_stream_port *stream)
{
    if (mbedtls_platform_set_calloc_free(tls_calloc, vPortFree) != 0) {
        return IOTOS_E_INVALID;
    }
    state.fd = -1;
    mcux->tls = &state;
    stream->connect = stream_connect;
    stream->send = stream_send;
    stream->recv = stream_recv;
    stream->close = stream_close;
    stream->ctx = mcux;
    return IOTOS_OK;
}
