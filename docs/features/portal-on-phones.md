# Portal on phones

The portal works from a phone and installs as an app, so people can act on alerts
away from a computer ([spec 033](../../specs/033-pwa-web-push/spec.md),
[ADR-047](../adr/ADR-047-progressive-web-app-before-native-apps.md)). It is a
progressive web app: the same portal, installable from the browser, with no app store.
Native apps wait until a feature needs them.

At phone width (under 768 CSS px) the pages people use after an alert work without
zooming or scrolling sideways (user stories 1 and 4). Tablets, landscape phones and
computers keep the full layouts. How the kit does it is in the design system's
[Phones](../dev/design-system.md#phones) section.

Code: portal [`src/alerts`](../../apps/portal/src/alerts),
[`src/devices/DeviceOverview.tsx`](../../apps/portal/src/devices/DeviceOverview.tsx),
[`src/dashboards`](../../apps/portal/src/dashboards); kit
[`page-header`](../../packages/ui/src/components/page-header.tsx),
[`filter-sheet`](../../packages/ui/src/components/filter-sheet.tsx),
[`data-table`](../../packages/ui/src/components/data-table.tsx) and
[`collection-page`](../../packages/ui/src/templates/collection-page.tsx); tests
[`e2e/phone.spec.ts`](../../apps/portal/e2e/phone.spec.ts).

## Pages that work on a phone

| Page | On a phone |
| --- | --- |
| Sign-in, password reset, invitation | The card spans the screen with 16 px sides. An alert link opened while signed out signs in and then opens that alert. |
| Home | Compact summary tiles, two to a row, so **Needs attention** is near the top; panels below in one column. |
| Alerts | One stacked row per alert or source: title, device, state and time. **Filters** opens every filter in a sheet (below). Titles wrap to two lines. With manage access, selecting rows brings up **Acknowledge selected** in a bar at the bottom of the screen. |
| Alert detail | **Acknowledge alert** in a bar at the bottom of the screen, one tap away while reading. The assignee picker is full width and the facts read as label and value rows. Email deliveries are cards with the recipient, status and attempts, and **Retry email** on a failed one. A link to an alert that is gone, or that you can no longer see, says *This alert isn't available* and nothing more. |
| Devices | Cards, with search and **Filters** above them. |
| Device detail | Status and last seen in the header, then the latest readings with their age, then the device's alerts, then location, details, connectivity, installation, dashboards it is used in and recent commands. |
| Dashboards | The list as cards. |
| A dashboard | Panels in one column, in the order they read on a computer (top to bottom, then left to right). Each kind keeps a readable height: stat panels 3 rows, charts and maps 6, tables and alert lists 8. A wide table scrolls sideways inside its panel. **Time range** opens every time control in one popover, as on a computer: quick ranges, a custom range, stepping, compare, time zone and refresh. On a phone it has a row of its own under the title. |
| Personal notification settings | Fits the screen. |

On every page the menu button opens the sidebar with the organization switcher and the
user menu, and the bell, **Assistant** and **Help** stay in the header. The bell's list,
Help and the Assistant open the full width of the screen. The header is an app bar:
the title wraps to up to three lines, and the page's main action stays in view with the
rest behind **More actions**. Every button and field is at
least 44 px tall, and fields use 16 px text so iOS does not zoom in. Pages still fit
with the phone's text at 200%; long rows wrap.

## The filter sheet

Lists show one **Filters** button with the number of active filters. It opens a sheet
from the bottom of the screen holding every filter the computer layout has: on Alerts
the condition (Active, Cleared, All), Grouped or Individual, **Unacknowledged only**,
**Assigned to me**, kind, device and workflow. Changes apply as you make them. **Clear
filters** returns to the default view and **Done** closes the sheet.

## Desktop only

Reachable on a phone, but laid out for a computer:

- **Editing dashboards.** A dashboard on a phone offers no **Edit**; **More actions**
  says *Editing needs a larger screen* where Edit would be. A link that opens a dashboard for editing opens it to
  read. The computer layout is never changed from a phone.
- **Automations, device profiles and device adapters**, and the other settings pages.

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

On a billing account's [portal address](branding.md#the-installed-app) the installed
app carries that account's product name and icon instead: the manifest and the icon
files are answered per host. An app installed from one address is separate from one
installed from another, or from the platform's.

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
  window of it has closed, or when the browser's own reload restarts the only window
  open. An open page never switches versions underneath itself: the worker keeps
  serving the version it started with until then.
- `<meta name="build-id">` names the running build (`BUILD_ID`, else the git commit,
  else the build time).

The portal image has its own nginx config (`deploy/docker/portal/nginx.conf`): `/sw.js`
and `/manifest.webmanifest` are served `no-cache` and a missing one is a 404, never the
app's `index.html`.

## Push

Alerts reach an installed app, or a browser with push, as notifications
([alerts](alerts.md#push-notifications)). On iPhone and iPad push works only in the app
added to the Home Screen, so **My notifications** shows the install steps there instead
of the button. Elsewhere it works in the browser and in the installed app alike.

A device is one browser profile: the installed app and the browser on the same phone
share it on Android, and are separate on iPhone and iPad, where the app has its own
storage.

Push belongs to the address it was turned on at. Someone who has push on at the
platform's address and then opens a billing account's
[portal address](branding.md#push) is told once that alerts must be turned on again
there. A notification opens on the address that subscribed and shows that address's
icon; a device at one account's address gets no alerts of another account's
organizations.

## Signing out

Signing out removes everything the portal kept in the browser for that person: every
cached response, `sessionStorage` and the personal `localStorage` keys (selected and
last organization, last dashboard, the bell's last chime, dashboard panel display, the
push device this browser registered). The registry is
`apps/portal/src/pwa/personal-state.ts`. Display choices that are not about anyone
stay: theme, skin, palette, the bell's sound switch and table layouts. The app shell in
Cache Storage holds no one's data and stays. Signing out also closes the app's
notifications still on screen and unsubscribes the browser from push, and the API
forgets its device with the session, so the next person never inherits it. It waits on
the browser's push service for 3 seconds at most. Signed-in API responses are sent
`Cache-Control: no-store`, so the browser's HTTP cache keeps none of them.

## Testing

- Unit tests: `pnpm --filter @iot-os/api-client test` (the connection store) and
  `pnpm --filter @iot-os/portal test` (`src/pwa/*.test.ts`).
- `pnpm --filter @iot-os/portal exec playwright test -c playwright.pwa.config.ts` builds
  the portal, serves it with `vite preview` on 4174 with its service worker, and checks
  the manifest, the shell-only cache, the offline screen, the offline notice, that
  nothing is queued, and that a new release reaches the next launch (SC-006).
- The default Playwright config blocks service workers, so mocked specs are unaffected.
- `e2e/push-settings.spec.ts` stubs notification permission, the worker registration and
  `PushManager`; a real push needs the dev stack with a push key (spec 033 quickstart).
- `e2e/phone.spec.ts`, in the default config, checks the phone pages at 320, 360 and
  390 px and with text at 200%: no sideways scrolling, 44 px controls and 16 px fields.
