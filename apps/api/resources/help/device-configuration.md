---
{
  "slug": "device-configuration",
  "title": "Configure and activate a device",
  "section": "Devices",
  "contexts": [
    "devices.configuration"
  ],
  "keywords": [
    "configuration",
    "mapping",
    "activate",
    "apply",
    "revision",
    "birth metric",
    "source",
    "scale",
    "offset"
  ],
  "required_capabilities": [
    "devices.view"
  ],
  "revision": 1,
  "summary": "Configuration maps incoming metrics to profile parameters and prepares a reviewed revision for the runtime.",
  "questions": [
    "How do I map incoming readings?",
    "Why is activation pending?"
  ]
}
---
## Purpose
Configuration maps incoming metrics to profile parameters and prepares a reviewed revision for the runtime.

## Before you start
Use a published profile and an appropriate discovered source. Editing requires management permission; activation requires activation permission.

## Steps
1. Open the device’s **Configuration** tab.
2. Select its source and inspect the available metrics.
3. Map incoming values to profile parameters; check units and conversions.
4. Save the draft and resolve validation diagnostics.
5. In **Review and apply**, inspect the revision and differences, then confirm activation.
6. Wait for the runtime result and check new readings.

## Expected result
The runtime acknowledges the applied revision. Until acknowledgment, activation remains pending; the prior applied configuration can remain in use.

## Troubleshooting
If a mapping is missing, inspect **Discovery** or **Telemetry viewer** for actual metric names. A profile publication does not automatically apply it to a device. A failed activation needs its diagnostic checked before retrying.

## Related guides
[Read the related guide](/help/profile-parameters)
