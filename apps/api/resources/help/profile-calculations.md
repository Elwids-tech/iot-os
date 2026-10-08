---
{
  "slug": "profile-calculations",
  "title": "Create derived calculations",
  "section": "Device profiles",
  "contexts": [
    "device-profiles.calculations"
  ],
  "keywords": [
    "calculation",
    "formula",
    "derived",
    "input",
    "output",
    "expression",
    "compute",
    "multiply"
  ],
  "required_capabilities": [
    "profiles.view"
  ],
  "revision": 1,
  "summary": "Calculations derive an output from named parameters, such as converting or combining stored readings.",
  "questions": [
    "How do I create a calculated reading?",
    "Why does my formula have no output?"
  ]
}
---
## Purpose
Calculations derive an output from named parameters, such as converting or combining stored readings.

## Before you start
Define input parameters first and know their stored units. Editing calculations requires profile update permission.

## Steps
1. Open **Calculations** and add a calculation.
2. Choose existing inputs and identify the output parameter.
3. Use the supported builder to define the expression and behavior, or **Advanced JSON** when appropriate.
4. Test sample inputs and inspect output and diagnostics.
5. Save, validate, publish, and apply the new configuration to devices.

## Expected result
A validated calculation becomes part of an applied device configuration and produces derived readings when its configured trigger runs.

## Troubleshooting
A missing input is not automatically zero. Check input identifiers, types, units, trigger, and failure policy. Incoming conversion and a derived calculation serve different purposes; avoid converting twice.

## Related guides
[Read the related guide](/help/profile-parameters)
