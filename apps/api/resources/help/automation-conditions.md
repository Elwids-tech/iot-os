---
{
  "slug": "automation-conditions",
  "title": "Configure conditions and actions",
  "section": "Automations",
  "contexts": [
    "automation.conditions",
    "automation.actions"
  ],
  "keywords": [
    "condition",
    "action",
    "threshold",
    "missing",
    "unknown",
    "boolean",
    "join",
    "sustained",
    "device state",
    "command grant"
  ],
  "required_capabilities": [
    "workflows.view"
  ],
  "revision": 1,
  "summary": "Condition nodes determine when an action is eligible. Action nodes describe explicit event or command intent.",
  "questions": [
    "What happens when a condition input is missing?",
    "Why was an action suppressed?"
  ]
}
---
## Purpose
Condition nodes determine when an action is eligible. Action nodes describe explicit event or command intent.

## Before you start
Use parameters from applied device configurations and supported nodes. Commands need allowed device settings and grants.

## Steps
1. Connect a source to the condition’s required input.
2. Configure comparisons, boolean logic, timing, or supported device-state checks.
3. Connect the condition to an explicit action.
4. For command actions, choose each setting and value, and check allowed values and grants.
5. Save, validate, and simulate positive, negative, and missing-data cases before activation.

## Expected result
The workflow evaluates the configured inputs and records decisions. An unknown or missing input is distinct from a false condition or a numeric zero.

## Troubleshooting
Check required connections, binding identifiers, state freshness, and action suppression evidence. A command intent does not prove delivery or observed state. Geofence nodes retain their copied geometry until you update the workflow.

## Related guides
[Read the related guide](/help/automation-execution)
