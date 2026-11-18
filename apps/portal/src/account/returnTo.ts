/**
 * Where setup goes when it is done (spec 034): back to the page that was refused. Only a
 * portal path, the admin app, or the API's agent consent page are followed; anything else
 * returns to the portal's start, so a crafted link cannot send a person elsewhere.
 */
export type ReturnTarget = { kind: "portal"; path: string } | { kind: "external"; url: string }

export function returnTarget(value: string | null, origins: { admin: string; api: string }): ReturnTarget {
  const home: ReturnTarget = { kind: "portal", path: "/" }
  if (!value) return home
  if (value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\")) {
    return value.startsWith("/account/security/setup") ? home : { kind: "portal", path: value }
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return home
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return home
  if (sameOrigin(url, new URL(origins.admin))) return { kind: "external", url: url.toString() }
  if (sameOrigin(url, new URL(origins.api)) && url.pathname === "/oauth/authorize") return { kind: "external", url: url.toString() }
  return home
}

const loopback = ["localhost", "127.0.0.1"]

/** On a developer's machine `localhost` and `127.0.0.1` are the same host, as `lib/api.ts` treats them. */
function sameOrigin(a: URL, b: URL) {
  if (a.origin === b.origin) return true
  return a.protocol === b.protocol && a.port === b.port && loopback.includes(a.hostname) && loopback.includes(b.hostname)
}
