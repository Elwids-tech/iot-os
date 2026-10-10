---
{
  "slug": "alerts",
  "title": "Review and respond to alerts",
  "section": "Alerts",
  "contexts": [
    "alerts",
    "alerts.detail",
    "alerts.events",
    "alerts.preferences"
  ],
  "keywords": [
    "alert",
    "active",
    "cleared",
    "acknowledge",
    "bulk acknowledge",
    "repeats",
    "occurrence",
    "assignee",
    "assign",
    "comment",
    "condition",
    "event log",
    "email preferences",
    "notification"
  ],
  "required_capabilities": [
    "devices.view"
  ],
  "revision": 2,
  "summary": "**Alerts** records live conditions and the team’s response, including acknowledgment, assignment, and comments. Its Event log and Email preferences tabs replace the notification center.",
  "questions": [
    "Does acknowledging an alert clear it?",
    "How do I assign an alert to a colleague?",
    "How do I acknowledge repeated alerts at once?"
  ]
}
---
## Purpose
**Alerts** records live conditions and the team’s response, including acknowledgment, assignment, and comments. The **Event log** tab lists workflow, service monitoring, and host watchdog events, and **Email preferences** controls which of them reach your inbox.

## Before you start
Viewing requires device viewing permission. Response actions require their respective device management capabilities. Email preferences are personal and apply across your organizations.

## Steps
1. Open **Alerts**. It shows active alerts first; choose **Cleared** or **All** for history, and filter by acknowledgment, device, or workflow.
2. Repeats of one workflow on one device are grouped with their occurrence count. Choose **Individual** to list every occurrence.
3. Select an alert to inspect its source, timestamps, evidence, current condition, and the other occurrences of its source.
4. Acknowledge it when you have seen it and assign a responsible member where appropriate. To acknowledge several at once, tick them and choose **Acknowledge selected**, or use **Acknowledge all cleared** in an alert’s occurrences.
5. Add a comment with your findings.
6. Continue checking the condition until the source reports it cleared.

## Expected result
Acknowledgment records that someone saw the alert; assignment records responsibility. Neither automatically clears its underlying condition. Acknowledging in bulk skips alerts that are already acknowledged.

## Troubleshooting
If an alert remains active after acknowledgment, inspect the latest condition evidence. Notification delivery is separate from the alert record. Check **Email preferences** and the workflow’s notification settings when recipients do not receive an update.

## Related guides
[Read the related guide](/help/alert-notifications)
