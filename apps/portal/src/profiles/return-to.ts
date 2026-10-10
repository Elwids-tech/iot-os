/**
 * A `returnTo` value that is safe to navigate to: a same-origin path under /organizations/.
 * Absolute, protocol-relative and traversal values resolve elsewhere and are ignored.
 */
export function safeReturnTo(value: string | null | undefined, origin: string) {
  if (!value || !value.startsWith("/organizations/") || value.includes("\\"))
    return null
  try {
    const url = new URL(value, origin)
    if (url.origin !== origin || !url.pathname.startsWith("/organizations/"))
      return null
    return url.pathname + url.search + url.hash
  } catch {
    return null
  }
}

/** Adds `returnTo` to an in-app path so the way back survives navigation. */
export function withReturnTo(path: string, returnTo: string | null) {
  if (!returnTo) return path
  return `${path}${path.includes("?") ? "&" : "?"}returnTo=${encodeURIComponent(returnTo)}`
}

/** Sets one query parameter on a safe in-app path. */
export function withParam(path: string, key: string, value: string) {
  const url = new URL(path, "http://app.invalid")
  url.searchParams.set(key, value)
  return url.pathname + url.search + url.hash
}
