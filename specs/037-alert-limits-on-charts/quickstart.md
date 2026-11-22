# Quickstart: Alert Limits on Charts

**Date**: 2026-11-22 | **Plan**: [plan.md](plan.md)

How to prove the feature in the running stack. It follows
[local container verification](../../.agents/skills/local-container-verification/SKILL.md):
rebuild the containers a pull request touches, then exercise the application.

## Prerequisites

- The device stack is up (`./taskw devices:up`) with a simulator sending a numeric
  parameter for at least two devices, here called the pump (temperature, °C) and the
  tank (pressure, kPa).
- You are signed in to the portal as an organization admin, and have a second account
  that can view devices but not automations.
- A dashboard with one time series panel for the pump's temperature and one for the
  tank's pressure.

## Automated checks

```bash
cd apps/api && php artisan test --compact
```

```bash
cd apps/api && php artisan contract:check
```

```bash
cd services/runtime && go test ./internal/dag/...
```

```bash
pnpm --filter @iot-os/portal lint
```

```bash
pnpm --filter @iot-os/portal test
```

The contract fixtures are checked with `tooling/verify-devices-contracts.py`, as
`contracts/README.md` describes.

## Pull request 1: alerts for every device

Rebuild `api` and `automation-worker`. The worker records an automation's alert, so
an alert raised before it is rebuilt still lists one device.

1. Create an automation that raises an alert when the pump's temperature **and** the
   tank's pressure are high, and activate it.
2. Drive both readings over their values until the alert is raised.
3. Open the dashboard. **Expect** the alert period shaded on the pump's panel and on
   the tank's panel.
4. Open **Alerts** and filter by the tank. **Expect** the alert listed. Open the tank's
   device page. **Expect** it under Alerts.
5. Add a command action to a third device, activate, and raise the alert again.
   **Expect** nothing for the commanded device.
6. An alert raised before the rebuild is listed for the tank as well (the backfill).

## Pull request 2: the limits endpoint

Rebuild `api`.

1. Ask for the two devices' limits, signed in as the admin, with the request in
   [contracts/alert-limits-api.md](contracts/alert-limits-api.md). **Expect** two
   rows, one per device, both `combined`, `state` `running`.
2. Change the temperature value in the draft without activating. **Expect** the same
   rows.
3. Activate. **Expect** the new value once the deployment is applied.
4. Deactivate. **Expect** no rows.
5. Ask as a member of another organization. **Expect** `403`. Ask in your own
   organization for a device UUID from another one. **Expect** no rows.

## Pull request 3: limits on panels

Rebuild `api` and `portal`. Keep any unsaved edits in open browser tabs.

1. With a simple automation "Pump safety" (temperature above 25 °C) running, open the
   dashboard. **Expect** a line at 25 on the temperature panel labelled
   "Pump safety > 25 °C", visibly different from a panel threshold, and an "Alert
   limits" row in the legend.
2. Add a panel threshold at 25 to the same panel. **Expect** both, each readable.
3. Change the automation to 30 °C and activate, with the dashboard open. **Expect**
   the line at 30 within one minute, without a reload.
4. Set the value to 500. **Expect** the value axis unchanged, and the legend row
   marked as above the chart.
5. Replace the condition with a 10-second average held for 5 minutes. **Expect** the
   label and legend to say so.
6. Put arithmetic before the comparison. **Expect** no line and no legend row.
7. Cause a suspension (change the device's applied configuration). **Expect** the
   line gone and the legend row saying the automation is suspended and not checking.
8. Select the automation's name in the legend. **Expect** the automation to open.
   Sign in as the second account. **Expect** the name as plain text, and the line
   still drawn.
9. Edit the panel and turn **Show alert limits** off. **Expect** no line and no
   legend rows on that panel only. Export the dashboard. **Expect** `alert_limits:
   false` on that panel and no limits anywhere in the file.
10. Open a dashboard saved before the rebuild. **Expect** limits drawn, and its stored
    definition unchanged after viewing.
11. Block only the alert limits request in the browser's developer tools and reload.
    **Expect** readings, panel thresholds and alert periods drawn as usual, no limit
    lines, and the legend saying alert limits are unavailable. Unblock it. **Expect**
    the lines back within a minute.
12. Repeat step 1 in kiosk mode (`?kiosk=1`), at phone width, and in the dark theme.
13. Sign in with a role that can open dashboards but cannot view devices. **Expect**
    the panel with no alert limits and no "unavailable" message.
14. On a dashboard with 20 time series panels, compare how long readings take to draw
    with **Show alert limits** on and off. **Expect** no difference in when readings
    appear, and limits within two seconds of them (SC-004).

Take screenshots of steps 1, 2, 5, 7 and 12 for the design review.
