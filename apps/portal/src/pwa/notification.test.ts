import { describe, expect, it } from "vitest"
import cases from "../../../../contracts/push/v1/alert-push.v1.cases.json"
import fixture from "../../../../contracts/push/v1/alert-push.v1.fixture.json"
import { safePath, toNotification } from "./notification"

// Same day as every case, in UTC; the worker passes the phone's own locale and zone.
const today = new Date("2026-11-21T10:00:00Z")
const render = (payload: unknown, now = today) => toNotification(payload, now, "en-GB", "UTC")
const byDescription = (start: string) => cases.find((item) => item.description.startsWith(start))!.data

describe("toNotification", () => {
  it("shows an activation with severity, device, time and organization", () => {
    expect(render(fixture)).toEqual({
      title: "Warning · Freezer temperature",
      options: {
        body: "Freezer 2 · Activated 2:14 · Workshop",
        tag: "alert-6a1e4b2c-8d9f-4e1a-b3c5-7f2d9e0a1b44",
        icon: "/pwa-192x192.png",
        badge: "/pwa-64x64.png",
        data: { url: "/organizations/0f9c2a1e-5b7d-4c3a-9e21-6a8f0b4d1c77/alerts/6a1e4b2c-8d9f-4e1a-b3c5-7f2d9e0a1b44" },
        renotify: false,
      },
    })
  })

  it("replaces the activation when the same alert clears", () => {
    const cleared = render(byDescription("the clear of the same alert"))
    expect(cleared.title).toBe("Cleared · Freezer temperature")
    expect(cleared.options.body).toBe("Freezer 2 · Cleared 2:31 · Workshop")
    expect(cleared.options.tag).toBe(render(fixture).options.tag)
  })

  it("counts a summary and opens the active, unacknowledged list", () => {
    const summary = render(byDescription("a summary counts"))
    expect([summary.title, summary.options.body, summary.options.tag]).toEqual([
      "7 more alerts",
      "Workshop · since 2:15",
      "summary-0f9c2a1e-5b7d-4c3a-9e21-6a8f0b4d1c77",
    ])
    expect(summary.options.data.url).toBe("/organizations/0f9c2a1e-5b7d-4c3a-9e21-6a8f0b4d1c77/alerts?condition=active&acknowledged=0")
    expect(render({ ...byDescription("a summary counts"), count: 1 }).title).toBe("1 more alert")
  })

  it("confirms a test push and opens My notifications", () => {
    const test = render(byDescription("a test push"))
    expect([test.title, test.options.body, test.options.tag, test.options.data.url]).toEqual([
      "Push is on",
      "This device will get your alerts.",
      "test",
      "/settings/my-notifications",
    ])
  })

  it("leaves out a device it does not know", () => {
    expect(render(byDescription("an automation alert without a known device")).options.body).toBe("Activated 2:14 · Workshop")
  })

  it("adds the date when the alert was not today", () => {
    expect(render(fixture, new Date("2026-11-22T10:00:00Z")).options.body).toBe("Freezer 2 · Activated 21 Nov, 2:14 · Workshop")
  })

  it("uses the phone's own time zone for today and the time", () => {
    // 02:14 UTC is 21:14 the evening before in Toronto, still "today" there at 04:00 UTC.
    expect(toNotification(fixture, new Date("2026-11-21T04:00:00Z"), "en-GB", "America/Toronto").options.body).toBe(
      "Freezer 2 · Activated 21:14 · Workshop",
    )
  })

  it("tolerates what an older worker does not know, and never opens another site", () => {
    // Extra fields are ignored; a summary always counts at least one alert.
    expect(render(byDescription("readings never travel")).title).toBe("Warning · Freezer temperature")
    expect(render(byDescription("a summary must count")).title).toBe("1 more alert")
    expect(render(byDescription("a link always stays")).options.data.url).toBe("/")
  })

  it("shows a generic notification for anything it cannot read", () => {
    for (const payload of [null, "text", { ...fixture, v: 2 }, { ...fixture, kind: "escalated" }, { ...fixture, alert: null }]) {
      expect(render(payload)).toMatchObject({ title: "New alerts", options: { body: "Open the app to see them.", tag: "unknown", data: { url: "/" } } })
    }
  })

  it("renders every valid case of the contract", () => {
    for (const item of cases.filter((entry) => entry.valid)) {
      const shown = render(item.data)
      expect(shown.title, item.description).not.toBe("New alerts")
      expect(shown.options.data.url, item.description).toBe(item.data.url)
    }
  })
})

describe("safePath", () => {
  it("keeps the portal's own organization and settings pages only", () => {
    expect(safePath("/organizations/a/alerts/b")).toBe("/organizations/a/alerts/b")
    expect(safePath("/settings/my-notifications")).toBe("/settings/my-notifications")
    for (const url of ["https://example.com/organizations/a", "//example.com/organizations/a", "/login", "javascript:alert(1)", 7])
      expect(safePath(url)).toBe("/")
  })
})
