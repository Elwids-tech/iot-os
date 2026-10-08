---
{
  "slug": "device-measurements",
  "title": "Read current measurements",
  "section": "Devices",
  "contexts": [
    "devices.measurements"
  ],
  "keywords": [
    "measurement",
    "latest",
    "reading",
    "value",
    "unit",
    "timestamp",
    "quality",
    "missing data"
  ],
  "required_capabilities": [
    "devices.view"
  ],
  "revision": 1,
  "summary": "The **Measurements** tab shows the latest available observations for configured parameters.",
  "questions": [
    "Why is a measurement missing?",
    "How do I tell whether a reading is fresh?"
  ]
}
---
## Purpose
The **Measurements** tab shows the latest available observations for configured parameters.

## Before you start
The device needs an applied configuration and incoming data. Viewing requires device viewing permission.

## Steps
1. Open a device and select **Measurements**.
2. Check the parameter, value, unit, quality, and observation time.
3. Compare timestamps with **Last seen** when deciding whether a value is current.
4. Use **History** to inspect earlier observations or changes.

## Expected result
You can identify the latest observed value and when it was recorded. A visible value may be older than the current connection session.

## Troubleshooting
Missing values can result from no incoming sample, an unmapped metric, a validation failure, or an unapplied configuration. A unit label alone does not convert a reading.

## Related guides
[Read the related guide](/help/device-history)
