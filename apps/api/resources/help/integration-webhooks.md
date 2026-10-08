---
{
  "slug": "integration-webhooks",
  "title": "Inspect webhook delivery",
  "section": "Integrations",
  "contexts": [
    "integrations.webhooks"
  ],
  "keywords": [
    "webhook",
    "receiver",
    "endpoint",
    "retry",
    "delivery",
    "failed",
    "signature",
    "event",
    "duplicate"
  ],
  "required_capabilities": [
    "devices.view",
    "devices.manage"
  ],
  "revision": 1,
  "summary": "Webhooks deliver eligible events to a configured receiver and record delivery attempts.",
  "questions": [
    "How do I retry a failed webhook?",
    "Will enabling a webhook replay old events?"
  ]
}
---
## Purpose
Webhooks deliver eligible events to a configured receiver and record delivery attempts.

## Before you start
Use an active integration application with appropriate event permissions. The receiver must handle signature verification and duplicate events.

## Steps
1. Open the application’s webhook configuration.
2. Enter the receiver URL and enable delivery after reviewing the confirmation.
3. Copy the newly displayed signing secret once and configure receiver verification.
4. Inspect delivery status and attempt history.
5. After fixing a receiver error, confirm **Retry** for an eligible failed delivery.
6. Disable delivery when the receiver should stop receiving events.

## Expected result
New eligible events are sent and their attempts are recorded. Enabling starts from the current event head; earlier events are not replayed.

## Troubleshooting
A failed attempt does not prove the receiver never saw the event: uncertain network outcomes can cause duplicates. Receivers must deduplicate. Stale retries or old endpoint revisions can be rejected. Grant changes require token and webhook reconfiguration.

## Related guides
[Read the related guide](/help/integrations)
