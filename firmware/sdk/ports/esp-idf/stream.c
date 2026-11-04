/* SPDX-License-Identifier: MIT */
/*
 * The byte-stream port: esp-tls with the kit's CA, the broker host as SNI and as the
 * name the certificate must carry, within the SDK's connect timeout. After the handshake
 * the socket waits at most READ_WAIT_MS for data, so iotos_poll stays responsive.
 */
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/time.h>

#include "esp_err.h"
#include "esp_tls.h"
#include "iotos_esp_idf.h"

#define READ_WAIT_MS 20
#define SEND_WAIT_S 5

static bool unreachable(esp_err_t error)
{
    return error == ESP_ERR_ESP_TLS_CANNOT_RESOLVE_HOSTNAME || error == ESP_ERR_ESP_TLS_CANNOT_CREATE_SOCKET
           || error == ESP_ERR_ESP_TLS_FAILED_CONNECT_TO_HOST || error == ESP_ERR_ESP_TLS_CONNECTION_TIMEOUT;
}

static void say_failure(iotos_esp_idf *esp, esp_tls_t *tls)
{
    esp_tls_error_handle_t handle;
    esp_err_t error = ESP_FAIL;
    int tls_code = 0, certificate_flags = 0;
    char line[200];
    if (esp_tls_get_error_handle(tls, &handle) == ESP_OK) {
        error = esp_tls_get_and_clear_last_error(handle, &tls_code, &certificate_flags);
    }
    if (unreachable(error)) {
        snprintf(line, sizeof(line), "Could not reach the broker: %s", esp_err_to_name(error));
        esp->log.write(esp, IOTOS_LOG_WARN, line);
        return;
    }
    snprintf(line, sizeof(line),
             "TLS handshake with the broker failed (check the CA certificate and the broker address): %s, "
             "TLS error -0x%04x, certificate flags 0x%x",
             esp_err_to_name(error), (unsigned)-tls_code, (unsigned)certificate_flags);
    esp->log.write(esp, IOTOS_LOG_ERROR, line);
}

static void stream_close(void *ctx)
{
    iotos_esp_idf *esp = (iotos_esp_idf *)ctx;
    if (esp->tls) {
        (void)esp_tls_conn_destroy((esp_tls_t *)esp->tls);
        esp->tls = NULL;
    }
}

static iotos_status stream_connect(void *ctx, const char *host, uint16_t port, const char *ca_pem,
                                   uint32_t timeout_ms)
{
    iotos_esp_idf *esp = (iotos_esp_idf *)ctx;
    esp_tls_cfg_t cfg = {
        .cacert_buf = (const unsigned char *)ca_pem,
        .cacert_bytes = (unsigned int)strlen(ca_pem) + 1, /* PEM: the NUL is counted */
        .common_name = host,
        .timeout_ms = (int)timeout_ms,
    };
    struct timeval read_wait = {0, READ_WAIT_MS * 1000};
    struct timeval send_wait = {SEND_WAIT_S, 0};
    esp_tls_t *tls;
    int fd = -1;
    stream_close(ctx);
    tls = esp_tls_init();
    if (!tls) {
        esp->log.write(esp, IOTOS_LOG_ERROR, "Not enough memory for a TLS connection.");
        return IOTOS_E_TRANSPORT;
    }
    if (esp_tls_conn_new_sync(host, (int)strlen(host), port, &cfg, tls) != 1) {
        say_failure(esp, tls);
        (void)esp_tls_conn_destroy(tls);
        return IOTOS_E_TRANSPORT;
    }
    /* esp-tls left the connect timeout on the socket: reads must return quickly. */
    if (esp_tls_get_conn_sockfd(tls, &fd) != ESP_OK
        || setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &read_wait, sizeof(read_wait)) != 0
        || setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &send_wait, sizeof(send_wait)) != 0) {
        esp->log.write(esp, IOTOS_LOG_ERROR, "Could not set the socket's timeouts.");
        (void)esp_tls_conn_destroy(tls);
        return IOTOS_E_TRANSPORT;
    }
    esp->tls = tls;
    return IOTOS_OK;
}

static int32_t stream_send(void *ctx, const uint8_t *data, size_t len)
{
    esp_tls_t *tls = (esp_tls_t *)((iotos_esp_idf *)ctx)->tls;
    ssize_t r;
    if (!tls) {
        return -1;
    }
    r = esp_tls_conn_write(tls, data, len);
    if (r >= 0) {
        return (int32_t)r;
    }
    return r == ESP_TLS_ERR_SSL_WANT_WRITE || r == ESP_TLS_ERR_SSL_WANT_READ ? 0 : -1;
}

static int32_t stream_recv(void *ctx, uint8_t *data, size_t len)
{
    esp_tls_t *tls = (esp_tls_t *)((iotos_esp_idf *)ctx)->tls;
    ssize_t r;
    if (!tls) {
        return -1;
    }
    r = esp_tls_conn_read(tls, data, len);
    if (r > 0) {
        return (int32_t)r;
    }
    if (r == ESP_TLS_ERR_SSL_WANT_READ || r == ESP_TLS_ERR_SSL_WANT_WRITE || r == ESP_TLS_ERR_SSL_TIMEOUT) {
        return 0; /* the socket's read wait passed with nothing to read */
    }
    return -1; /* 0 and close-notify mean the broker closed the connection */
}

void iotos__esp_idf_stream(iotos_esp_idf *esp, iotos_stream_port *stream)
{
    stream->connect = stream_connect;
    stream->send = stream_send;
    stream->recv = stream_recv;
    stream->close = stream_close;
    stream->ctx = esp;
}
