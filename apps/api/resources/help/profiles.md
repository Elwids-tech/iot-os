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
  "revision": 1,
  "summary": "A device profile describes the meaning and behavior of a device’s parameters, calculations, and alarm templates.",
  "questions": [
    "How do I create a reusable device profile?",
    "Does publishing update my devices?"
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
4. Save and validate the draft.
5. Open **Review and publish** to inspect and publish a revision.
6. Apply the chosen published revision through each device’s configuration.

## Expected result
A published revision can be selected for device configuration. Existing devices do not automatically switch to a newer profile revision.

## Troubleshooting
A draft can be edited but is not the same as a published artifact. Fix blocking diagnostics and review concurrent changes before publishing.

## Related guides
[Read the related guide](/help/profile-review)
