import { beforeEach, describe, expect, it, vi } from "vitest"
import { lastDashboardPath, rememberDashboardPlace } from "./lastPlace"

describe("last place in Dashboards", () => {
  beforeEach(() => {
    const items = new Map<string, string>()
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
    })
  })

  it("opens the library until a dashboard was viewed", () => {
    expect(lastDashboardPath(7, "org-a")).toBe("/organizations/org-a/dashboards")
  })

  it("returns to the dashboard and its view, without kiosk or an open editor", () => {
    rememberDashboardPlace(7, "org-a", "d-1", "?from=now-24h&kiosk=1&edit-panel=p-1&var-site=north")
    expect(lastDashboardPath(7, "org-a")).toBe("/organizations/org-a/dashboards/d-1?from=now-24h&var-site=north")
  })

  it("keeps each viewer and organization apart", () => {
    rememberDashboardPlace(7, "org-a", "d-1")
    expect(lastDashboardPath(8, "org-a")).toBe("/organizations/org-a/dashboards")
    expect(lastDashboardPath(7, "org-b")).toBe("/organizations/org-b/dashboards")
    expect(lastDashboardPath(7, "org-a")).toBe("/organizations/org-a/dashboards/d-1")
  })

  it("goes back to the library once the viewer returns to it", () => {
    rememberDashboardPlace(7, "org-a", "d-1")
    rememberDashboardPlace(7, "org-a", null)
    expect(lastDashboardPath(7, "org-a")).toBe("/organizations/org-a/dashboards")
  })

  it("falls back to the library when storage is blocked or the entry is unreadable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => "{not json",
      setItem: () => {
        throw new Error("blocked")
      },
    })
    expect(() => rememberDashboardPlace(7, "org-a", "d-1")).not.toThrow()
    expect(lastDashboardPath(7, "org-a")).toBe("/organizations/org-a/dashboards")
  })
})
