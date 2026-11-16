# Portal on phones

The portal works from a phone and installs as an app, so people can act on alerts
away from a computer ([spec 033](../../specs/033-pwa-web-push/spec.md),
[ADR-047](../adr/ADR-047-progressive-web-app-before-native-apps.md)). It is a
progressive web app: the same portal, installable from the browser, with no app store.
Native apps wait until a feature needs them.

## Installing

**Install app** in the user menu installs the portal where it isn't installed already.
The portal never shows install banners or prompts by itself.

| Where | What **Install app** does |
| --- | --- |
| Chrome, Edge or Samsung Internet on Android; Chrome or Edge on a computer | Opens the browser's own install prompt. |
| Safari on iPhone and iPad (iOS and iPadOS 16.4 or later) | Shows the steps: Share → **Add to Home Screen**, then open it from the Home Screen and sign in there once. |
| Other browsers | Points to the browser's menu (**Install app**, **Add to Home screen**, or **File → Add to Dock** in Safari on a Mac). |

The installed app opens in its own window, with the portal's name (*IoT OS*) and icon,
where the portal normally lands. **Install app** is hidden inside the installed app.

On iPhone and iPad the installed app keeps its own storage and sign-in, separate from
Safari's, so the person signs in once inside it.

The icon is drawn from one SVG, `apps/portal/icons/app-icon.svg`. After changing it,
run `pnpm --filter @iot-os/portal icons` and commit the PNGs it writes to
`apps/portal/public/`; the image build needs no image tooling.

## Offline

The portal keeps no alerts, readings or other organization data on the device.

- **Opening without a connection** shows *You're offline. Alerts and readings need a
  connection.* with **Try again**, and nothing from an earlier session. It loads by
  itself once the API answers again.
- **Losing the connection on an open page** shows *You're offline. Values are from …*
  under the page header within 10 seconds. Values already on the page stay, with their
  own age labels, and queries pause until the connection returns.
- **Actions made offline fail at once** with *You're offline. Nothing was saved.*
  Nothing is queued to send later. When the connection drops while an action is on its
  way, the server may have acted before the answer was lost, so the message asks to
  check whether it was saved before trying again.

The connection store in `@iot-os/api-client` (`connection.ts`) decides whether the API
can be reached. It starts from the browser's `online` and `offline` events, and every
API request reports to it: any response is a success, a request with no response is a
failure (`ApiError` with status 0). A network without internet fires no event, so while
the page is visible it also probes the API's `/up`: once as soon as it goes offline (one
lost response then costs no more than a flicker), every 5 s after that, and while online
only after 10 s without a successful request.

## Updates

The service worker (`apps/portal/src/sw.ts`) precaches the app shell only: `index.html`
and the built JavaScript, CSS, fonts and icons. It registers no route for the API, so
nothing from the API host is cached. `runtime-config.js`, which names the API, is
fetched network-first, with the last copy used only when there is no network.

After a release:

- An open portal checks for a new version every 30 minutes while visible and whenever
  it becomes visible again. When one is ready it shows *A new version is available*
  with **Reload**.
- Without **Reload**, the new version runs the next time the app starts, once every
  window of it has closed. An open page never switches versions underneath itself:
  the worker keeps serving the version it started with until then.
- `<meta name="build-id">` names the running build (`BUILD_ID`, else the git commit,
  else the build time).

The portal image has its own nginx config (`deploy/docker/portal/nginx.conf`): `/sw.js`
and `/manifest.webmanifest` are served `no-cache` and a missing one is a 404, never the
app's `index.html`.

## Signing out

Signing out removes everything the portal kept in the browser for that person: every
cached response, `sessionStorage` and the personal `localStorage` keys (selected and
last organization, last dashboard, the bell's last chime, dashboard panel display). The
registry is `apps/portal/src/pwa/personal-state.ts`. Display choices that are not about
anyone stay: theme, skin, palette, the bell's sound switch and table layouts. The app
shell in Cache Storage holds no one's data and stays.

## Testing

- Unit tests: `pnpm --filter @iot-os/api-client test` (the connection store) and
  `pnpm --filter @iot-os/portal test` (`src/pwa/*.test.ts`).
- `pnpm --filter @iot-os/portal exec playwright test -c playwright.pwa.config.ts` builds
  the portal, serves it with `vite preview` on 4174 with its service worker, and checks
  the manifest, the shell-only cache, the offline screen, the offline notice, that
  nothing is queued, and that a new release reaches the next launch (SC-006).
- The default Playwright config blocks service workers, so mocked specs are unaffected.
