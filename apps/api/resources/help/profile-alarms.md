---
{
  "slug": "profile-alarms",
  "title": "Configure alarm templates",
  "section": "Device profiles",
  "contexts": [
    "device-profiles.alarms"
  ],
  "keywords": [
    "alarm template",
    "alarm",
    "threshold",
    "condition",
    "parameter",
    "profile"
  ],
  "required_capabilities": [
    "profiles.view"
  ],
  "revision": 1,
  "summary": "**Alarm templates** describe profile-level alarm behavior for devices using that profile.",
  "questions": [
    "How do I add an alarm template?",
    "Does reporting freshness create an offline alarm?"
  ]
}
---
## Purpose
**Alarm templates** describe profile-level alarm behavior for devices using that profile.

## Before you start
Choose suitable parameters and supported alarm behavior. Editing requires profile update permission.

## Steps
1. Open **Alarm templates** in the profile.
2. Select the relevant parameter and supported condition.
3. Fill in the condition settings and clear/recovery behavior shown by the form.
4. Save and validate the draft.
5. Review and publish, then apply the profile configuration to the intended devices.

## Expected result
The published template is part of the chosen profile revision. Live alert records are inspected in **Alerts** after the configuration is applied and evaluated.

## Troubleshooting
Expected reporting freshness does not automatically create an offline alarm. A saved template is not evidence that a live condition has occurred.

## Related guides
[Read the related guide](/help/alerts)
