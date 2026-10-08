---
{
  "slug": "alert-notifications",
  "title": "Configure notification recipients",
  "section": "Alerts",
  "contexts": [
    "alerts.notifications",
    "alerts.notifications.workflow"
  ],
  "keywords": [
    "notification",
    "recipient",
    "email",
    "delivery",
    "workflow notification",
    "settings"
  ],
  "required_capabilities": [
    "devices.view",
    "devices.manage"
  ],
  "revision": 1,
  "summary": "Notification settings control who receives supported workflow/alert updates in your organization.",
  "questions": [
    "How do I choose notification recipients?",
    "Why did an alert not send an email?"
  ]
}
---
## Purpose
Notification settings control who receives supported workflow/alert updates in your organization.

## Before you start
Configuration requires device management permission. Recipients must be eligible organization members.

## Steps
1. Open the notification settings from **Alerts**.
2. Choose the relevant workflow or notification configuration.
3. Select recipients and supported delivery options.
4. Save the settings.
5. Check the alert and delivery evidence when testing an expected notification.

## Expected result
The configured recipients are used for subsequent eligible updates. Changing recipients does not resolve the alert itself.

## Troubleshooting
An alert existing does not prove an email was delivered. Check enabled settings, selected recipients, and recorded delivery errors. Ask the administrator when mail delivery configuration needs attention.

## Related guides
[Read the related guide](/help/alerts)
