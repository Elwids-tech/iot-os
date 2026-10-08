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
    "last seen"
  ],
  "required_capabilities": [
    "devices.view"
  ],
  "revision": 1,
  "summary": "**Gateways** shows the transport sources that connect devices and report session or presence information.",
  "questions": [
    "How do I find the gateway for a device?",
    "Why is a device offline when its gateway is connected?"
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

## Expected result
You can determine which gateway supplies a source and whether the platform has recently seen activity.

## Troubleshooting
A connected gateway can have an offline downstream device. A device’s own readings and presence must be checked separately. Ask the connection administrator when transport credentials or connectivity need attention.

## Related guides
[Read the related guide](/help/discovery)
