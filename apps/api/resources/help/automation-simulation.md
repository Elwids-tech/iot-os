---
{
  "slug": "automation-simulation",
  "title": "Simulate a saved workflow",
  "section": "Automations",
  "contexts": [
    "automation.simulation",
    "automation.scenarios"
  ],
  "keywords": [
    "simulate",
    "simulation",
    "scenario",
    "test",
    "saved revision",
    "sample",
    "preview",
    "dry run"
  ],
  "required_capabilities": [
    "workflows.view"
  ],
  "revision": 1,
  "summary": "**Simulation** evaluates supplied samples against a saved workflow revision without proving real-world delivery.",
  "questions": [
    "How do I test a rule before activation?",
    "Does simulation send real commands?"
  ]
}
---
## Purpose
**Simulation** evaluates supplied samples against a saved workflow revision without proving real-world delivery.

## Before you start
Save the intended workflow first. Provide realistic device inputs, timestamps, and missing-data cases.

## Steps
1. Open **Simulation**. The canvas stays visible and the **Simulation** panel docks beside it.
2. Supply representative inputs. For a geofence, click the map to set latitude and longitude together; values start at the boundary centre.
3. Select **Run simulation**, then inspect the highlighted nodes, per-node results and requested or suppressed actions. Switch between the summary and individual steps.
4. Use **Saved test scenarios** to retain repeatable test inputs where available.
5. Test threshold crossings, recovery, missing samples, and timing gaps.
6. Review activation separately when results match your intent.

## Expected result
You get simulation evidence for the selected saved revision. The workflow is not activated and a simulated command result is not device confirmation.

## Troubleshooting
If results differ from your editor, save the editor first and check the simulated revision. Passing one sample does not cover transitions, timers, or a physical device’s behavior.

## Related guides
[Read the related guide](/help/automation-execution)
