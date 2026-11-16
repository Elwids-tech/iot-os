/**
 * Installing the portal as an app (spec 033, FR-010, research R6).
 *
 * Chromium browsers (Chrome, Edge, Samsung Internet on Android and desktop) fire
 * `beforeinstallprompt` once the app is installable. The portal keeps the event and
 * cancels the browser's own mini-infobar, so the only install prompt is the one a
 * person asks for with **Install app**. Safari on iPhone and iPad has no prompt: the
 * user menu shows the Share → Add to Home Screen steps instead.
 */
type InstallChoice = { outcome: "accepted" | "dismissed" }
type BeforeInstallPromptEvent = Event & {
  prompt(): Promise<void>
  userChoice: Promise<InstallChoice>
}

let deferred: BeforeInstallPromptEvent | null = null
let installed = false
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((listener) => listener())

/** Starts listening on `target` (the window at module load; tests pass their own). */
export function watchInstallPrompt(target: Pick<EventTarget, "addEventListener" | "removeEventListener">): () => void {
  const capture = (event: Event) => {
    event.preventDefault()
    deferred = event as BeforeInstallPromptEvent
    notify()
  }
  const done = () => {
    deferred = null
    installed = true
    notify()
  }
  target.addEventListener("beforeinstallprompt", capture)
  target.addEventListener("appinstalled", done)
  return () => {
    target.removeEventListener("beforeinstallprompt", capture)
    target.removeEventListener("appinstalled", done)
    deferred = null
    installed = false
  }
}

if (typeof window !== "undefined") watchInstallPrompt(window)

export function subscribeInstall(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** True when the browser offered its install prompt and it has not been used yet. */
export const canPrompt = () => deferred !== null

/** True once this browser reports the app was installed during this visit. */
export const justInstalled = () => installed

/** Shows the browser's install prompt; "unavailable" when there is none to show. */
export async function prompt(): Promise<InstallChoice["outcome"] | "unavailable"> {
  const event = deferred
  if (!event) return "unavailable"
  // A prompt event can be used once.
  deferred = null
  notify()
  await event.prompt()
  return (await event.userChoice).outcome
}

type Page = {
  matchMedia?: (query: string) => { matches: boolean }
  navigator: Pick<Navigator, "userAgent" | "maxTouchPoints"> & { platform?: string; standalone?: boolean }
}

/** True inside the installed app: its own window, without the browser's address bar. */
export function standalone(page: Page = window): boolean {
  return Boolean(
    page.matchMedia?.("(display-mode: standalone)").matches ||
      page.matchMedia?.("(display-mode: window-controls-overlay)").matches ||
      page.navigator.standalone === true,
  )
}

/**
 * True on iPhone and iPad, where every browser is Safari underneath and installing is
 * Share → Add to Home Screen. iPadOS asks for desktop sites, so an iPad reads as a Mac
 * with a touch screen.
 */
export function iosSafari(page: Page = window): boolean {
  const { userAgent, maxTouchPoints, platform } = page.navigator
  return /\b(iPhone|iPad|iPod)\b/.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1)
}
