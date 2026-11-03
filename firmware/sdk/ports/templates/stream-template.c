/* SPDX-License-Identifier: MIT */
/*
 * Template: the byte-stream port (level 1).
 *
 * Use this level when your network stack gives you TCP and TLS (lwIP and mbedTLS, a Wi-Fi
 * module's sockets, a modem in transparent TLS mode). The SDK runs MQTT over the stream
 * with its bundled client; you provide a verified TLS pipe to the broker.
 *
 * Copy this file into your project, rename the my_ prefix, and replace each TODO. Point
 * iotos_ports.stream at my_stream_port and leave iotos_ports.mqtt NULL.
 * ports/posix/stream_mbedtls.c is a complete example with mbedTLS over sockets.
 */
#include "iotos/iotos.h"

typedef struct {
    int socket; /* TODO: your socket and TLS context */
} my_stream;

/*
 * Open the connection: TCP to host:port, then a TLS handshake. Finish within timeout_ms.
 * - Verify the broker's certificate against ca_pem (the kit's CA, NUL-terminated PEM
 *   text) and check that the certificate names host. Send host as SNI too.
 * - Never skip verification: the kit's credentials would go to whoever answers.
 * - Return IOTOS_OK, or IOTOS_E_TRANSPORT for any failure (DNS, TCP, TLS, certificate).
 *   Log the reason your own way: the SDK only sees the status.
 * - Called again for every reconnect, after close(); free what an earlier attempt left.
 */
static iotos_status my_connect(void *ctx, const char *host, uint16_t port, const char *ca_pem,
                               uint32_t timeout_ms)
{
    my_stream *stream = (my_stream *)ctx;
    (void)stream;
    (void)host;
    (void)port;
    (void)ca_pem;
    (void)timeout_ms;
    return IOTOS_E_TRANSPORT; /* TODO */
}

/*
 * Write up to len bytes. Return how many were accepted, which may be fewer than len (the
 * SDK calls again with the rest); 0 if nothing could be sent yet (send buffer full); or a
 * negative value when the connection failed. Block for at most a few seconds.
 */
static int32_t my_send(void *ctx, const uint8_t *data, size_t len)
{
    (void)ctx;
    (void)data;
    (void)len;
    return -1; /* TODO */
}

/*
 * Read up to len bytes. Wait briefly for data (10 to 50 ms), then return 0 if none came:
 * iotos_poll calls this in a loop and must not stall. Partial reads are normal: return
 * any number from 1 to len. Return a negative value when the connection is closed or
 * failed; a TLS close-notify counts as closed.
 */
static int32_t my_recv(void *ctx, uint8_t *data, size_t len)
{
    (void)ctx;
    (void)data;
    (void)len;
    return -1; /* TODO */
}

/* Shut down TLS and the socket. Must be safe to call more than once. */
static void my_close(void *ctx)
{
    (void)ctx; /* TODO */
}

static my_stream stream_state;

/* Designated initialisers keep this compiling when later versions add members. */
const iotos_stream_port my_stream_port = {
    .connect = my_connect,
    .send = my_send,
    .recv = my_recv,
    .close = my_close,
    .ctx = &stream_state,
};
