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
    "command grant",
    "freshness",
    "stale",
    "offline after",
    "no data",
    "silence"
  ],
  "required_capabilities": [
    "workflows.view"
  ],
  "revision": 2,
  "summary": "Condition nodes determine when an action is eligible. Action nodes describe explicit event or command intent.",
  "questions": [
    "What happens when a condition input is missing?",
    "Why was an action suppressed?",
    "Is freshness the same as Offline after?"
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

## Freshness and Offline after
A binding’s **freshness** says how old a reading may be when the automation uses it, counted from when the reading was taken. After that the value is unknown, and unknown never starts or clears an alert. A device’s **Offline after** is a different setting with a different clock: how long the device may be silent, counted from when the platform received its last report, before it raises an offline alert. The editor’s freshness default does not use Offline after.

You do not need an automation to know when a device stops reporting: offline alerts watch every active device ([read the alerts guide](/help/alerts#offline-alerts)). One value going quiet while the device keeps reporting, or an automation action when a device falls silent, needs a **No data** condition, which is not available yet.

## Troubleshooting
Check required connections, binding identifiers, state freshness, and action suppression evidence. A command intent does not prove delivery or observed state. Geofence nodes retain their copied geometry until you update the workflow.

## Related guides
[Read the related guide](/help/automation-execution)
