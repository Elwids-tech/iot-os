import { useSyncExternalStore } from "react"

/*
 * Where each viewer last was in Dashboards, per organization: the library, or one
 * dashboard with its view (time range, variables). The sidebar's Dashboards link
 * returns there, so leaving a dashboard and coming back doesn't mean finding it again.
 * Stored in the browser only; it is a convenience, never shared.
 */

type Place = { id: string; search: string } | null

// Kiosk mode, an open panel editor and a full-screen panel are moments, not places to return to.
const TRANSIENT = ["kiosk", "edit-panel", "panel"]
const listeners = new Set<() => void>()
// As model.ts's dashboardPath; the shell imports this file, so it stays clear of the dashboard model and its grid.
const dashboardPath = (org: string, id?: string) =>
  `/organizations/${encodeURIComponent(org)}/dashboards${id ? "/" + encodeURIComponent(id) : ""}`
const key = (viewer: number, org: string) => `iot-os:last-dashboard:${viewer}:${org}`

function read(viewer: number, org: string): string | null {
  try {
    return localStorage.getItem(key(viewer, org))
  } catch {
    return null
  }
}

/** Records the library (`id` null) or a dashboard and its view as the viewer's place. */
export function rememberDashboardPlace(viewer: number, org: string, id: string | null, search = "") {
  const params = new URLSearchParams(search)
  for (const name of TRANSIENT) params.delete(name)
  const place: Place = id ? { id, search: params.size ? `?${params}` : "" } : null
  const value = JSON.stringify(place)
  if (read(viewer, org) === value) return
  try {
    localStorage.setItem(key(viewer, org), value)
  } catch {
    // Storage can be blocked; Dashboards then opens on the library as before.
  }
  for (const listener of listeners) listener()
}

/** The path of the viewer's last place in Dashboards, or the library. */
export function lastDashboardPath(viewer: number, org: string): string {
  try {
    const place = JSON.parse(read(viewer, org) ?? "null") as Place
    if (place && typeof place.id === "string" && typeof place.search === "string")
      return dashboardPath(org, place.id) + place.search
  } catch {
    // An unreadable entry falls back to the library.
  }
  return dashboardPath(org)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  // Another tab moving between dashboards updates this one's link too.
  window.addEventListener("storage", listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", listener)
  }
}

/** The sidebar's Dashboards destination, updated as soon as the place changes. */
export function useLastDashboardPath(viewer: number, org: string): string {
  return useSyncExternalStore(subscribe, () => lastDashboardPath(viewer, org))
}
