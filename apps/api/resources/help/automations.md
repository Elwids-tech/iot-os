---
{
  "slug": "automations",
  "title": "Build and activate automations",
  "section": "Automations",
  "contexts": [
    "automation",
    "automation.editor"
  ],
  "keywords": [
    "automation",
    "workflow",
    "rule",
    "node",
    "edge",
    "condition",
    "action",
    "activation",
    "draft"
  ],
  "required_capabilities": [
    "workflows.view"
  ],
  "revision": 1,
  "summary": "Automations connect telemetry conditions to explicit actions using a visual workflow. Simulation and execution evidence help you check behavior.",
  "questions": [
    "How do I build a rule from device data?",
    "Why is my saved workflow not running?"
  ]
}
---
## Purpose
Automations connect telemetry conditions to explicit actions using a visual workflow. Simulation and execution evidence help you check behavior.

## Before you start
The organization must have automation enabled. Viewing requires workflow viewing permission; editing and activation have separate capabilities. Command actions also require command grants.

## Steps
1. Open **Automations** and choose **Create automation** or an existing workflow.
2. In **Editor**, select devices and connect supported source, condition, and action nodes.
3. Configure each node and save the draft.
4. Use **Simulation** to check the saved revision.
5. Select **Activate**, review the device commands it may send, then confirm. Command authorization has no expiry unless you turn on **Limit command authorization**.
6. Later edits: **Save and apply** saves and applies them in one step; **Save draft** keeps them without changing what runs.
7. Wait for acknowledgment and inspect **Execution** for recorded evaluations.

## Expected result
A saved draft is separate from the deployed generation. New evaluations use the acknowledged deployed version.

## Troubleshooting
Unconnected inputs, unavailable device settings, or missing command grants can block validation or activation. Layout edits do not establish execution behavior. **Stop all automation actions**, under **Emergency stop** at the bottom of **Automations**, asks for confirmation and then stops new action dispatch; already dispatched commands may still arrive.

## Related guides
[Read the related guide](/help/automation-simulation)
