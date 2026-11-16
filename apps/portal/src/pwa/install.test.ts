import { afterEach, describe, expect, it, vi } from "vitest"
import { canPrompt, iosSafari, justInstalled, prompt, standalone, subscribeInstall, watchInstallPrompt } from "./install"

const userAgents = {
  iPhone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  // iPadOS asks for desktop sites, so its Safari reads as a Mac.
  iPad: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  android: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
}

function page({
  userAgent = userAgents.android,
  platform = "Linux armv8l",
  maxTouchPoints = 5,
  displayMode = "browser",
  navigatorStandalone,
}: {
  userAgent?: string
  platform?: string
  maxTouchPoints?: number
  displayMode?: string
  navigatorStandalone?: boolean
} = {}) {
  return {
    matchMedia: (query: string) => ({ matches: query === `(display-mode: ${displayMode})` }),
    navigator: { userAgent, platform, maxTouchPoints, standalone: navigatorStandalone },
  }
}

describe("standalone", () => {
  it("is true in the installed app's own window", () => {
    expect(standalone(page({ displayMode: "standalone" }))).toBe(true)
    expect(standalone(page({ displayMode: "window-controls-overlay" }))).toBe(true)
  })

  it("is true for an iPhone Home Screen app, which reports navigator.standalone", () => {
    expect(standalone(page({ userAgent: userAgents.iPhone, navigatorStandalone: true }))).toBe(true)
  })

  it("is false in a browser tab", () => {
    expect(standalone(page())).toBe(false)
    expect(standalone(page({ userAgent: userAgents.iPhone, navigatorStandalone: false }))).toBe(false)
    expect(standalone({ navigator: page().navigator })).toBe(false)
  })
})

describe("iosSafari", () => {
  it("is true on iPhone and on iPad, which reads as a Mac with a touch screen", () => {
    expect(iosSafari(page({ userAgent: userAgents.iPhone, platform: "iPhone" }))).toBe(true)
    expect(iosSafari(page({ userAgent: userAgents.iPad, platform: "MacIntel", maxTouchPoints: 5 }))).toBe(true)
  })

  it("is false on a Mac and on Android", () => {
    expect(iosSafari(page({ userAgent: userAgents.mac, platform: "MacIntel", maxTouchPoints: 0 }))).toBe(false)
    expect(iosSafari(page())).toBe(false)
  })
})

describe("the install prompt (Chromium)", () => {
  let stop: (() => void) | undefined
  afterEach(() => stop?.())

  function offer(outcome: "accepted" | "dismissed") {
    const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt: vi.fn(async () => {}),
      userChoice: Promise.resolve({ outcome }),
    })
    return event
  }

  it("keeps the browser's prompt for Install app and cancels its own infobar", async () => {
    const target = new EventTarget()
    stop = watchInstallPrompt(target)
    const changed = vi.fn()
    const unsubscribe = subscribeInstall(changed)
    expect(canPrompt()).toBe(false)
    expect(await prompt()).toBe("unavailable")

    const event = offer("accepted")
    target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(canPrompt()).toBe(true)
    expect(changed).toHaveBeenCalled()

    expect(await prompt()).toBe("accepted")
    expect(event.prompt).toHaveBeenCalledOnce()
    // An install prompt can be shown once.
    expect(canPrompt()).toBe(false)
    unsubscribe()
  })

  it("reports a dismissed prompt and the app being installed", async () => {
    const target = new EventTarget()
    stop = watchInstallPrompt(target)
    target.dispatchEvent(offer("dismissed"))
    expect(await prompt()).toBe("dismissed")
    expect(justInstalled()).toBe(false)
    target.dispatchEvent(offer("accepted"))
    target.dispatchEvent(new Event("appinstalled"))
    expect(justInstalled()).toBe(true)
    expect(canPrompt()).toBe(false)
  })
})
