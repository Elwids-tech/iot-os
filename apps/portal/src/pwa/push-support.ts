import { iosSafari, standalone } from "./install"

/**
 * What push needs from this browser, without touching it (spec 033, US2). Pure, so Vitest
 * runs it without a page.
 */
export type PushSupport = "supported" | "ios-needs-install" | "unsupported" | "denied"

type Page = Parameters<typeof iosSafari>[0] & {
  Notification?: { permission: NotificationPermission }
  PushManager?: unknown
}

/** What this browser can do, before asking anything. */
export function support(page: Page = window as unknown as Page): PushSupport {
  // Safari on iPhone and iPad offers push only to an app added to the Home Screen.
  if (iosSafari(page) && !standalone(page)) return "ios-needs-install"
  if (!("serviceWorker" in page.navigator) || !page.PushManager || !page.Notification) return "unsupported"
  if (page.Notification.permission === "denied") return "denied"
  return "supported"
}

/** For example "Safari on iPhone" or "Chrome on Android": how the device list names this browser. */
export function deviceLabel(navigator: Page["navigator"] = window.navigator): string {
  const ua = navigator.userAgent
  const browser = /\bEdg(A|iOS)?\//.test(ua)
    ? "Edge"
    : /SamsungBrowser\//.test(ua)
      ? "Samsung Internet"
      : /\bOPR\//.test(ua)
        ? "Opera"
        : /Firefox\/|FxiOS\//.test(ua)
          ? "Firefox"
          : /CriOS\/|Chrome\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : "Browser"
  const system = /\biPhone\b/.test(ua)
    ? "iPhone"
    : /\biPad\b/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /CrOS/.test(ua)
          ? "ChromeOS"
          : /Macintosh|Mac OS X/.test(ua)
            ? "Mac"
            : /Windows/.test(ua)
              ? "Windows"
              : /Linux/.test(ua)
                ? "Linux"
                : ""
  return (system ? `${browser} on ${system}` : browser).slice(0, 60)
}

/** The VAPID public key (base64url) as the bytes `applicationServerKey` takes. */
export function decodeKey(key: string): Uint8Array<ArrayBuffer> {
  const base64 = key.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (key.length % 4)) % 4)
  const raw = atob(base64)
  const bytes = new Uint8Array(raw.length)
  for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index)
  return bytes
}
