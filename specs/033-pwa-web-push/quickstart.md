# Quickstart: Validating Installable Portal and Push Alerts

How to prove each user story works, in the rebuilt local stack and on real phones.
Commands run from the repository root and follow [AGENTS.md](../../AGENTS.md). Hold the
stack rebuild lock (`.local/stack-rebuild.lock`) while rebuilding.

## Prerequisites

- The full stack is up (`./taskw devices:up`), with a test automation whose alert
  names a verified member with device view access as a recipient. A simulator device
  can trigger it.
- Push keys exist in the root `.env`. Generate them once with
  `cd apps/api && php artisan webpush:vapid --show` and copy both values into
  `WEBPUSH_VAPID_PUBLIC_KEY` and `WEBPUSH_VAPID_PRIVATE_KEY`. Set
  `WEBPUSH_VAPID_SUBJECT=mailto:ops@example.com`.
- Rebuild what each pull request changes, keeping the stack's env files and overlays:

  ```bash
  rtk proxy docker compose --env-file .env --env-file .local/devices/devices.env -f deploy/compose/compose.dev.yml -f deploy/compose/compose.app.yml -f deploy/compose/compose.devices.yml up -d --build --no-deps api automation-worker default-worker alerts-worker webhooks-worker assistant-worker scheduler portal admin
  ```

  This rebuilds every service built from the API image, plus `portal` and `admin`
  ([which services](../../docs/dev/local-setup.md#rebuild-one-service)). Check first how
  the running stack was started, and keep its env files and overlays.

- Open the portal at `http://localhost:5173`, not `127.0.0.1`. Both are secure
  contexts, but the browser pane accepts only `localhost`.

## Automated checks

```bash
cd apps/api && php artisan test --compact --filter='Push|KeptSignIn|AlertDelivery'
```

```bash
pnpm --filter @iot-os/portal lint
```

```bash
pnpm --filter @iot-os/portal test
```

```bash
pnpm --filter @iot-os/portal test:e2e -- phone.spec.ts installable.spec.ts push-settings.spec.ts
```

```bash
rtk proxy python -m unittest discover -s tooling/release
```

Expected: everything passes. The phone specs assert no sideways scrolling and 44 px
controls at 320, 360 and 390 px (SC-002), and the existing desktop specs pass without
changes made for this feature (SC-008).

## US1: act on an alert from a phone

1. Browser pane: `resize_window` with the `mobile` preset (375 × 812), sign out, then
   open an alert link `http://localhost:5173/organizations/<org>/alerts/<alert>`.
2. Expected: sign-in fits the screen; after signing in the alert opens; acknowledge,
   assign and comment work, and nothing scrolls sideways
   (`document.scrollingElement.scrollWidth <= innerWidth`).
3. Open Alerts and its **Filters** sheet: every filter is there, and rows are stacked
   cards.

## US3: install, offline, update

1. Desktop Chrome on `localhost:5173`: the user menu shows **Install app**; installing
   opens a standalone window with the portal's name and icon.
2. DevTools → Application: the manifest has no errors, the worker is active, and Cache
   Storage holds only the app shell (no `api` entries).
3. DevTools → Network → Offline, then reopen the app: the offline screen shows and no
   earlier data is visible. Back online, it loads by itself.
4. With a page open, go offline: the banner appears within 10 s; **Acknowledge** fails
   with *You're offline. Nothing was saved.*, and nothing is sent on reconnect.
5. Rebuild `portal` with any visible change while the app is open: **Reload** is
   offered. Close the app and reopen it: the new version runs.

## US2 and US5: push

1. Settings → **My notifications** → **Turn on push on this device**. Allow
   permission. Expected: the device is listed as **This device** and a test push
   arrives.
2. Close every portal window. Trigger the test automation's alert. Expected: a
   notification within 30 s showing organization, severity, automation, device and
   **Activated** with the time. Tapping it opens the alert, and the bell entry is read.
3. Turn **Cleared** on and clear the alert: the notification is replaced by **Cleared**.
4. Trigger five activations within a minute: three notifications, then one summary
   (SC-007).
5. Switch the organization off: the next alert reaches the bell and not the phone.
6. Remove the device: it gets no further pushes, and its next request needs a password.

## Kept sign-in

1. Sign in with **Keep me signed in**. Delete the `laravel_session` cookie, or wait
   past the 2-hour idle timeout with `SESSION_LIFETIME=1` in a test build. Expected:
   the next request resumes without a password, and `kept_sign_ins.last_used_at`
   moves.
2. Sign out: the `iot_kept` cookie is gone and the record has `end_reason =
   signed_out`.
3. Reset the password from another browser: every kept sign-in of that person ends and
   their push devices are removed.

## Real phones (SC-003)

- **Android**: connect over USB, then run:

  ```bash
  adb reverse tcp:5173 tcp:5173
  ```

  ```bash
  adb reverse tcp:8001 tcp:8001
  ```

  Open `http://localhost:5173` in Chrome, install the app, turn on push, close it and
  trigger alerts. Measure the time from the alert's `activated_at` to the notification
  over 20 alerts: at least 19 arrive within 30 s.
- **iPhone or iPad**: first try the iOS Simulator (`localhost` is the Mac). In Safari,
  Share → **Add to Home Screen**, open the app from the home screen, turn on push and
  repeat the Android steps. If the Simulator cannot receive web push, check a real
  iPhone on the pilot after the release that ships push, and record the result in the
  release notes.

## Release tooling

1. On a scratch env file: `manage.py init` writes both push keys; `manage.py validate`
   refuses a file with only one half.
2. On an env file without push keys: `manage.py webpush-keys` adds both, and running it
   again changes nothing.
3. `backup`, then `restore` with different push keys: it refuses. After a restore,
   `push_devices` is empty and no pending push delivery or summary remains.
