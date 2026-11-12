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
    "notification",
    "bell",
    "sound",
    "chime",
    "unread",
    "offline",
    "device offline",
    "gateway offline",
    "missed check-in",
    "death certificate",
    "offline after",
    "kind"
  ],
  "required_capabilities": [
    "devices.view"
  ],
  "revision": 4,
  "summary": "**Alerts** records live conditions and the team’s response, including acknowledgment, assignment, and comments. It lists automation alerts and the offline alerts the platform raises by itself. Its Event log and Email preferences tabs replace the notification center.",
  "questions": [
    "Does acknowledging an alert clear it?",
    "How do I assign an alert to a colleague?",
    "How do I acknowledge repeated alerts at once?",
    "Why did the alert bell not play a sound?",
    "Why did a device offline alert open?",
    "Why did nobody get an email for an offline alert?"
  ]
}
---
## Purpose
**Alerts** records live conditions and the team’s response, including acknowledgment, assignment, and comments. It lists alerts raised by automations and **offline alerts**, which the platform raises by itself when a device or gateway stops reporting, with no automation to build. The **Event log** tab lists workflow, offline, service monitoring, and host watchdog events, and **Email preferences** controls which of them reach your inbox.

## Before you start
Viewing requires device viewing permission. Response actions require their respective device management capabilities. Email preferences are personal and apply across your organizations.

## Steps
1. Open **Alerts**. It shows active alerts first; choose **Cleared** or **All** for history, and filter by kind (**Automation**, **Device offline**, **Gateway offline**), acknowledgment, device, or workflow.
2. Repeats of one workflow on one device are grouped with their occurrence count. Choose **Individual** to list every occurrence.
3. Select an alert to inspect its source, timestamps, evidence, current condition, and the other occurrences of its source.
4. Acknowledge it when you have seen it and assign a responsible member where appropriate. To acknowledge several at once, tick them and choose **Acknowledge selected**, or use **Acknowledge all cleared** in an alert’s occurrences.
5. Add a comment with your findings.
6. Continue checking the condition until the source reports it cleared.
7. The bell beside **Assistant** and **Help** counts the alerts you were notified about as a recipient. Open it to see them, select one to open its alert, or choose **Mark all read**. Opening an alert from anywhere also marks it read.

## Offline alerts
Every active device is watched for going offline. An offline alert opens after the device has been offline for 2 minutes without a break, and clears by itself once it has been back for 2 minutes. A device that drops and returns within 2 minutes raises no alert.

- **Death certificate**: the device announced that it was going offline.
- **Missed check-in**: the device has been silent for longer than its **Offline after**. The alert shows when the platform last heard from it and, for a device whose readings carry their own time, when its last reading was taken.
- **Gateway offline**: one alert for a gateway lists every device behind it, instead of one alert per device. When the gateway returns, a device that still does not report gets its own alert once its own Offline after has passed.

**Offline after** is automatic: three times how often the device usually reports, plus the polling interval for a device whose readings are fetched from a vendor’s service, at least 15 minutes and at most 7 days. A device reporting every 2 minutes through a 5-minute poll is offline after 15 minutes; one reporting once a day, after 3 days. Messages a device sends together, a few seconds apart, count as one report, so a sensor that sends two messages every two hours reports every two hours. Until a device has sent three reports it is still learning and is judged only by a death certificate. The alert shows the threshold it used and the intervals it came from.

Platform maintenance never raises an offline alert: restarts, deploys, a lost broker connection, and an adapter being redeployed, restarted or paused show the device as unknown instead, and the time the platform could not hear it does not count as silence. Deactivating a device ends its open alert with the reason instead of clearing it.

Offline alerts send nothing yet: no email and no bell notification. They appear on this page, in the sidebar’s **Alerts** count, in the Event log, on the device page, and in the device list.

## Expected result
Acknowledgment records that someone saw the alert; assignment records responsibility. Neither automatically clears its underlying condition. Acknowledging in bulk skips alerts that are already acknowledged.

## Troubleshooting
If an alert remains active after acknowledgment, inspect the latest condition evidence. Notification delivery is separate from the alert record. Check **Email preferences** and the workflow’s notification settings when recipients do not receive an update.

Offline alerts are not sent to anyone yet, so check this page or the device list for them. Offline alerts watch the device as a whole: one value going quiet while the device keeps reporting, or an automation action on silence, needs an automation’s **No data** condition, which is not available yet. An automation’s freshness setting is separate from Offline after; see [the conditions guide](/help/automation-conditions).

The bell lists only alerts of automations that name you as a recipient. A new alert plays a short chime while the portal is open, but only after you have clicked or typed in the page once, and only when **Sound for new alerts in this browser** is on in the bell. A tab in the background checks about once a minute, so its chime can be late.

## Related guides
[Read the related guide](/help/alert-notifications)
