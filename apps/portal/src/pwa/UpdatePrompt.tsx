import { useEffect } from "react"
import { toast } from "sonner"
import { useRegisterSW } from "virtual:pwa-register/react"

/** How often an open portal asks the server for a new version while it is visible. */
export const UPDATE_CHECK_MS = 30 * 60 * 1000

/**
 * Registers the service worker and offers a new release (spec 033, FR-014, research R4).
 * Browsers look for a new worker mainly on navigation, which a single-page app left open
 * rarely does, so the portal checks every 30 minutes while visible and whenever it becomes
 * visible again. A new version waits: **Reload** switches to it now, otherwise it takes
 * over once every window has closed, which is the next launch of an installed app. The
 * precache keeps the running version's files until then, so one page never mixes two.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      if (!registration) return
      const check = () => {
        if (document.visibilityState !== "visible" || registration.installing) return
        // Offline, or the server is between releases: the next check tries again.
        registration.update().catch(() => {})
      }
      window.setInterval(check, UPDATE_CHECK_MS)
      document.addEventListener("visibilitychange", check)
    },
    // Without a worker the portal still works; reloadOnStaleChunks covers a deploy.
    onRegisterError() {},
  })

  useEffect(() => {
    if (!needRefresh) return
    const id = toast("A new version is available", {
      id: "app-update",
      description: "Reload to use it now, or it opens the next time you start the app.",
      duration: Number.POSITIVE_INFINITY,
      action: { label: "Reload", onClick: () => void updateServiceWorker(true) },
    })
    return () => {
      toast.dismiss(id)
    }
  }, [needRefresh, updateServiceWorker])

  return null
}
