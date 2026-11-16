import { useSyncExternalStore } from "react"

const MOBILE_BREAKPOINT = 768
const PHONE = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

/**
 * True under 768 px, the phone width of the `max-md:` rules (spec 033). It reads the
 * media query, never `window.innerWidth`: a phone browser zooms out when a page is
 * briefly wider than the screen, and `innerWidth` then measures the zoomed-out view,
 * so a page that once rendered its computer layout would keep it. The media query
 * holds from the first render, so phones never render the computer layout first.
 */
export function useIsMobile() {
  return useSyncExternalStore(
    (change) => {
      const media = window.matchMedia(PHONE)
      media.addEventListener("change", change)
      return () => media.removeEventListener("change", change)
    },
    () => window.matchMedia(PHONE).matches,
    () => false,
  )
}
