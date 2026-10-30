# Quickstart: validating device offline alerts

Runnable checks for each pull request in the [plan](plan.md), against the local stack.
Field and endpoint details are in [contracts/](contracts/) and
[data-model.md](data-model.md); this guide only says what to do and what to expect.

## Prerequisites

- The full stack is running ([local setup](../../docs/dev/local-setup.md)):
  `./taskw devices:setup`, `./taskw devices:up`.
- The fire-watch demo exists: `node tooling/setup-fire-watch-demo.mjs`, then the box is
  running ([simulators](../../docs/dev/simulators-and-fixtures.md#thermal-fire-watch-box)).
- The Sparkplug simulator's energy meter and RGB light are mapped and activated in the
  Acme organization (same guide). They share one edge node, so together they are a
  gateway.
- A polling adapter reads `vendor_tracker_api.py` every 5 minutes, with its three
  trackers activated ([HTTP vendor simulators](../../docs/dev/simulators-and-fixtures.md#http-vendor-simulators-webhook-and-polling-sources)).
  Start the simulator with `--reading-every 120 --upload-every 120 --offline-max 0`
  so each tracker reports every 2 minutes with no coverage gaps; the checks below say
  when to change that.
- Rebuild what a pull request changes, keeping the stack's env files and overlays
  (from the repository root):

```bash
rtk proxy docker compose --env-file .env --env-file .local/devices/devices.env -f deploy/compose/compose.dev.yml -f deploy/compose/compose.app.yml -f deploy/compose/compose.devices.yml up -d --build --no-deps runtime api alerts-worker webhooks-worker scheduler portal
```

Add `adapter-manager` for pull request 6. Mailpit shows every email the stack sends.

## Automated checks

```bash
cd services/runtime && rtk go test ./...
```

```bash
rtk python3 tooling/verify-devices-contracts.py
```

```bash
cd apps/api && rtk php artisan test --compact
```

```bash
rtk pnpm --filter @iot-os/portal lint
```

## Pull request 1: alerts generalised

1. Trigger a fire-watch automation (stage hot work on the box's control page).
2. Expect: the alert, its emails, the event log entry and the integration event look
   exactly as before; the alert's API resource now has `kind: workflow` and `devices`.

## Pull request 2: detection and display (no notices)

| Scenario | Do | Expect |
| --- | --- | --- |
| Device, death certificate | On the box's control page stage **cut mains power**, then set the battery to 0 (the box sends NDEATH and disconnects) | About 2 minutes later: one **Device offline** alert, cause death certificate, last seen at the cut; the device page and directory show it offline. Mailpit: nothing new |
| Recovery | Clear the incident (mains back) | The box births again; about 2 minutes later the alert clears |
| Short drop | Power it off and back on within a minute | No alert |
| Gateway | Stop `sparkplug_simulator.py` with Ctrl-C (it publishes NDEATH) | One **Gateway offline** alert listing the energy meter and the RGB light; neither device has its own alert. Restart it: the alert clears |
| Silence behind a live edge | Run `vendor_water_meter.py` through its adapter, then stop the meter only | 17 minutes after its last report (automatic *Offline after* of 15 minutes, the minimum, plus grace): **Device offline**, cause missed check-in |
| Polled devices stay quiet | Leave the trackers polled for 30 minutes | No alert. Each tracker's device page shows a reporting interval of about 2 minutes, a 5-minute poll and an automatic *Offline after* of 15 minutes (3 × 2 + 5 = 11, raised to the minimum) |
| Polled device stops | Restart `vendor_tracker_api.py` with `--trackers 2` (same seed) | The third tracker's **Device offline** opens about 17 minutes after the poll run that last delivered a reading for it; the alert shows both that run's time and the reading's observed time. The other two stay online |
| Adapter redeploy | Activate one more tracker through the adapter (or **Resume** it), which redeploys it | No alert opens or clears; the trackers show unknown ("Adapter restarting") for a few seconds, then online; their last-seen times do not move until new readings arrive |
| Backlog after a gap | Restart the simulator with `--offline-max 1800` and wait for a tracker's coverage gap to end | A tracker whose gap is shorter than its *Offline after* raises nothing; one past it opens an alert that clears when its backlog arrives |
| Soak (SC-011) | Add a second polling adapter with a 60-minute interval for another tracker account started with `--reading-every 3600 --upload-every 3600 --offline-max 0`, set the first simulator to `--reading-every 60`, and leave both for 24 hours | No episode opens |
| Learning | Activate a device that has never reported, then let it send two readings | The device page says "learning how often it reports"; no silence alert until its third reading |
| Runtime restart | `... restart runtime` (same compose prefix as above) with everything running | No alert opens or clears |
| Broker restart | `... restart mqtt` | No alert; devices show unknown briefly, then online |
| Death during a restart | Stop the runtime, power the box off, start the runtime | No alert until the box's *Offline after* (automatic, at least 15 minutes) plus 2 minutes after the runtime is back |
| Gateway back, one device silent | No simulator publishes a subset of its devices; covered by the tracker's tests | The child is judged by its own threshold from the gateway's return |
| Never connected | Activate a device that has never reported | No alert; the device page says "waiting for first report" |
| Deactivation | Deactivate a device with an open alert | The alert ends with "device deactivated", not cleared |
| Rollout | Rebuild with a device already stopped | No alert; the device page says "offline since before monitoring started" |

## Pull request 3: settings and mutes

1. Set the fire-watch profile's **Grace** to 0 and power the box off: the alert opens
   within one tick (5 s) of its death certificate. Set the grace back to 2 minutes.
2. Set a profile to **Connects to report**; a device that sends NDEATH after each
   report raises nothing; stop it and an alert opens after **Offline after**.
3. Set the tracker profile's **Offline after** to 3 minutes: the profile and each
   tracker's page warn (reporting interval 2 minutes plus a 5-minute poll is longer)
   and suggest 15 minutes. Clear the field: the trackers return to **Automatic**.
4. Set a tracker's own **Offline after** to 3 days and its profile's to 1 hour: that
   tracker shows "3 days (this device)", the others "1 hour (profile)". A tracker's
   style shows **Connects to report**, locked because it is fed by an adapter.
5. Mute the box for 10 minutes and power it off: no alert in the default inbox (the
   **Muted** filter shows it); end the mute early: the alert appears and, after pull
   request 4, notifies.
6. Mute the Acme site and stop the simulator: the gateway alert is muted.

## Pull request 4: notifications

1. As the Site Supervisor, **Alerts → Notify me**: subscribe to the fire-watch site
   with recovery on. With the portal open, power the box off: one email in Mailpit,
   and the bell shows **Device offline · Hot work box** and chimes once; power it back
   on: one recovery email and a silent **Cleared** bell notification. A member with no
   subscription sees the alert on the Alerts page but nothing in their bell.
2. As an administrator, add a route for critical devices to Fire Watch Lead; set the
   box's profile severity to critical: the lead gets the activation too; with severity
   warning, only the supervisor does.
3. Turn **Device offline** off in the supervisor's **Settings → Email**: no more email
   arrives for them, but the bell still does.
4. Subscribe to all devices, then stop the simulator and the box within a minute: the
   first email at once, then one summary listing the rest by site; the bell lists each
   alert and chimes once.
5. Flap the box (power it off and on 4 times in an hour, each past the grace period): the
   fourth episode sends nothing and adds nothing to the bell; the next email says how
   many were held.
6. With no subscriptions or routes: power the box off, nothing in Mailpit (SC-004).

## Pull request 5: integrations

1. Start the webhook sink (`compose.webhook-verification.yml`, see
   [integrations](../../docs/features/integrations.md#webhooks)) and create two
   applications granted the box, both with webhooks to the sink.
2. Turn **Device connectivity events** on for one; power the box off: only that
   application receives `connectivity.offline.v1`, and only its alert reads list the
   connectivity alert.

## Pull request 6: vendor broker and API connections

1. Deploy a vendor-source adapter for `vendor_water_meter.py`, then stop the vendor
   broker.
2. Expect one **Connection lost** alert for the adapter, its devices shown unknown, and
   no device alerts. Start the broker again: the alert clears, and the devices are
   judged from the reconnection.
3. On the tracker simulator, `POST /_control {"fault": "401"}`: the next poll stops
   with a rejected key. About 2 minutes later one **Connection lost** alert opens for
   the polling adapter, its trackers show unknown, and none opens a device alert.
   Clear the fault and **Resume** the adapter: the alert clears and the backlog arrives.
4. `POST /_control {"fault": "500", "count": 3}`: the adapter retries with back-off;
   the same single alert opens if the failures outlast the grace, and clears at the
   first successful run.
