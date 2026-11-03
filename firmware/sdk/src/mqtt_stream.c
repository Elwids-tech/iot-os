/* SPDX-License-Identifier: MIT */
/*
 * MQTT 3.1.1 over the integrator's byte stream, using coreMQTT. The client's context
 * lives in iotos_gateway.mqtt_context and its fixed buffer is the gateway's receive
 * buffer, so nothing here is static.
 */
#include <stddef.h>
#include <string.h>

#include "core_mqtt.h"
#include "internal.h"

/* C99 static assertion: the reserved words must hold coreMQTT's context. */
typedef char iotos__mqtt_context_fits[sizeof(MQTTContext_t) <= sizeof(((iotos_gateway *)0)->mqtt_context) ? 1 : -1];

static MQTTContext_t *context(iotos_gateway *gw)
{
    return (MQTTContext_t *)(void *)gw->mqtt_context;
}

static iotos_gateway *owner(MQTTContext_t *mqtt)
{
    return (iotos_gateway *)(void *)((char *)mqtt - offsetof(iotos_gateway, mqtt_context));
}

/* coreMQTT's network context is the gateway itself; it is only ever cast back. */
static iotos_gateway *network_owner(NetworkContext_t *network)
{
    return (iotos_gateway *)(void *)network;
}

static int32_t transport_send(NetworkContext_t *network, const void *data, size_t length)
{
    iotos_gateway *gw = network_owner(network);
    return gw->stream.send(gw->stream.ctx, (const uint8_t *)data, length);
}

static int32_t transport_recv(NetworkContext_t *network, void *data, size_t length)
{
    iotos_gateway *gw = network_owner(network);
    int32_t got = gw->stream.recv(gw->stream.ctx, (uint8_t *)data, length);
    if (got > 0) {
        gw->received = true;
    }
    return got;
}

static void on_packet(MQTTContext_t *mqtt, MQTTPacketInfo_t *packet, MQTTDeserializedInfo_t *info)
{
    iotos_gateway *gw = owner(mqtt);
    if ((packet->type & 0xF0u) == MQTT_PACKET_TYPE_PUBLISH && info->pPublishInfo) {
        const MQTTPublishInfo_t *publish = info->pPublishInfo;
        iotos__inbound(gw, publish->pTopicName, publish->topicNameLength,
                       (const uint8_t *)publish->pPayload, publish->payloadLength, publish->retain);
    } else if (packet->type == MQTT_PACKET_TYPE_SUBACK) {
        uint8_t *codes = NULL;
        size_t count = 0;
        if (MQTT_GetSubAckStatusCodes(packet, &codes, &count) == MQTTSuccess) {
            for (size_t i = 0; i < count; i++) {
                if (codes[i] == 0x80u) {
                    iotos__log(gw, IOTOS_LOG_ERROR, "The broker refused a subscription. ",
                               "Check that the gateway's broker access is applied.", NULL, NULL);
                }
            }
        }
    }
}

