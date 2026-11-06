---
{
  "slug": "gateways",
  "title": "Understand gateway connections",
  "section": "Discovery and gateways",
  "contexts": [
    "gateways"
  ],
  "keywords": [
    "gateway",
    "connection",
    "connected",
    "disconnected",
    "session",
    "edge node",
    "broker",
    "last seen",
    "gateway offline",
    "offline alert",
    "death certificate"
  ],
  "required_capabilities": [
    "devices.view"
  ],
  "revision": 3,
  "summary": "**Gateways** shows the transport sources that connect devices and report session or presence information.",
  "questions": [
    "How do I find the gateway for a device?",
    "Why is a device offline when its gateway is connected?",
    "Where do I get firmware and connection settings for a gateway?",
    "What happens when a gateway goes offline?"
  ]
}
---
## Purpose
**Gateways** shows the transport sources that connect devices and report session or presence information.

## Before you start
Viewing requires device viewing permission. Connection management requires the relevant connection-management permission.

## Steps
1. Open **Gateways** and find the gateway for the device.
2. Check connection/session status and latest activity.
3. Compare the gateway identifiers with **Discovery** and the device’s selected source.
4. If data stops arriving, check the gateway and device status before changing mappings.
5. To write the gateway’s firmware, choose **Firmware** on its page. Pick its health profile, the device types it reads and a microcontroller or platform, then download a starter. With connection-management permission, the same dialog gives the gateway’s connection settings or a full kit with them in place. [Read the firmware guide](/help/firmware).

## Expected result
You can determine which gateway supplies a source and whether the platform has recently seen activity.

When a gateway with two or more active devices goes offline, by announcing it or by falling silent together with all of its devices, one **Gateway offline** alert opens after 2 minutes and lists its devices, instead of one alert per device. The gateway’s page shows the open alert, and its devices show “offline because gateway *name* is offline”. When the gateway returns and stays back for 2 minutes, the alert clears; a device that still does not report then gets its own alert once its own **Offline after** has passed. [Read the alerts guide](/help/alerts#offline-alerts).

## Troubleshooting
A connected gateway can have an offline downstream device. A device’s own readings and presence must be checked separately: a device that stops reporting behind a live gateway gets its own **Device offline** alert with the cause “missed check-in”. A gateway with only one active device is treated as that device, so its alert reads **Device offline**. Ask the connection administrator when transport credentials or connectivity need attention; without connection-management permission, **Firmware** offers only the starter.

## Related guides
[Read the related guide](/help/discovery)
