/**
 * Whether the API can be reached from this page (spec 033, research R8).
 *
 * The store starts from `navigator.onLine` and the browser's `online` and `offline`
 * events, and `ApiClient` reports every request: a response of any status is a success,
 * a request that fails at the network level is a failure. A network without internet
 * fires no event, so while the page is visible the store also probes the API's health
 * route: once as soon as it goes offline, then every 5 s, and while online only when
 * nothing has succeeded for 10 s. The probe is `no-cors`, so an opaque answer proves the API answered without the
 * route needing CORS.
 */
export type ConnectionState = "online" | "offline"

export type ConnectionSnapshot = Readonly<{
  state: ConnectionState
  /** When the current state began (ms since the epoch). */
  since: number
  /**
   * The last time an API request got a response before the current state began, or null.
   * While offline it says how old the values on screen are at most.
   */
  lastSuccessAt: number | null
}>

/** What the store reads from the page; tests pass a fake. */
export type ConnectionEnvironment = {
  online(): boolean
  visible(): boolean
  /** Subscribes to `online`, `offline` and `visibilitychange`; returns the unsubscribe. */
  listen(events: { online(): void; offline(): void; visible(): void }): () => void
  fetch: typeof fetch
}

export type ConnectionStore = {
  getSnapshot(): ConnectionSnapshot
  subscribe(listener: () => void): () => void
  /** Starts the browser listeners and the probe; returns the stop function. */
  start(options: { probeUrl: string }): () => void
  reportSuccess(): void
  reportNetworkFailure(): void
  /** Checks now, for **Try again**; resolves true when the API answered. */
  probe(): Promise<boolean>
}

export const OFFLINE_PROBE_MS = 5_000
export const IDLE_PROBE_MS = 10_000
const PROBE_TIMEOUT_MS = 4_000

function browserEnvironment(): ConnectionEnvironment {
  return {
    online: () => typeof navigator === "undefined" || navigator.onLine !== false,
    visible: () => typeof document === "undefined" || document.visibilityState !== "hidden",
    listen(events) {
      const visibility = () => {
        if (document.visibilityState === "visible") events.visible()
      }
      window.addEventListener("online", events.online)
      window.addEventListener("offline", events.offline)
      document.addEventListener("visibilitychange", visibility)
      return () => {
        window.removeEventListener("online", events.online)
        window.removeEventListener("offline", events.offline)
        document.removeEventListener("visibilitychange", visibility)
      }
    },
    fetch: (...args) => fetch(...args),
  }
}

export function createConnectionStore(environment?: ConnectionEnvironment): ConnectionStore {
  let snapshot: ConnectionSnapshot = { state: "online", since: Date.now(), lastSuccessAt: null }
  const listeners = new Set<() => void>()
  let env: ConnectionEnvironment | null = null
  let probeUrl: string | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let probing: Promise<boolean> | null = null
  let lastSuccessAt: number | null = null
  // The last time anything (a request or a probe) reached the API: the idle probe waits on it.
  let lastContactAt = Date.now()

  const set = (state: ConnectionState) => {
    if (snapshot.state === state) return
    // A new object only when the state changes, so React renders only then.
    snapshot = { state, since: Date.now(), lastSuccessAt }
    for (const listener of listeners) listener()
  }

  const schedule = () => {
    clearTimeout(timer)
    timer = undefined
    if (!env || !probeUrl || !env.visible()) return
    const delay =
      snapshot.state === "offline"
        ? OFFLINE_PROBE_MS
        : Math.max(0, lastContactAt + IDLE_PROBE_MS - Date.now())
    timer = setTimeout(() => void probe(), delay)
  }

  const contact = () => {
    lastContactAt = Date.now()
    set("online")
    schedule()
  }

  const lost = () => {
    const wasOnline = snapshot.state === "online"
    set("offline")
    // One lost response should not hold the page offline for 5 s: check at once.
    if (wasOnline && env?.visible()) void probe()
    else schedule()
  }

  function probe(): Promise<boolean> {
    if (!env || !probeUrl) return Promise.resolve(snapshot.state === "online")
    if (probing) return probing
    const request = env.fetch(probeUrl, {
      mode: "no-cors",
      cache: "no-store",
      credentials: "omit",
      signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(PROBE_TIMEOUT_MS) : undefined,
    })
    probing = request.then(
      () => {
        contact()
        return true
      },
      () => {
        lost()
        return false
      },
    ).finally(() => {
      probing = null
    })
    return probing
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    start(options) {
      env = environment ?? browserEnvironment()
      probeUrl = options.probeUrl
      lastContactAt = Date.now()
      if (!env.online()) set("offline")
      const unlisten = env.listen({
        // The event only says a network is back; the probe says whether the API is.
        online: () => void probe(),
        offline: lost,
        visible: () => {
          if (snapshot.state === "offline" || Date.now() - lastContactAt >= IDLE_PROBE_MS) void probe()
          else schedule()
        },
      })
      schedule()
      return () => {
        unlisten()
        clearTimeout(timer)
        timer = undefined
        env = null
        probeUrl = null
      }
    },
    reportSuccess() {
      lastSuccessAt = Date.now()
      contact()
    },
    reportNetworkFailure: lost,
    probe,
  }
}

/** The page's one connection store, started by the app (the portal's main.tsx). */
export const connection = createConnectionStore()
