/* SPDX-License-Identifier: MIT */
/*
 * Template: the MQTT port (level 2) for a UART modem that runs TLS and MQTT itself,
 * annotated for the Quectel BG95 AT command family (spec 026 R5).
 *
 * UNTESTED: no modem has passed the bench with this template yet. Check every command
 * against your modem's MQTT and SSL application notes before relying on it.
 *
 * Sparkplug payloads are binary. The modem must send them by length (AT+QMTPUBEX with an
 * explicit length, not a quoted string) and hand received NCMD/DCMD payloads back intact,
 * by length. If your modem delivers received messages only as text or hex, or cannot take
 * a binary will, use its transparent TLS socket with the byte-stream level instead
 * (stream-template.c): the SDK then runs MQTT itself and the modem only carries bytes.
 *
 * Copy this file into your project, rename the my_ prefix, write my_uart_* for your UART
 * driver, and replace each TODO. Point iotos_ports.mqtt at my_mqtt_port and leave
 * iotos_ports.stream NULL.
 */
#include <stdio.h>
#include <string.h>

#include "iotos/iotos.h"

#define MY_CLIENT 0       /* the modem's MQTT client index */
#define MY_SSL_CONTEXT 2  /* the modem's SSL context for that client */
#define MY_MAX_PUBLISH 4096 /* TODO: the largest AT+QMTPUBEX length your modem accepts */

typedef struct {
    iotos_gateway *gateway; /* set after iotos_init, for iotos_mqtt_inbound */
    void *uart;             /* TODO: your UART handle */
    uint16_t next_id;       /* packet IDs for QoS 1 */
} my_modem;

/*
 * The UART side, written for your driver. my_uart_command sends one AT command (without
 * the trailing CR) and waits up to timeout_ms for the line that starts with expect, such
 * as "+QMTOPEN: 0,", copying it into answer. Any URC that arrives meanwhile, such as
 * +QMTRECV, must still reach my_poll. Returns true when expect arrived before "ERROR".
 */
static bool my_uart_command(my_modem *modem, const char *command, const char *expect, char *answer,
                            size_t answer_size, uint32_t timeout_ms)
{
    (void)modem;
    (void)command;
    (void)expect;
    (void)timeout_ms;
    if (answer_size) {
        answer[0] = '\0';
    }
    return false; /* TODO */
}

/* Writes raw bytes, such as a payload after AT+QMTPUBEX's ">" prompt. */
static bool my_uart_write(my_modem *modem, const uint8_t *data, size_t len)
{
    (void)modem;
    (void)data;
    (void)len;
    return false; /* TODO */
}

/*
 * Connect, with the will. The order matters: configure, then open the network
 * connection, then the MQTT session.
 *   AT+QMTCFG="version",0,4                     MQTT 3.1.1
 *   AT+QMTCFG="ssl",0,1,2                       TLS through SSL context 2
 *   AT+QSSLCFG="sslversion",2,3                 TLS 1.2
 *   AT+QSSLCFG="seclevel",2,1                   verify the broker against the CA
 *   AT+QFUPL="UFS:iotos_ca.pem",<length>        upload opts->ca_pem once, then
 *   AT+QSSLCFG="cacert",2,"UFS:iotos_ca.pem"
 *   AT+QSSLCFG="sni",2,1                        send the host name (and check it, where the
 *                                               modem can; otherwise say so in your risk list)
 *   AT+QMTCFG="keepalive",0,<keepalive_s>
 *   AT+QMTCFG="session",0,<clean_session>
 *   AT+QMTCFG="will",0,1,<will_qos>,<will_retain>,"<will_topic>","<will payload>"
 *       The will is the NDEATH, a binary payload. Check whether your modem takes a will
 *       payload by length; if it only takes a quoted string, it cannot carry Sparkplug's
 *       NDEATH, and this level does not fit: use the byte-stream level.
 *   AT+QMTCFG="recv/mode",0,1,1                 keep received messages in the modem, and
 *                                               report their length (see my_poll)
 *   AT+QMTOPEN=0,"<host>",<port>          ->  +QMTOPEN: 0,0
 *   AT+QMTCONN=0,"<client_id>","<username>","<password>"
 *                                         ->  +QMTCONN: 0,0,<code>; code 4 or 5 means the
 *                                             broker refused the credentials
 * Return IOTOS_OK, IOTOS_E_AUTH for refused credentials, or IOTOS_E_TRANSPORT.
 */
