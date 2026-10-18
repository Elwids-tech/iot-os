import { useSyncExternalStore } from "react"

const WIDE = "(min-width: 1280px)"

/** True from 1280px, where InboxPage shows the queue and the detail side by side. */
export function useWide() {
  return useSyncExternalStore(
    (change) => {
      const media = window.matchMedia(WIDE)
      media.addEventListener("change", change)
      return () => media.removeEventListener("change", change)
    },
    () => window.matchMedia(WIDE).matches,
  )
}
