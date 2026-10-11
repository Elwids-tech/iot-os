# Workflow alert episodes and delivery

Delivered 2026-09-25. [Behavior and APIs](../../docs/workflow-alerts.md).

- Durable version/episode alerts, independent acknowledgement, append-only
  comments and audit, projected in the runtime inbox transaction.
- Opt-in verified-member email subscriptions with revision checks, activation
  and optional recovery delivery, stable logical identities and bounded retries.
- Same-database queue insertion with a separate alerts worker; permissions and
  subscriptions rechecked before sending. SMTP uncertainty remains explicit.
- Portal Alerts list/detail, condition filters, acknowledgement, comments,
  unsaved-edit protection and delivery status; typed API client methods.

Verification: 129 Laravel tests; portal typecheck/unit tests; complete disposable
Devices regression suite; rebuilt API/workers/portal/admin; real queued email
round trip into Mailpit; isolated Playwright desktop/mobile dark checks and
WCAG-tagged axe checks. Temporary verification data was removed.

Follow-up delivered: portal notification settings with searchable member selection, revision conflicts and unsaved protection; audited, generation-fenced manual retry with cumulative attempt history. Verified with 132 Laravel tests, portal typecheck/unit tests and rebuilt-container UI/email checks.

Pending: recipient-specific
cooldown/escalation requirements, historical alert backfill and retention policy.
Visual workflow authoring remains deferred.
