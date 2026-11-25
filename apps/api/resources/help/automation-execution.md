---
{
  "slug": "automation-execution",
  "title": "See what a running automation is doing",
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
    "explain",
    "duration",
    "freshness",
    "history",
    "stale"
  ],
  "required_capabilities": [
    "workflows.view"
  ],
  "revision": 2,
  "summary": "**Execution** says what a deployed automation is doing right now, shows its state over the last hours, and lists what changed, with the evidence for every evaluation.",
  "questions": [
    "Why did an automation not fire?",
    "How do I inspect a command delivery outcome?",
    "How long until a duration is reached?",
    "Why is an automation waiting for a fresh reading?"
  ]
}
---
## Purpose
**Execution** says what a deployed automation is doing right now, shows its state over the last hours, and lists what changed, with the evidence for every evaluation.

## Before you start
The automation must be saved and activated to record evaluations. Viewing requires workflow viewing permission; **Explain this execution** uses the authoring assistant and its additional permissions.

## Steps
1. Open **Execution**. The sentence under **Right now** is the most pressing thing that is true: an alert that is raised, a duration that is counting and when it is due, a reading that is missing, or nothing to do.
2. Read the step cards from left to right. Each shows what that step answered in the latest evaluation; the one marked **Decides** is the step holding the outcome.
3. Use the history bands to see when a switch input changed, when readings were missing and when an alert was raised. Change the period with **6 h**, **24 h** or **7 d**.
4. Under **What changed**, select an event to open that evaluation: each step's inputs and outputs, the deployed version, and how any action was delivered. Evaluations that changed nothing are folded into one line; open it to list them.
5. Check **Is the data arriving?** when an automation waits or fires late. It compares how often the device reports, and how old a reading is when it arrives, with how long the input counts a reading as fresh.
6. Use **Explain this execution** inside an evaluation when available; its evidence links reopen the recorded steps.

## Expected result
You can tell at a glance whether the automation is idle, counting, waiting for data or has acted, and open the recorded evidence for any moment. The evidence always belongs to the version that was deployed then, not to the draft you are editing.

## Troubleshooting
No evaluations may mean the automation is inactive, no relevant reading or timer arrived in the chosen period, or the history has been removed by retention. A gap with no fresh reading pauses a duration; it does not restart it. If gaps are frequent, raise the freshness of the input as the panel suggests. Delivery can progress after an evaluation was recorded, so reopen it to see the latest outcome. Device-reported state does not prove a physical sound or movement.

## Related guides
[Read the related guide](/help/automation-simulation)
