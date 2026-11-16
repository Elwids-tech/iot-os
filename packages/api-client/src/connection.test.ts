import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiClient, ApiError } from "./index"
import { createConnectionStore, IDLE_PROBE_MS, OFFLINE_PROBE_MS, type ConnectionEnvironment } from "./connection"

/** A page the test controls: network, visibility, browser events and probe answers. */
function page({ online = true } = {}) {
  const events: Parameters<ConnectionEnvironment["listen"]>[0][] = []
  const state = { online, visible: true, apiUp: true }
  const probes: string[] = []
  const environment: ConnectionEnvironment = {
    online: () => state.online,
    visible: () => state.visible,
    listen(handlers) {
      events.push(handlers)
      return () => events.splice(events.indexOf(handlers), 1)
    },
    fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      probes.push(String(input))
      expect(init).toMatchObject({ mode: "no-cors", cache: "no-store" })
      if (!state.online || !state.apiUp) throw new TypeError("Failed to fetch")
      return new Response(null, { status: 200 })
    }) as typeof fetch,
  }
  return {
    environment,
    state,
    probes,
    fire: (event: "online" | "offline" | "visible") => events.forEach((handlers) => handlers[event]()),
  }
}

const probeUrl = "https://api.example.test/up"

describe("connection store", () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date("2026-11-16T10:00:00Z") }))
  afterEach(() => vi.useRealTimers())

  it("starts from navigator.onLine", () => {
    const offline = page({ online: false })
    const store = createConnectionStore(offline.environment)
    store.start({ probeUrl })
    expect(store.getSnapshot().state).toBe("offline")

    const online = page()
    const other = createConnectionStore(online.environment)
    other.start({ probeUrl })
    expect(other.getSnapshot().state).toBe("online")
  })

  it("goes offline at once on the offline event and notifies subscribers once", async () => {
    const tab = page()
    const store = createConnectionStore(tab.environment)
    const listener = vi.fn()
    store.subscribe(listener)
    store.start({ probeUrl })
    tab.state.online = false
    tab.fire("offline")
    tab.fire("offline")
    expect(store.getSnapshot()).toMatchObject({ state: "offline", since: Date.now() })
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getSnapshot().state).toBe("offline")
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("comes straight back when one request was lost but the API still answers", async () => {
    const tab = page()
    const store = createConnectionStore(tab.environment)
    store.start({ probeUrl })
    store.reportNetworkFailure()
    expect(store.getSnapshot().state).toBe("offline")
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getSnapshot().state).toBe("online")
    expect(tab.probes).toHaveLength(1)
  })

  it("comes back only when the probe reaches the API after the online event", async () => {
    const tab = page({ online: false })
    const store = createConnectionStore(tab.environment)
    store.start({ probeUrl })
    tab.state.online = true
    tab.state.apiUp = false
    tab.fire("online")
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getSnapshot().state).toBe("offline")

    tab.state.apiUp = true
    await vi.advanceTimersByTimeAsync(OFFLINE_PROBE_MS)
    expect(store.getSnapshot().state).toBe("online")
    expect(tab.probes.every((url) => url === probeUrl)).toBe(true)
  })

  it("probes at once, then every 5 s while offline and visible, and not while hidden", async () => {
    const tab = page()
    tab.state.apiUp = false
    const store = createConnectionStore(tab.environment)
    store.start({ probeUrl })
    store.reportNetworkFailure()
    await vi.advanceTimersByTimeAsync(OFFLINE_PROBE_MS * 3)
    expect(tab.probes).toHaveLength(4)

    tab.state.visible = false
    await vi.advanceTimersByTimeAsync(OFFLINE_PROBE_MS)
    expect(tab.probes).toHaveLength(5)
    await vi.advanceTimersByTimeAsync(OFFLINE_PROBE_MS * 4)
    expect(tab.probes).toHaveLength(5)

    tab.state.visible = true
    tab.state.apiUp = true
    tab.fire("visible")
    await vi.advanceTimersByTimeAsync(0)
    expect(tab.probes).toHaveLength(6)
    expect(store.getSnapshot().state).toBe("online")
  })

  it("while online probes only after 10 s without a successful request", async () => {
    const tab = page()
    const store = createConnectionStore(tab.environment)
    store.start({ probeUrl })
    await vi.advanceTimersByTimeAsync(IDLE_PROBE_MS - 1)
    store.reportSuccess()
    await vi.advanceTimersByTimeAsync(IDLE_PROBE_MS - 1)
    expect(tab.probes).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(tab.probes).toHaveLength(1)
    // A network without internet fires no event: the idle probe finds it.
    tab.state.apiUp = false
    await vi.advanceTimersByTimeAsync(IDLE_PROBE_MS)
    expect(store.getSnapshot().state).toBe("offline")
  })

  it("keeps the time of the last response for the offline notice", async () => {
    const tab = page()
    const store = createConnectionStore(tab.environment)
    store.start({ probeUrl })
    store.reportSuccess()
    const answered = Date.now()
    await vi.advanceTimersByTimeAsync(3_000)
    tab.state.apiUp = false
    store.reportNetworkFailure()
    expect(store.getSnapshot()).toMatchObject({ state: "offline", lastSuccessAt: answered })
  })

  it("stops listening and probing when stopped", async () => {
    const tab = page()
    tab.state.apiUp = false
    const store = createConnectionStore(tab.environment)
    const stop = store.start({ probeUrl })
    stop()
    store.reportNetworkFailure()
    await vi.advanceTimersByTimeAsync(OFFLINE_PROBE_MS * 3)
    expect(tab.probes).toHaveLength(0)
  })
})

describe("ApiClient and the connection store", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("turns a network failure into ApiError(0) and reports any response as a success", async () => {
    const { connection } = await import("./connection")
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch")
    }))
    const client = new ApiClient("https://api.example.test")
    const failure = await client.me().catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(ApiError)
    expect((failure as ApiError).status).toBe(0)
    // Sent while online: the response may have been lost after the server acted.
    expect((failure as ApiError).payload).toMatchObject({ offline: false })
    expect(connection.getSnapshot().state).toBe("offline")
    // Sent while already offline: it never reached the server.
    await expect(client.me()).rejects.toMatchObject({ status: 0, payload: { offline: true } })

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "Server Error" }), { status: 500 })))
    await expect(client.me()).rejects.toMatchObject({ status: 500 })
    expect(connection.getSnapshot().state).toBe("online")
  })

  it("leaves an aborted request as the caller's AbortError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new DOMException("The operation was aborted.", "AbortError")
    }))
    const client = new ApiClient("https://api.example.test")
    await expect(client.me()).rejects.toMatchObject({ name: "AbortError" })
  })
})
