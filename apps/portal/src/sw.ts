/// <reference lib="webworker" />
/**
 * The portal's service worker (spec 033, research R3 and R4).
 *
 * It precaches the app shell only: index.html and the built JS, CSS, fonts and icons,
 * so the installed app starts without a network and shows its offline screen. It caches
 * no API response and registers no route for the API host, so no alert, reading or other
 * organization data is ever kept on the device. A new version waits until the page asks
 * it to take over (Reload) or every window has closed (the next launch).
 *
 * It also shows push alerts and opens the alert on a tap (spec 033, US2,
 * contracts/push-payload.md).
 */
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching"
import { NavigationRoute, registerRoute } from "workbox-routing"
import { NetworkFirst } from "workbox-strategies"
import { fallbackNotification, safePath, toNotification } from "./pwa/notification"

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> }

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// Every page is the single-page app, answered from the precached shell. /connect keeps
// going to nginx, which adds the headers that stop the approval page being framed.
registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html"), { denylist: [/^\/connect\/?$/] }))

// Deployment settings are always fetched fresh; the last copy is used only to start the
// offline screen when the network is down. It names the API, so the worker keeps a copy
// from install: the page that installed it fetched the file before the worker ran.
const RUNTIME_CONFIG = "/runtime-config.js"
const RUNTIME_CONFIG_CACHE = "runtime-config"
registerRoute(
  ({ url }) => url.origin === self.location.origin && url.pathname === RUNTIME_CONFIG,
  new NetworkFirst({ cacheName: RUNTIME_CONFIG_CACHE }),
)
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(RUNTIME_CONFIG_CACHE)
      .then((cache) => cache.add(new Request(RUNTIME_CONFIG, { cache: "no-store" })))
      // Never fail the install over it: the next online start fetches it anyway.
      .catch(() => {}),
  )
})

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting()
  // A page starting while this version waits (a reload, FR-014): take over only when it is
  // the one window open, so no other window ends up running two versions at once.
  if (event.data?.type === "SKIP_WAITING_IF_ALONE")
    event.waitUntil(
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => (windows.length <= 1 ? self.skipWaiting() : undefined)),
    )
})

// Push alerts. Every push shows a notification, as browsers require: one this version
// cannot read shows a generic one that opens the app.
self.addEventListener("push", (event) => {
  let payload: unknown = null
  try {
    payload = event.data?.json() ?? null
  } catch {
    payload = null
  }
  const { title, options } = payload === null ? fallbackNotification() : toNotification(payload, new Date())
  // renotify is not in TypeScript's NotificationOptions yet; browsers read it.
  event.waitUntil(self.registration.showNotification(title, options as NotificationOptions))
})

// A tap opens the alert. An open window is focused and asked to go there through the
// router, so unsaved edits get the usual question instead of a reload; without one, a
// new window opens.
self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const path = safePath((event.notification.data as { url?: unknown } | null)?.url)
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
      const open = windows
        .filter((client) => new URL(client.url).origin === self.location.origin)
        .sort((a, b) => Number(b.focused) - Number(a.focused) || Number(b.visibilityState === "visible") - Number(a.visibilityState === "visible"))[0]
      if (open) {
        const focused = await open.focus().catch(() => open)
        focused.postMessage({ type: "OPEN_PATH", path })
        return
      }
      await self.clients.openWindow(path)
    })(),
  )
})

// The push service rotated this browser's subscription. A worker cannot send the session's
// CSRF token, so it only subscribes again; the next portal start registers the new endpoint.
type PushSubscriptionChange = ExtendableEvent & { oldSubscription: PushSubscription | null }
self.addEventListener("pushsubscriptionchange", (event) => {
  const key = (event as PushSubscriptionChange).oldSubscription?.options.applicationServerKey
  if (!key) return
  ;(event as PushSubscriptionChange).waitUntil(
    self.registration.pushManager
      .subscribe({ userVisibleOnly: true, applicationServerKey: key })
      .then(() => undefined)
      .catch(() => undefined),
  )
})
