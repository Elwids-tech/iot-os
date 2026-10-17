const chunkErrorPatterns = [
  "Failed to fetch dynamically imported module", // Chromium
  "error loading dynamically imported module", // Firefox
  "Importing a module script failed", // Safari
  "Unable to preload CSS",
]

/** True when the error is a code chunk that failed to load, usually because a deploy replaced it. */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : ""
  return chunkErrorPatterns.some((pattern) => message.includes(pattern))
}

const reloadKey = "iot-os:stale-chunk-reload"
const reloadCooldownMs = 10_000

/** A stale chunk reloads the page once; a second failure within the cooldown shows the error instead of looping. */
export function staleChunkReloadDue(lastReloadAt: number | null, now: number): boolean {
  return lastReloadAt === null || !Number.isFinite(lastReloadAt) || now - lastReloadAt >= reloadCooldownMs
}

/**
 * After a deploy, an open tab still asks for the old build's chunks, which no
 * longer exist. Vite reports that as `vite:preloadError`; reload once to pick
 * up the new build. Call it once from the app's entry, before rendering.
 */
export function reloadOnStaleChunks(): () => void {
  const onPreloadError = (event: Event) => {
    // A chunk that loaded but threw is a bug, not a stale build; reloading won't fix it.
    if (!isChunkLoadError((event as Event & { payload?: unknown }).payload)) return
    try {
      const stored = window.sessionStorage.getItem(reloadKey)
      const now = Date.now()
      if (!staleChunkReloadDue(stored === null ? null : Number(stored), now)) return
      window.sessionStorage.setItem(reloadKey, String(now))
    } catch {
      return // Without storage there is no loop guard; the page offers Reload instead.
    }
    window.location.reload()
  }
  window.addEventListener("vite:preloadError", onPreloadError)
  return () => window.removeEventListener("vite:preloadError", onPreloadError)
}