iotos_status iotos__stream_connect(iotos_gateway *gw, const char *will_topic, const uint8_t *will,
                                   size_t will_length)
{
    const iotos_settings *s = gw->settings;
    TransportInterface_t transport;
    MQTTFixedBuffer_t buffer;
    MQTTConnectInfo_t info;
    MQTTPublishInfo_t last_will;
    MQTTStatus_t result;
    bool session_present = false;
    uint32_t started = iotos__mono(gw), spent;
    iotos_status status = gw->stream.connect(gw->stream.ctx, s->broker_host, s->broker_port, s->ca_pem,
                                             IOTOS_CONNECT_TIMEOUT_MS);
    if (status != IOTOS_OK) {
        return status == IOTOS_E_AUTH ? IOTOS_E_AUTH : IOTOS_E_TRANSPORT;
    }
    /* TCP, TLS and CONNACK share one budget. */
    spent = iotos__mono(gw) - started;
    if (spent >= IOTOS_CONNECT_TIMEOUT_MS) {
        gw->stream.close(gw->stream.ctx);
        return IOTOS_E_TRANSPORT;
    }

    memset(&transport, 0, sizeof(transport));
    transport.pNetworkContext = (NetworkContext_t *)(void *)gw;
    transport.send = transport_send;
    transport.recv = transport_recv;
    buffer.pBuffer = gw->rx;
    buffer.size = sizeof(gw->rx);
    memset(context(gw), 0, sizeof(MQTTContext_t));
    if (MQTT_Init(context(gw), &transport, gw->clock.monotonic_ms, on_packet, &buffer) != MQTTSuccess) {
        gw->stream.close(gw->stream.ctx);
        return IOTOS_E_TRANSPORT;
    }

    memset(&info, 0, sizeof(info));
    info.cleanSession = true;
    info.keepAliveSeconds = IOTOS_KEEPALIVE_S;
    info.pClientIdentifier = s->username;
    info.clientIdentifierLength = (uint16_t)strlen(s->username);
    info.pUserName = s->username;
    info.userNameLength = (uint16_t)strlen(s->username);
    info.pPassword = s->password;
    info.passwordLength = (uint16_t)strlen(s->password);

    memset(&last_will, 0, sizeof(last_will));
    last_will.qos = MQTTQoS1;
    last_will.retain = false;
    last_will.pTopicName = will_topic;
    last_will.topicNameLength = (uint16_t)strlen(will_topic);
    last_will.pPayload = will;
    last_will.payloadLength = will_length;

    result = MQTT_Connect(context(gw), &info, &last_will, IOTOS_CONNECT_TIMEOUT_MS - spent, &session_present);
    if (result == MQTTSuccess) {
        return IOTOS_OK;
    }
    gw->stream.close(gw->stream.ctx);
    /* The refused CONNACK is still in the buffer: byte 1 is its return code. 4 and 5
     * are bad credentials and not authorised. */
    if (result == MQTTServerRefused && (gw->rx[1] == 4u || gw->rx[1] == 5u)) {
        return IOTOS_E_AUTH;
    }
    return IOTOS_E_TRANSPORT;
}

iotos_status iotos__stream_subscribe(iotos_gateway *gw, const char *filter)
{
    MQTTSubscribeInfo_t subscription;
    subscription.qos = MQTTQoS0;
    subscription.pTopicFilter = filter;
    subscription.topicFilterLength = (uint16_t)strlen(filter);
    return MQTT_Subscribe(context(gw), &subscription, 1, MQTT_GetPacketId(context(gw))) == MQTTSuccess
               ? IOTOS_OK : IOTOS_E_TRANSPORT;
}

iotos_status iotos__stream_publish(iotos_gateway *gw, const char *topic, const uint8_t *data,
                                   size_t length)
{
    MQTTPublishInfo_t publish;
    memset(&publish, 0, sizeof(publish));
    publish.qos = MQTTQoS0;
    publish.pTopicName = topic;
    publish.topicNameLength = (uint16_t)strlen(topic);
    publish.pPayload = data;
    publish.payloadLength = length;
    return MQTT_Publish(context(gw), &publish, 0) == MQTTSuccess ? IOTOS_OK : IOTOS_E_TRANSPORT;
}

iotos_status iotos__stream_poll(iotos_gateway *gw, uint32_t deadline)
{
    do {
        MQTTStatus_t result;
        gw->received = false;
        result = MQTT_ProcessLoop(context(gw));
        if (!gw->connected) {
            return IOTOS_E_TRANSPORT; /* lost while handling a message */
        }
        if (result == MQTTNeedMoreBytes) {
            return IOTOS_OK;
        }
        if (result != MQTTSuccess && result != MQTTNoDataAvailable) {
            return IOTOS_E_TRANSPORT;
        }
        /* coreMQTT reports an idle socket as success: stop once nothing arrived and
         * nothing is left in the buffer. */
        if (!gw->received && context(gw)->index == 0) {
            return IOTOS_OK;
        }
    } while (!iotos__due(iotos__mono(gw), deadline));
    return IOTOS_OK;
}

void iotos__stream_close(iotos_gateway *gw, bool graceful)
{
    if (graceful && gw->in_inbound) {
        /* Inside coreMQTT's receive callback (iotos_stop from on_command):
         * MQTT_Disconnect would reset the buffer the callback is still reading, so
         * send the two-byte DISCONNECT directly. */
        static const uint8_t disconnect[2] = {0xE0u, 0x00u};
        (void)gw->stream.send(gw->stream.ctx, disconnect, sizeof(disconnect));
    } else if (graceful) {
        (void)MQTT_Disconnect(context(gw));
    }
    gw->stream.close(gw->stream.ctx);
}
