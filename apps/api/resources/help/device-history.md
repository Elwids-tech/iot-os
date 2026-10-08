---
{
  "slug": "device-history",
  "title": "Inspect measurement history",
  "section": "Devices",
  "contexts": [
    "devices.history"
  ],
  "keywords": [
    "history",
    "past",
    "trend",
    "time range",
    "observations",
    "records",
    "chart",
    "older readings"
  ],
  "required_capabilities": [
    "devices.view"
  ],
  "revision": 1,
  "summary": "History lets you examine committed observations and changes across a selected period.",
  "questions": [
    "Where can I see previous readings?",
    "Why is older data missing?"
  ]
}
---
## Purpose
History lets you examine committed observations and changes across a selected period.

## Before you start
Historical readings must have been stored for the chosen parameter. Retention limits can remove older data.

## Steps
1. Open the device’s **History** tab.
2. Select parameters and a time range.
3. Inspect numeric charts or state changes, then use the records view for individual values and timestamps.
4. Narrow the time range when investigating a particular event.

## Expected result
The view shows stored observations within the selected period; it does not reconstruct readings that were never received or stored.

## Troubleshooting
If history is empty, check the range, parameter, device activation, and measurement timestamps. Raw captures and simulation results are not automatically measurement history.

## Related guides
[Read the related guide](/help/telemetry)
