---
{
  "slug": "profiles",
  "title": "Create and publish device profiles",
  "section": "Device profiles",
  "contexts": [
    "device-profiles",
    "device-profiles.overview"
  ],
  "keywords": [
    "profile",
    "identity",
    "published",
    "draft",
    "revision",
    "model",
    "device type"
  ],
  "required_capabilities": [
    "profiles.view"
  ],
  "revision": 3,
  "summary": "A device profile describes the meaning and behavior of a device’s parameters, calculations, and alarm templates.",
  "questions": [
    "How do I create a reusable device profile?",
    "Does publishing update my devices?",
    "How do I get firmware for this profile?"
  ]
}
---
## Purpose
A device profile describes the meaning and behavior of a device’s parameters, calculations, and alarm templates.

## Before you start
You need profile viewing permission. Creating, editing, and publishing have separate permissions.

## Steps
1. Open **Device profiles**, create or select a profile, and complete its identity in **Overview**.
2. Add the device’s parameters in **Parameters**.
3. Add calculations or alarm templates where needed.
4. Save the draft. Each save is checked automatically.
5. Choose **Publish version** in the profile header, or open **Review** first to see what the version contains.
6. Apply the chosen published revision through each device’s configuration.

To write firmware for a published profile, open **Firmware**, choose the microcontroller or platform and how the device connects, and choose **Download starter**. The starter holds the SDK, this profile’s metrics and instructions for an AI coding agent, and no credentials. A device’s connection settings come from its own page. [Read the firmware guide](/help/firmware).

## Expected result
A published revision can be selected for device configuration. Existing devices do not automatically switch to a newer profile revision.

## Troubleshooting
A draft can be edited but is not the same as a published artifact. Fix blocking diagnostics and review concurrent changes before publishing.

## Related guides
[Read the related guide](/help/profile-review)
