# ADR-047: Progressive Web App Before Native Apps

**Status:** Proposed 2026-11-16; amended by [ADR-049](ADR-049-self-sign-up.md)
**Date:** 2026-11-16
**Relates to:** [spec 033](../../specs/033-pwa-web-push/spec.md), [spec 022](../../specs/022-alert-bell/spec.md) (alert bell), [spec 011](../../specs/011-notification-channels/spec.md) (notification channels), [ADR-013](ADR-013-integer-user-ids.md)

## Context

Alerts reach people by email and by the bell, which works only while a portal tab is
open. People read alert emails on their phones, and the pages those emails open were
built for a computer. Nothing reaches a phone directly.

What people do with the platform on a phone is narrow: be told about an alert, open
it, look at the device or a dashboard, and acknowledge, assign or comment. Setting up
devices, adapters and automations stays on a computer.

There are two ways to reach phones:

- **Native apps** (Swift and Kotlin, React Native, or a Capacitor shell). These
  mean two app store accounts, review on every release, a release pipeline per store,
  a second sign-in flow, and native push credentials to manage. The project has no
  continuous deployment even for the web.
- **A progressive web app.** The portal installs to the home screen, opens in its own
  window, and receives Web Push: on Android in the browser or the installed app, and
  on iPhone and iPad from iOS and iPadOS 16.4 once the app is on the home screen. It
  uses the same release, sessions and code.

## Decision

1. **The portal becomes an installable progressive web app with Web Push.** Native
   apps are not built until one of these triggers is a real requirement:
   - setting up devices over Bluetooth from a phone (iOS browsers have no Web
     Bluetooth);
   - alerts that break through Do Not Disturb (iOS Critical Alerts are native only);
   - a customer who requires an app store or managed-device install;
   - push on iOS without asking people to add the app to their home screen first.

   When one does, the first step is a native shell (Capacitor) around this same
   portal, so the phone layouts and push delivery carry over.
2. **The service worker caches the app shell only.** No API response, reading or
   alert is stored on a device for offline use. Offline, the app says so instead of
   showing old data, and nothing is queued to send later (principle VI).
3. **Push follows the bell.** It goes to exactly the people who get an alert in their
   bell, filtered by each person's push levels and per-organization switches. Managers
   get no push setting per automation, because a push costs nothing to send. Push is a
   personal channel in the shared delivery record that spec 011 extends.
4. **Keep me signed in is per device.** A checkbox at sign-in keeps that browser or
   installed app signed in for 30 days through a per-device record and an HttpOnly
   cookie. Sign-out, a password reset, or removing the device from the push device list
   ends it. Laravel's built-in remember token is not used, because it is one token per
   user: signing out anywhere would end it everywhere, and no single device could be
   removed.
5. **The push key belongs to the deployment.** Release tooling generates it once and
   keeps it across upgrades. A restore refuses a different key. If the key is ever
   replaced, browsers re-register silently the next time each person opens the portal.

## Consequences

- People on iPhone and iPad must add the app to the home screen before push works, and
  the installed app signs in separately from Safari. The portal explains both.
- Pushes travel through Apple's, Google's, Mozilla's and Microsoft's push services,
  encrypted end to end. A deployment without outbound internet cannot offer push; the
  rest of the feature still works there.
- The admin app shares the portal's session, so a kept sign-in also keeps the admin
  app signed in in that browser for people who can use it. This is the same session
  sharing that exists today, extended from the 2-hour idle timeout to the 30-day kept
  sign-in.
- Push and the bell share recipients, so a change to who gets the bell (spec 018's
  routes, spec 011's severities) applies to push without further work.
- A real iPhone needs HTTPS that it trusts, so iPhone push is checked in the iOS
  Simulator during development and on a real iPhone on the pilot after release.
