---
{
  "slug": "automation-execution",
  "title": "Read the execution timeline",
  "section": "Automations",
  "contexts": [
    "automation.execution"
  ],
  "keywords": [
    "execution",
    "timeline",
    "evaluation",
    "generation",
    "delivery",
    "suppressed",
    "observed",
    "explain"
  ],
  "required_capabilities": [
    "workflows.view"
  ],
  "revision": 1,
  "summary": "**Execution → Execution timeline** records live evaluations, node decisions, and action outcomes for deployed workflows.",
  "questions": [
    "Why did an automation not fire?",
    "How do I inspect a command delivery outcome?"
  ]
}
---
## Purpose
**Execution → Execution timeline** records live evaluations, node decisions, and action outcomes for deployed workflows.

## Before you start
The workflow must be saved and activated to receive live evaluations. Viewing requires workflow viewing permission; **Explain this execution** uses the authoring assistant and its additional permissions.

## Steps
1. Open **Execution** and select an evaluation in **Execution timeline**.
2. Check the deployed generation, revision, time, and telemetry source.
3. Inspect decisive node results and suppression reasons.
4. Follow an action to its delivery status and recorded evidence.
5. Use **Explain this execution** when available; its evidence links reopen the recorded steps.

## Expected result
You can distinguish the editable draft from the deployed version and see why the runtime evaluated or suppressed an action.

## Troubleshooting
No evaluations may mean the workflow is inactive, no relevant telemetry/timer arrived, or the history predates recording. Explanation capture times matter because delivery may progress later. Device-reported state does not prove a physical sound or movement.

## Related guides
[Read the related guide](/help/automation-simulation)
