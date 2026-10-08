---
{
  "slug": "device-commands",
  "title": "Review and track commands",
  "section": "Devices",
  "contexts": [
    "devices.commands"
  ],
  "keywords": [
    "command",
    "prepare",
    "confirm",
    "acknowledge",
    "completed",
    "failed",
    "timeout",
    "send"
  ],
  "required_capabilities": [
    "devices.view"
  ],
  "revision": 1,
  "summary": "The **Commands** tab provides a prepared and confirmed workflow for state-setting requests, with delivery history.",
  "questions": [
    "How do I send a confirmed command?",
    "What is the difference between prepared and completed?"
  ]
}
---
## Purpose
The **Commands** tab provides a prepared and confirmed workflow for state-setting requests, with delivery history.

## Before you start
Commands require device command permission, a supported writable setting, and an applied device configuration.

## Steps
1. Open **Commands** and prepare a request for an allowed setting.
2. Review the device, setting, requested value, and confirmation details.
3. Confirm the prepared command explicitly.
4. Track its status and completion evidence in command history.

## Expected result
Confirmation authorizes dispatch. Transport delivery, device acknowledgment, and observed state are separate stages; inspect the recorded result.

## Troubleshooting
A prepared command has not been sent. A failed or timed-out request needs its diagnostic checked before another request. A command response does not prove a physical actuator moved.

## Related guides
[Read the related guide](/help/device-controls)
