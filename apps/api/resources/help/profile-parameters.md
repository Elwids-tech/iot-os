---
{
  "slug": "profile-parameters",
  "title": "Define parameters and unit conversions",
  "section": "Device profiles",
  "contexts": [
    "device-profiles.parameters",
    "device-profiles.parameters.basics",
    "device-profiles.parameters.behavior",
    "device-profiles.parameters.validation",
    "device-profiles.parameters.advanced"
  ],
  "keywords": [
    "parameter",
    "unit",
    "conversion",
    "Celsius",
    "Fahrenheit",
    "multiplier",
    "offset",
    "reported",
    "writable",
    "validation"
  ],
  "required_capabilities": [
    "profiles.view"
  ],
  "revision": 1,
  "summary": "Parameters give incoming values meaningful names, types, units, validation rules, and optional writable behavior.",
  "questions": [
    "How do I convert incoming units?",
    "What is the difference between reported and writable?"
  ]
}
---
## Purpose
Parameters give incoming values meaningful names, types, units, validation rules, and optional writable behavior.

## Before you start
Know the incoming data type and unit. Do not assume a device can accept a command merely because it reports a value.

## Steps
1. Open **Parameters** and add or edit a parameter.
2. In **Basics**, choose its key, label, kind, data type, and unit.
3. In **Behavior**, describe supported reporting or writable behavior.
4. Use **Validation** for appropriate bounds and checks; use **Advanced** only for needed advanced settings.
5. For a numeric read-only measurement or counter, configure incoming conversion when needed. Stored value = incoming value × multiplier + offset.
6. Check a sample input/output, save, and validate.

## Expected result
The saved definition explains how to interpret and validate values. Conversion changes stored numeric values; a unit label alone only names the unit.

## Troubleshooting
Incorrect readings can come from confusing incoming and stored units or applying a conversion twice. Verify an actual sample. Read-only parameters cannot be used as writable commands.

## Related guides
[Read the related guide](/help/device-configuration)
