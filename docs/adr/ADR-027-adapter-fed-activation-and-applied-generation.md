# ADR-027: Adapter-Fed Sources Activate Against Their Stored Birth, and a Refused Activation Keeps Bindings

**Status:** Proposed
**Date:** 2026-10-30
**Relates to:** [ADR-025](ADR-025-review-follows-current-birth.md), [ADR-010](ADR-010-per-tenant-adapter-runtimes.md),
[ADR-011](ADR-011-dag-automation-in-go.md), [ADR-014](ADR-014-control-plane-data-plane-http-integration.md)

## Context

Activation applies a device configuration only against the source's live birth. The
runtime (`activate()` in
[`application.go`](../../services/runtime/internal/app/application.go)) needs the
source online in its Sparkplug engine, then runs `devices.Preview`, the same check
that review uses ([ADR-025](ADR-025-review-follows-current-birth.md)). Otherwise it
refuses: "Source is offline or needs a fresh birth certificate."

A source fed by a device adapter (spec 020) has no birth of its own. The tenant's
adapter pulls the device's records from a vendor cloud, or receives them by webhook.
The platform's adapter publisher then announces the source with a DBIRTH that it
builds from the adapter's decoder output. The metric set comes from the platform,
not from the device. Polled trackers report hourly to daily. Since 2026-10-28 the
publisher keeps births in `births-<adapter>.json`. It announces every known source
when it connects, on `Node Control/Rebirth`, and when the platform's host comes
online. A tenant's adapter runtime keeps its image until the adapter is deployed
again, and a release does not roll it.

On the pilot on 2026-10-30, a platform deploy restarted a tenant adapter that was
still on an older image without the births file. It announced only its node. A
tracker bound to an automation then had no live birth until its next report. Its
review (ADR-025) could not clear, and a configuration apply was refused as offline.

The refused apply then broke the automation. A device had one generation, and it did
two jobs:

- It fenced requests. Laravel increments `devices.deployment_generation` with every
  activation, rollback, resume or deactivation request. The runtime records each
  answer, applied or failed, at that generation (`Store.Apply`, `Store.FailTransition`).
- It identified the applied configuration for everything bound to it. That covers
  DAG and geofence bindings (`checkDAGBindings`, `rules.CheckDevice`), the
  generation telemetry carries into storage and committed telemetry, Laravel's
  automation activation checks, and `DagActions`.

The refused request moved the generation from 1 to 2. The applied configuration did
not change, yet every binding to it failed with `binding_changed`. The editor offered
the new generation only after someone saved the automation again. In Laravel, the
device's `deployment_status` of `failed` also refused automation activation and hid
the device from command bindings.

## Decision

- **Adapter-fed sources activate against their stored birth.** A source is
  adapter-fed when its configuration has an `adapter` binding, which an adapter
  installation gives it. Laravel sends such an activation with `birth_metrics`: the
  names and datatypes of the source's last stored birth (the Discovery candidate's
  metrics). It sends them in `device.activate.v1` and, while the activation is
  pending, in the `/state` snapshot. The runtime still prefers a live birth, and an
  incompatible live birth still refuses. When the source has no live birth, the
  runtime checks the configuration against `birth_metrics` and applies it if they
  match. Presence stays unknown until the device reports, and the runtime asks the
  adapter for a rebirth as it does after every activation. Later births set and clear
  review as before (ADR-025). A device that announces its own births still needs a
  live, matching birth.
- **Two generations.** The *deployment generation* fences requests, as before.
  Outcomes and presence carry it, and commands are sent against it. The *applied
  generation* is the deployment generation at which the applied configuration was
  applied. A refused request does not change it, and deactivation clears it. DAG,
  geofence and location bindings use the applied generation, and so do telemetry and
  committed telemetry. `binding_changed` now means the applied configuration or its
  applied generation changed. Laravel stores it as `devices.applied_generation`, and
  the runtime as `device_runtime.devices.applied_generation`.
- **A refused request leaves a device bindable.** An automation can be activated
  against a device whose last request failed, as long as the binding matches the
  applied configuration and generation. Only a pending request blocks activation.
- **Migration.** Existing devices get the generation their bindings already had to
  use. That is the current one, or the one before a request the runtime has not
  answered yet. A binding that a refusal broke before this change needs one more save.

## Consequences

- An adapter-fed device can be configured, rolled back or resumed while its source
  is quiet. Before, it had to wait up to a day for the tracker's next report.
- A refused activation no longer stops or invalidates the automations bound to the
  device. They keep running on the applied configuration, and their readings are
  still stored.
- The stored birth can be out of date when the decoder's output changed after
  Discovery last saw a birth. The check then passes on old names. The next live birth
  puts the device in review (ADR-025), which is the same result as activating just
  before that birth. A changed decoder comes with an adapter deploy, and the
  publisher announces every source after it.
- Activation can succeed for a vendor device that never reports again. Its presence
  stays unknown. When silence counts as offline is spec 018's decision.
- Webhook-fed adapter sources follow the same rule as polled ones, because the
  platform's adapter announces both.
- After a refusal, presence events carry the deployment generation, which Laravel
  matches against `deployment_generation`. Telemetry carries the applied generation.
  A reader that compares the two must not expect them to be equal.
- Tenant adapter runtimes still change image only at their next adapter deploy, and
  a release neither pulls nor rolls them ([gotchas](../dev/gotchas.md#device-adapters)).
  Rolling them with each release is proposed as follow-up work, not decided here.
