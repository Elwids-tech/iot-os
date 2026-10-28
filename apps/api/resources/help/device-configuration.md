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
  "revision": 2,
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
2. Choose the profile revision and the discovered source.
3. Check the parameter mappings. When every parameter has a source metric with the same name and a compatible type, those matches are selected for you; choose **Review** to see them. **Convert units** appears on a row only when the source may need a conversion.
4. Choose **Apply**. It saves the draft, checks it against the source’s captured samples and applies it. Problems stop it before anything is applied and show on their rows. Use **Save draft** to keep partial work.
5. Wait for the runtime result and check new readings.

## Expected result
The runtime acknowledges the applied revision. Until acknowledgment, activation remains pending; the prior applied configuration can remain in use.

## Troubleshooting
If a mapping is missing, inspect **Discovery** or **Telemetry viewer** for actual metric names. A profile publication does not automatically apply it to a device. A failed activation needs its diagnostic checked before retrying.

## Related guides
[Read the related guide](/help/profile-parameters)