static iotos_status my_connect(void *ctx, const iotos_mqtt_connect *opts)
{
    my_modem *modem = (my_modem *)ctx;
    char command[256];
    char answer[64];
    int result = -1, code = -1;
    snprintf(command, sizeof(command), "AT+QMTCFG=\"keepalive\",%d,%u", MY_CLIENT, (unsigned)opts->keepalive_s);
    if (!my_uart_command(modem, command, "OK", answer, sizeof(answer), 300)) {
        return IOTOS_E_TRANSPORT;
    }
    /* TODO: the version, SSL, CA, session, will and receive-mode commands above. */
    snprintf(command, sizeof(command), "AT+QMTOPEN=%d,\"%s\",%u", MY_CLIENT, opts->host, (unsigned)opts->port);
    if (!my_uart_command(modem, command, "+QMTOPEN:", answer, sizeof(answer), opts->timeout_ms)) {
        return IOTOS_E_TRANSPORT;
    }
    snprintf(command, sizeof(command), "AT+QMTCONN=%d,\"%s\",\"%s\",\"%s\"", MY_CLIENT, opts->client_id,
             opts->username, opts->password);
    if (!my_uart_command(modem, command, "+QMTCONN:", answer, sizeof(answer), opts->timeout_ms)
        || sscanf(answer, "+QMTCONN: %*d,%d,%d", &result, &code) != 2) {
        return IOTOS_E_TRANSPORT;
    }
    if (code == 4 || code == 5) {
        return IOTOS_E_AUTH;
    }
    return result == 0 && code == 0 ? IOTOS_OK : IOTOS_E_TRANSPORT;
}

/*
 * Publish by length, so a binary payload passes through unchanged:
 *   AT+QMTPUBEX=0,<msgid>,<qos>,<retain>,"<topic>",<length>   ->  ">"
 *   <length raw bytes>                                         ->  +QMTPUBEX: 0,<msgid>,0
 * msgid is 0 for QoS 0. Return IOTOS_OK, or IOTOS_E_TRANSPORT.
 */
static iotos_status my_publish(void *ctx, const char *topic, const uint8_t *data, size_t len, uint8_t qos,
                               bool retain)
{
    my_modem *modem = (my_modem *)ctx;
    char command[200];
    char answer[64];
    unsigned id = qos ? ++modem->next_id : 0u;
    snprintf(command, sizeof(command), "AT+QMTPUBEX=%d,%u,%u,%d,\"%s\",%u", MY_CLIENT, id, (unsigned)qos,
             retain ? 1 : 0, topic, (unsigned)len);
    if (!my_uart_command(modem, command, ">", answer, sizeof(answer), 1000) || !my_uart_write(modem, data, len)
        || !my_uart_command(modem, "", "+QMTPUBEX:", answer, sizeof(answer), 5000)) {
        return IOTOS_E_TRANSPORT;
    }
    return IOTOS_OK;
}

/*
 *   AT+QMTSUB=0,<msgid>,"<filter>",<qos>   ->  +QMTSUB: 0,<msgid>,0,<granted qos>
 */
static iotos_status my_subscribe(void *ctx, const char *filter, uint8_t qos)
{
    my_modem *modem = (my_modem *)ctx;
    char command[200];
    char answer[64];
    snprintf(command, sizeof(command), "AT+QMTSUB=%d,%u,\"%s\",%u", MY_CLIENT, (unsigned)++modem->next_id, filter,
             (unsigned)qos);
    return my_uart_command(modem, command, "+QMTSUB:", answer, sizeof(answer), 5000) ? IOTOS_OK : IOTOS_E_TRANSPORT;
}

/*
 * Handle the modem for up to budget_ms:
 * - +QMTRECV: 0,<store index>   a message is waiting. Read it with AT+QMTRECV=0,<index>;
 *   the answer names the topic and the payload length, so read exactly that many bytes,
 *   never up to a line end (a binary payload may hold CR and LF). Then call
 *   iotos_mqtt_inbound(modem->gateway, topic, payload, length, false).
 * - +QMTSTAT: 0,<error>          the session is gone: return IOTOS_E_TRANSPORT, and the SDK
 *   reconnects.
 * The clock port of a modem build usually asks the modem for the time: AT+QLTS=1 (UTC from
 * the network) or AT+CCLK?, and AT+QNTP where the network sends no time.
 */
static iotos_status my_poll(void *ctx, uint32_t budget_ms)
{
    my_modem *modem = (my_modem *)ctx;
    (void)budget_ms;
    if (!modem->gateway) {
        return IOTOS_E_TRANSPORT;
    }
    return IOTOS_OK; /* TODO */
}

/*   AT+QMTDISC=0, then AT+QMTCLOSE=0 if the network connection stays open. */
static void my_disconnect(void *ctx)
{
    my_modem *modem = (my_modem *)ctx;
    char answer[64];
    (void)my_uart_command(modem, "AT+QMTDISC=0", "+QMTDISC:", answer, sizeof(answer), 3000);
}

static my_modem my_modem_state;

const iotos_mqtt_port my_mqtt_port = {
    .connect = my_connect,
    .publish = my_publish,
    .subscribe = my_subscribe,
    .poll = my_poll,
    .disconnect = my_disconnect,
    .max_payload = MY_MAX_PUBLISH,
    .ctx = &my_modem_state,
};
