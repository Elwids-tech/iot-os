---
{
  "slug": "discovery",
  "title": "Review discovered sources",
  "section": "Discovery and gateways",
  "contexts": [
    "discovery"
  ],
  "keywords": [
    "discovery",
    "source",
    "Sparkplug",
    "birth",
    "metric",
    "unassigned",
    "mapping",
    "register",
    "bulk"
  ],
  "required_capabilities": [
    "devices.view"
  ],
  "revision": 2,
  "summary": "**Discovery** shows sources and metrics found through connected gateways so you can review them before registration or mapping.",
  "questions": [
    "How do I turn a discovered source into a device?",
    "Why is a source not listed?"
  ]
}
---
## Purpose
**Discovery** shows sources and metrics found through connected gateways so you can review them before registration or mapping.

## Before you start
A gateway must be connected and reporting its source information. Registration requires device management permission.

## Steps
1. Open **Discovery** and inspect a source.
2. Review identifiers, latest connection information, and reported metrics.
3. Decide which published profile describes the source.
4. Register it as a device or associate it with the intended device through its configuration.
5. Review mappings before activation.

To onboard many sources of one gateway with the same profile, filter by that gateway, select the sources (or **Select all N matching**), and choose **Onboard selected**. The [devices guide](/help/devices) has the steps.

## Expected result
The source is associated with the intended device and profile after registration and configuration. Discovery itself does not activate devices; bulk onboarding requests activation for each device it creates, and a device is active once the runtime confirms it.

## Troubleshooting
If a source is absent, check its gateway and whether it has reported a birth/session update. Protocol identifiers describe transport sources, not your business organization structure.

## Related guides
[Read the related guide](/help/gateways)
