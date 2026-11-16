import type { QueryClient } from "@tanstack/react-query"

/**
 * What the portal keeps in this browser, and what signing out removes (spec 033, FR-015,
 * research R10). Every `localStorage` key the portal or the kit writes is listed here as
 * personal (it names an organization, a person or their data) or per-browser (a display
 * choice that is not about anyone). A new key belongs in one of the two lists.
 */
export const PERSONAL_KEYS: readonly (string | RegExp)[] = [
  // @iot-os/api-client: the organization requests go to.
  "iot-os.selected-organization",
  // App.tsx: each person's last organization, so the chooser is needed once.
  /^iot-os:last-organization:/,
  // dashboards/lastPlace.ts: the dashboard each person last opened in each organization.
  /^iot-os:last-dashboard:/,
  // alerts/bell/chime.ts: the alert that last chimed for each person.
  /^iot-os\.alert-bell\.chimed\./,
  // dashboards/DashboardWorkspace.tsx: how each dashboard panel shows Status.
  "iot-dashboard-status-display",
]

/** Kept on sign-out: display choices for whoever uses this browser next. */
export const PER_BROWSER_KEYS: readonly (string | RegExp)[] = [
  // alerts/bell/chime.ts: the bell's sound switch.
  "iot-os.alert-bell.sound",
  // @iot-os/ui skin.tsx, palette.tsx and next-themes.
  "iot-skin",
  "iot-palette",
  "theme",
  // dashboards/DashboardWorkspace.tsx: whether the dashboard list rail is open.
  "iot-dashboard-rail",
  // @iot-os/ui data-table.tsx: each table's page size, columns and grouping.
  /^iot-table:/,
]

const matches = (patterns: readonly (string | RegExp)[], key: string) =>
  patterns.some((pattern) => (typeof pattern === "string" ? pattern === key : pattern.test(key)))

export const isPersonalKey = (key: string) => matches(PERSONAL_KEYS, key)
export const isPerBrowserKey = (key: string) => matches(PER_BROWSER_KEYS, key)

type Storages = { local?: Storage | null; session?: Storage | null }

/** The page's storages; either can be missing or throw (private windows, blocked storage). */
function pageStorages(): Storages {
  const read = (name: "localStorage" | "sessionStorage") => {
    try {
      return globalThis[name] ?? null
    } catch {
      return null
    }
  }
  return { local: read("localStorage"), session: read("sessionStorage") }
}

/** Removes every personal key and all of sessionStorage; per-browser keys stay. */
export function clearPersonalStorage({ local, session }: Storages = pageStorages()) {
  try {
    session?.clear()
  } catch {
    // Blocked storage holds nothing to clear.
  }
  try {
    if (!local) return
    const keys: string[] = []
    for (let index = 0; index < local.length; index++) {
      const key = local.key(index)
      if (key !== null && isPersonalKey(key)) keys.push(key)
    }
    for (const key of keys) local.removeItem(key)
  } catch {
    // As above.
  }
}

/**
 * Signs this browser out of everything the portal kept for the person: every cached
 * response, sessionStorage and the personal keys. The session query is reset last, so
 * the app shows sign-in rather than an empty workspace. The app shell in Cache Storage
 * holds no one's data and stays.
 */
export async function clearPersonalState(cache: QueryClient, storages?: Storages) {
  clearPersonalStorage(storages)
  cache.removeQueries({ predicate: (query) => query.queryKey[0] !== "session" })
  cache.getMutationCache().clear()
  await cache.resetQueries({ queryKey: ["session"] })
}
