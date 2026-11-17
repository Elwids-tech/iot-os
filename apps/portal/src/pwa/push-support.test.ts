import { describe, expect, it } from "vitest"
import { decodeKey, deviceLabel, support } from "./push-support"

const ua = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  ipad: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  android: "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  samsung: "Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  firefox: "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
}

const page = (userAgent: string, options: { standalone?: boolean; touch?: number; platform?: string; permission?: NotificationPermission; push?: boolean } = {}) => ({
  matchMedia: (query: string) => ({ matches: Boolean(options.standalone) && query.includes("standalone") }),
  navigator: { userAgent, maxTouchPoints: options.touch ?? 0, platform: options.platform, serviceWorker: {} } as unknown as Navigator,
  PushManager: options.push === false ? undefined : {},
  Notification: options.push === false ? undefined : { permission: options.permission ?? "default" },
})

describe("support", () => {
  it("asks iPhone and iPad to add the app to the Home Screen first", () => {
    expect(support(page(ua.iphone, { push: false }))).toBe("ios-needs-install")
    expect(support(page(ua.ipad, { platform: "MacIntel", touch: 5, push: false }))).toBe("ios-needs-install")
    expect(support(page(ua.iphone, { standalone: true }))).toBe("supported")
  })

  it("tells apart browsers without push and blocked notifications", () => {
    expect(support(page(ua.iphone, { standalone: true, push: false }))).toBe("unsupported")
    expect(support(page(ua.firefox, { push: false }))).toBe("unsupported")
    expect(support(page(ua.android, { permission: "denied" }))).toBe("denied")
    expect(support(page(ua.android, { permission: "granted" }))).toBe("supported")
  })
})

describe("deviceLabel", () => {
  it("names the browser and the system", () => {
    const label = (userAgent: string, extra: Partial<Navigator> = {}) => deviceLabel({ userAgent, maxTouchPoints: 0, ...extra } as Navigator)
    expect(label(ua.iphone)).toBe("Safari on iPhone")
    expect(label(ua.ipad, { platform: "MacIntel", maxTouchPoints: 5 })).toBe("Safari on iPad")
    expect(label(ua.android)).toBe("Chrome on Android")
    expect(label(ua.samsung)).toBe("Samsung Internet on Android")
    expect(label(ua.mac)).toBe("Chrome on Mac")
    expect(label(ua.edge)).toBe("Edge on Windows")
    expect(label(ua.firefox)).toBe("Firefox on Linux")
    expect(label("curl/8")).toBe("Browser")
  })
})

describe("decodeKey", () => {
  it("reads a base64url VAPID key without padding", () => {
    expect([...decodeKey("AQID_-8")]).toEqual([1, 2, 3, 255, 239])
  })
})
