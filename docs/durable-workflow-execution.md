# Durable geofence workflow execution

This slice adds operational activation and geofence condition transitions to
the saved workflow drafts. The visual editor remains deferred. There are no
notification channels, ERP calls, arbitrary scripts or automated device command
nodes in this release.

## Public control API

Under `/api/v1/organizations/{organization_uuid}/workflows/{workflow_uuid}`:

| Method/path | Behavior |
| --- | --- |
| POST `/deployments` | Request activation or disable; returns 202 and an operation |
| GET `/deployments/{operation_uuid}` | Poll the durable operation acknowledgement |
| GET `/execution` | Read the applied execution's state, enabled flag, stop reason and consumer health |
| GET `/transitions` | Paginated historical activated/cleared transitions; max 100 per page |

Deployment request:

```json
{
  "operation_uuid": "<new UUID reused for retries>",
  "target_state": "active",
  "draft_revision": 1,
  "expected_generation": 0
}
```

Use `inactive` to disable. Both commands require the current draft revision and
deployment generation. A retry with the same operation and exact request returns
the existing result; reusing the identity for different intent returns 409.
Concurrent operations are rejected while an acknowledgement is pending. Draft
editing remains permitted and does not mutate an execution snapshot.

Reads use `Device.view`; activation/disable uses `Device.activate`. Organization
membership and workflow ownership are checked on every public endpoint. A
separate automation permission family and third-party application credentials
remain future work.

Laravel creates an immutable deployment snapshot with a fresh execution version
UUID, updates desired status and queues `workflow.deploy.v1` in one transaction.
The version UUID equals the operation UUID. This makes repeated activations of
the same draft independent episodes with distinct transition IDs. Current
device configuration and generation must be applied before activation is
requested. Go independently checks the applied device snapshot, generation,
review flag, and mapped numeric source parameters in degrees/metres. Runtime
validation failures produce a durable failed operation, preserving any earlier
applied execution.

Desired and applied status are separate. A 202 response is not an activation
acknowledgement. Workflow responses retain `status: draft` for the editable
document and expose separate `deployment_status`, `deployment_generation`,
`pending_operation_uuid`, `desired_deployment_uuid` and
`applied_deployment_uuid` fields.

## Runtime persistence and recovery

The existing durable control outbox/inbox path carries deployment requests and
acknowledgements. Runtime rule heads fence obsolete generations. Immutable
execution definitions and mutable evaluator state live in separate runtime
tables. A repeated control message cannot reset evidence or resurrect an older
execution.

`workflow-evaluator-v1` is a single-message, explicit-ack JetStream consumer of
`IOT_COMMITTED_TELEMETRY`. Each transaction persists:

- Stable telemetry event-ID deduplication.
- Every affected rule state.
- Stable activated/cleared transitions and their delivery outbox records.
- The consumed broker stream sequence checkpoint.

Only then is the broker message acknowledged. Broker redelivery after commit is
a no-op; failure before commit retries the whole transaction. Laravel deduplicates
runtime envelopes and condition transition IDs independently. Transition history
is scoped through the deployment and workflow; it is not a notification-delivery
log.

The checkpoint records the broker stream's creation timestamp. Retention gaps,
stream replacement or a checkpoint behind broker acknowledgement fail explicitly
instead of silently resetting. Readiness includes consumer health. Recovery from
actual lost history requires operator investigation; this release deliberately
does not offer an automatic skip/reset endpoint.

Timers run when the consumer has no outstanding input. Their deadlines and
evidence are reconstructed from persisted evaluator state after restart; there
is no in-memory-only timer queue. Evaluation uses processing time, so delayed
or expired GPS cannot manufacture fresh outside evidence. Pre-activation source
observations are ignored. No wall-clock replay of missed historical alerts is
attempted. Database/broker outages defer work; recovery evaluates freshness
again.

## Episode lifecycle

- Fresh outside evidence satisfying the configured duration/sample count emits
  `activated`; fresh eligible inside evidence emits `cleared`.
- Missing, stale or uncertain GPS makes the condition unknown and resets pending
  evidence. It never clears an active episode.
- Replacement or disable freezes the old execution with `superseded` or
  `disabled`; it does not invent a clear. Historical state/transitions remain.
- Changed device configuration/generation, deactivation or required configuration
  review suspends the old execution with `binding_changed`. Activation against
  the new binding is explicit. Suspension also preserves the episode history.
- A new execution starts with unknown state and fresh evidence; episodes are not
  transferred between versions.

Only one runtime instance is supported, using the existing exclusive-runtime
lock. This is an initial implementation: timers scan enabled executions and
compile their definitions each pass. Partitioned execution, cached compilation,
bounded retention of deduplication/history/outboxes, operational dashboards and
high availability require subsequent work. Existing telemetry outbox retention
limitations remain unchanged.

## Verification

The isolated database suite checks atomic rollback on failed transition outbox
insertion, duplicate events, restart during a pending timer, unknown GPS,
generation fencing, stale control messages and checkpoint/stream gaps. The
isolated broker suite checks the real committed-outbox consumer, broker
acknowledgements, duplicates and reconnect/restart. Laravel tests cover
permissions, idempotency, immutable snapshots, editing while deployment is
pending, acknowledgement ordering, disable and transition deduplication.

Next: alert records, acknowledgement/escalation policy and notification delivery
with retries/idempotency. The visual builder and conversational authoring can be
added later against these same APIs.
