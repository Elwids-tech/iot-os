/// <reference lib="webworker" />
/**
 * The portal's service worker (spec 033, research R3 and R4).
 *
 * It precaches the app shell only: index.html and the built JS, CSS, fonts and icons,
 * so the installed app starts without a network and shows its offline screen. It caches
 * no API response and registers no route for the API host, so no alert, reading or other
 * organization data is ever kept on the device. A new version waits until the page asks
 * it to take over (Reload) or every window has closed (the next launch).
 */
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching"
import { NavigationRoute, registerRoute } from "workbox-routing"
import { NetworkFirst } from "workbox-strategies"

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
})
