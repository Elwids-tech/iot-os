---
{
  "slug": "device-controls",
  "title": "Change a writable device setting",
  "section": "Devices",
  "contexts": [
    "devices.controls"
  ],
  "keywords": [
    "controls",
    "writable",
    "RGB",
    "colour",
    "setting",
    "switch",
    "slider",
    "desired",
    "observed"
  ],
  "required_capabilities": [
    "devices.view"
  ],
  "revision": 1,
  "summary": "The **Controls** tab offers supported controls for writable parameters from the applied device configuration.",
  "questions": [
    "How do I change a device setting?",
    "Why is a control unavailable?"
  ]
}
---
## Purpose
The **Controls** tab offers supported controls for writable parameters from the applied device configuration.

## Before you start
You need device command permission and an applied configuration with supported writable settings. The device and transport must support the requested command.

## Steps
1. Open **Controls** and find the setting.
2. Check its allowed values, unit, and current observed state.
3. Choose the requested value and submit it using the control.
4. Inspect the command status and the subsequently reported state.

## Expected result
A request records a desired setting. A later reported state may confirm the device’s value, but a submitted request alone is not device confirmation.

## Troubleshooting
A missing control may mean the parameter is read-only or unsupported. Offline transport, a disabled command capability, or an invalid value can prevent completion. A matching value cannot prove a physical sound or motion occurred.

## Related guides
[Read the related guide](/help/device-commands)
