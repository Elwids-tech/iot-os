/* SPDX-License-Identifier: MIT */
/*
 * The byte-stream port: TCP with a connect timeout, then mbedTLS with the kit's CA,
 * SNI and hostname verification. recv waits at most READ_WAIT_MS, so iotos_poll stays
 * responsive.
 */
#define _POSIX_C_SOURCE 200809L
#include <errno.h>
#include <fcntl.h>
#include <netdb.h>
#include <poll.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <unistd.h>

#include "iotos_posix.h"
#include "mbedtls/ctr_drbg.h"
#include "mbedtls/entropy.h"
#include "mbedtls/error.h"
#include "mbedtls/net_sockets.h"
#include "mbedtls/ssl.h"
#include "mbedtls/x509_crt.h"
#include "psa/crypto.h"

#define READ_WAIT_MS 20
#define SEND_WAIT_S 5

typedef struct {
    mbedtls_net_context net;
    mbedtls_ssl_context ssl;
    mbedtls_ssl_config conf;
    mbedtls_x509_crt ca;
    mbedtls_entropy_context entropy;
    mbedtls_ctr_drbg_context drbg;
    bool open;
} tls_state;

static void say(iotos_posix *posix, iotos_log_level level, const char *what, int code)
{
    char reason[128] = "";
    char line[256];
    if (!posix->log.write) {
        return;
    }
    if (code) {
        mbedtls_strerror(code, reason, sizeof(reason));
    }
    snprintf(line, sizeof(line), "%s%s%s", what, code ? ": " : "", reason);
    posix->log.write(posix, level, line);
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
    mbedtls_net_free(&t->net);
    t->open = false;
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
    if (getaddrinfo(host, service, &hints, &found) != 0) {
        return -1;
    }
    for (a = found; a && fd < 0; a = a->ai_next) {
        struct pollfd p;
        int flags, error = 0;
        socklen_t length = sizeof(error);
        fd = socket(a->ai_family, a->ai_socktype, a->ai_protocol);
        if (fd < 0) {
            continue;
        }
        flags = fcntl(fd, F_GETFL, 0);
        fcntl(fd, F_SETFL, flags | O_NONBLOCK);
        if (connect(fd, a->ai_addr, a->ai_addrlen) != 0) {
            p.fd = fd;
            p.events = POLLOUT;
            if (errno != EINPROGRESS || poll(&p, 1, (int)timeout_ms) != 1
                || getsockopt(fd, SOL_SOCKET, SO_ERROR, &error, &length) != 0 || error) {
                close(fd);
                fd = -1;
                continue;
            }
        }
        fcntl(fd, F_SETFL, flags);
    }
    freeaddrinfo(found);
    if (fd >= 0) {
        struct timeval wait = {SEND_WAIT_S, 0};
        setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &wait, sizeof(wait));
    }
    return fd;
}

