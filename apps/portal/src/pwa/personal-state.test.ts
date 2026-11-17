import { QueryClient } from "@tanstack/react-query"
import { describe, expect, it } from "vitest"
import { clearPersonalState, clearPersonalStorage, isPerBrowserKey, isPersonalKey } from "./personal-state"

/** A Storage in memory, as the browser's. */
function memory(entries: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(entries))
  return {
    get length() {
      return values.size
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, String(value)),
    removeItem: (key) => void values.delete(key),
    clear: () => values.clear(),
  }
}

/** Storage the browser refuses (a private window, blocked site data). */
const blocked = new Proxy({} as Storage, {
  get() {
    throw new DOMException("The operation is insecure.", "SecurityError")
  },
})

const personal = {
  "iot-os.selected-organization": "18b842d4-dbe9-44b7-a82f-8409bf31401a",
  "iot-os:last-organization:7": "18b842d4-dbe9-44b7-a82f-8409bf31401a",
  "iot-os:last-dashboard:7:18b842d4-dbe9-44b7-a82f-8409bf31401a": "/organizations/x/dashboards/y",
  "iot-os.alert-bell.chimed.7": JSON.stringify({ id: 41, tab: "a" }),
  "iot-dashboard-status-display": JSON.stringify({ panel: "compact" }),
  "iot-os.push-device": JSON.stringify({ user: 7, uuid: "d0000000-0000-4000-8000-000000000001", endpoint: "https://push.example.com/send/1" }),
}
const perBrowser = {
  "iot-os.alert-bell.sound": "off",
  "iot-skin": "instrument",
  "iot-palette": "ink",
  theme: "dark",
  "iot-dashboard-rail": "true",
  "iot-table:devices:page-size": "50",
}

describe("the storage registry", () => {
  it("names each key personal or per-browser, never both", () => {
    for (const key of Object.keys(personal)) {
      expect(isPersonalKey(key), key).toBe(true)
      expect(isPerBrowserKey(key), key).toBe(false)
    }
    for (const key of Object.keys(perBrowser)) {
      expect(isPerBrowserKey(key), key).toBe(true)
      expect(isPersonalKey(key), key).toBe(false)
    }
  })
})

describe("clearPersonalStorage", () => {
  it("removes the personal keys and all of sessionStorage, and keeps per-browser choices", () => {
    const local = memory({ ...personal, ...perBrowser })
    const session = memory({ "iot-device-onboarding": "{}", "iot-lifecycle": "{}" })
    clearPersonalStorage({ local, session })
    expect(Object.keys(personal).map((key) => local.getItem(key))).toEqual(Object.keys(personal).map(() => null))
    expect(Object.fromEntries(Object.keys(perBrowser).map((key) => [key, local.getItem(key)]))).toEqual(perBrowser)
    expect(session.length).toBe(0)
  })

  it("tolerates storage that throws or is missing", () => {
    expect(() => clearPersonalStorage({ local: blocked, session: blocked })).not.toThrow()
    expect(() => clearPersonalStorage({ local: null, session: undefined })).not.toThrow()
  })
})

describe("clearPersonalState", () => {
  it("drops every cached response and resets the signed-in person last", async () => {
    const cache = new QueryClient()
    cache.setQueryData(["session"], { id: 7, email: "person@example.test" })
    cache.setQueryData(["alerts", "org"], [{ uuid: "a1" }])
    cache.setQueryData(["device", "org", "d1"], { name: "Energy meter" })
    const local = memory({ ...personal, ...perBrowser })
    await clearPersonalState(cache, { local, session: memory() })
    expect(cache.getQueryCache().getAll().map((query) => query.queryKey)).toEqual([["session"]])
    expect(cache.getQueryData(["session"])).toBeUndefined()
    expect(local.getItem("iot-os.selected-organization")).toBeNull()
  })
})
