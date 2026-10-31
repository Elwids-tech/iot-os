---
{
  "slug": "devices",
  "title": "Register and monitor devices",
  "section": "Devices",
  "contexts": [
    "devices",
    "devices.overview"
  ],
  "keywords": [
    "device",
    "register",
    "onboard",
    "status",
    "online",
    "offline",
    "last seen",
    "lifecycle",
    "archived",
    "filter"
  ],
  "required_capabilities": [
    "devices.view"
  ],
  "revision": 2,
  "summary": "A registered device connects a discovered source to a published profile and an organization-owned configuration.",
  "questions": [
    "How do I register a device?",
    "What does offline mean?",
    "Where are my archived devices?"
  ]
}
---
## Purpose
A registered device connects a discovered source to a published profile and an organization-owned configuration.

## Before you start
Viewing requires device viewing permission. Registration and editing require device management permission; activation uses a separate permission.

## Steps
1. Open **Devices** and choose **Register device**.
2. Supply its identity and select a published device profile.
3. Choose the appropriate source when available.
4. Open **Configuration** to map the source values to profile parameters.
5. Review and activate, then inspect **Overview**, **Measurements**, and **History**.

## Expected result
The directory shows one status per device, from its lifecycle, configuration and presence. The device workspace provides applied configuration and latest data.

**Filters** narrows the list by status (such as Online or Offline), lifecycle, profile and site. Archived devices are hidden by default; the list footer says how many, and **Show** (or Lifecycle **All**) includes them.

## Troubleshooting
Presence and lifecycle answer different questions: a registered or active device may currently be offline. Check **Last seen**, its gateway connection, and the applied configuration. Registration does not automatically activate every draft.

## Related guides
[Read the related guide](/help/device-configuration)