static iotos_status stream_connect(void *ctx, const char *host, uint16_t port, const char *ca_pem,
                                   uint32_t timeout_ms)
{
    iotos_posix *posix = (iotos_posix *)ctx;
    tls_state *t = (tls_state *)posix->tls;
    uint32_t start = iotos_posix_monotonic_ms();
    int r;
    if (!t) {
        return IOTOS_E_TRANSPORT;
    }
    release(t);
    mbedtls_net_init(&t->net);
    mbedtls_ssl_init(&t->ssl);
    mbedtls_ssl_config_init(&t->conf);
    mbedtls_x509_crt_init(&t->ca);
    mbedtls_entropy_init(&t->entropy);
    mbedtls_ctr_drbg_init(&t->drbg);
    t->open = true;

    if ((r = mbedtls_ctr_drbg_seed(&t->drbg, mbedtls_entropy_func, &t->entropy, (const unsigned char *)"iotos", 5)) != 0
        || (r = mbedtls_x509_crt_parse(&t->ca, (const unsigned char *)ca_pem, strlen(ca_pem) + 1)) != 0) {
        say(posix, IOTOS_LOG_ERROR, "TLS setup failed (check the CA certificate)", r);
        release(t);
        return IOTOS_E_TRANSPORT;
    }
    t->net.fd = tcp_connect(host, port, timeout_ms);
    if (t->net.fd < 0) {
        say(posix, IOTOS_LOG_WARN, "TCP connection to the broker failed", 0);
        release(t);
        return IOTOS_E_TRANSPORT;
    }
    if ((r = mbedtls_ssl_config_defaults(&t->conf, MBEDTLS_SSL_IS_CLIENT, MBEDTLS_SSL_TRANSPORT_STREAM,
                                         MBEDTLS_SSL_PRESET_DEFAULT)) != 0) {
        release(t);
        return IOTOS_E_TRANSPORT;
    }
    mbedtls_ssl_conf_authmode(&t->conf, MBEDTLS_SSL_VERIFY_REQUIRED);
    mbedtls_ssl_conf_ca_chain(&t->conf, &t->ca, NULL);
    mbedtls_ssl_conf_rng(&t->conf, mbedtls_ctr_drbg_random, &t->drbg);
    mbedtls_ssl_conf_read_timeout(&t->conf, READ_WAIT_MS);
    if ((r = mbedtls_ssl_setup(&t->ssl, &t->conf)) != 0 || (r = mbedtls_ssl_set_hostname(&t->ssl, host)) != 0) {
        release(t);
        return IOTOS_E_TRANSPORT;
    }
    mbedtls_ssl_set_bio(&t->ssl, &t->net, mbedtls_net_send, NULL, mbedtls_net_recv_timeout);
    while ((r = mbedtls_ssl_handshake(&t->ssl)) != 0) {
        bool waiting = r == MBEDTLS_ERR_SSL_WANT_READ || r == MBEDTLS_ERR_SSL_WANT_WRITE || r == MBEDTLS_ERR_SSL_TIMEOUT;
        if (!waiting || (uint32_t)(iotos_posix_monotonic_ms() - start) > timeout_ms) {
            say(posix, IOTOS_LOG_ERROR, "TLS handshake with the broker failed", r);
            release(t);
            return IOTOS_E_TRANSPORT;
        }
    }
    return IOTOS_OK;
}

static int32_t stream_send(void *ctx, const uint8_t *data, size_t len)
{
    tls_state *t = (tls_state *)((iotos_posix *)ctx)->tls;
    int r = mbedtls_ssl_write(&t->ssl, data, len);
    if (r >= 0) {
        return (int32_t)r;
    }
    return r == MBEDTLS_ERR_SSL_WANT_WRITE || r == MBEDTLS_ERR_SSL_WANT_READ ? 0 : -1;
}

static int32_t stream_recv(void *ctx, uint8_t *data, size_t len)
{
    tls_state *t = (tls_state *)((iotos_posix *)ctx)->tls;
    int r = mbedtls_ssl_read(&t->ssl, data, len);
    if (r > 0) {
        return (int32_t)r;
    }
    if (r == MBEDTLS_ERR_SSL_TIMEOUT || r == MBEDTLS_ERR_SSL_WANT_READ || r == MBEDTLS_ERR_SSL_WANT_WRITE
#if defined(MBEDTLS_ERR_SSL_RECEIVED_NEW_SESSION_TICKET)
        || r == MBEDTLS_ERR_SSL_RECEIVED_NEW_SESSION_TICKET
#endif
    ) {
        return 0;
    }
    return -1; /* 0 and close-notify mean the broker closed the connection */
}

static void stream_close(void *ctx)
{
    tls_state *t = (tls_state *)((iotos_posix *)ctx)->tls;
    if (t && t->open) {
        (void)mbedtls_ssl_close_notify(&t->ssl);
        release(t);
    }
}

void iotos__posix_stream(iotos_posix *posix, iotos_stream_port *stream)
{
    posix->tls = calloc(1, sizeof(tls_state));
    (void)psa_crypto_init();
    stream->connect = stream_connect;
    stream->send = stream_send;
    stream->recv = stream_recv;
    stream->close = stream_close;
    stream->ctx = posix;
}

void iotos__posix_stream_free(iotos_posix *posix)
{
    if (posix->tls) {
        release((tls_state *)posix->tls);
        free(posix->tls);
        posix->tls = NULL;
    }
}
