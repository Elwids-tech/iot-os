---
{
  "slug": "telemetry",
  "title": "Inspect incoming telemetry",
  "section": "Telemetry",
  "contexts": [
    "telemetry",
    "telemetry.live",
    "telemetry.processing",
    "telemetry.troubleshoot"
  ],
  "keywords": [
    "telemetry",
    "raw",
    "packet",
    "payload",
    "metric",
    "capture",
    "processing",
    "missing",
    "stored",
    "binary"
  ],
  "required_capabilities": [
    "devices.view",
    "devices.manage"
  ],
  "revision": 1,
  "summary": "**Telemetry viewer** captures a short diagnostic window and compares decoded incoming values with processing and storage evidence.",
  "questions": [
    "Why did an incoming value not become a reading?",
    "Does pausing the view stop capture?"
  ]
}
---
## Purpose
**Telemetry viewer** captures a short diagnostic window and compares decoded incoming values with processing and storage evidence.

## Before you start
You need device viewing and management permissions. Choose a gateway and optionally an onboarded device. Captures are temporary, not a historical archive.

## Steps
1. Open **Telemetry viewer**, choose a gateway, and start a 1, 5, or 10 minute capture.
2. In **Live stream**, filter topics, metrics, values, or message types and select a packet.
3. Use **Processing stages** to inspect mappings, conversion, validation, derived readings, and persistence.
4. **Pause view** freezes the list while capture continues; **Follow newest** returns to recent packets.
5. Use **AI troubleshoot** only when you want the selected sample and processing evidence explained. Export JSON if you need to retain evidence.

## Expected result
You can compare the received metric with its processing result. **stored** means the observation/diagnostic transaction committed; decoding alone does not prove storage.

## Troubleshooting
**pending** is a handoff in progress, **storage_retry** is a retryable storage failure, and **discarded** means storage did not accept the batch. Raw here means received by the platform; it cannot reconstruct values before gateway-side processing. Captures expire and old messages leave the buffer.

## Related guides
[Read the related guide](/help/device-measurements)
