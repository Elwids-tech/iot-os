import { useCallback } from "react"
import { useLocation, useSearchParams } from "react-router-dom"

/**
 * Table state in the address bar, so a filtered list can be shared and
 * survives reload. Changing anything but the page returns to page one.
 */
export function useUrlState() {
  const [params, setParams] = useSearchParams()
  const { pathname } = useLocation()
  const get = useCallback((key: string) => params.get(key) ?? "", [params])
  const getAll = useCallback((key: string) => params.getAll(key), [params])
  const set = useCallback(
    (values: Record<string, string | string[] | null | undefined>) => {
      // params is the address React last rendered, which can lag the address
      // bar: on a slow machine a filter picked right after clearing the search
      // put the search back. Start from the address bar while it shows this
      // page; a memory router, as in Storybook, keeps its own.
      const next = new URLSearchParams(window.location.pathname === pathname ? window.location.search : params)
      for (const [key, value] of Object.entries(values)) {
        next.delete(key)
        for (const item of [value ?? []].flat()) if (item) next.append(key, item)
      }
      if (!("page" in values)) next.delete("page")
      setParams(next, { replace: true })
    },
    [params, pathname, setParams],
  )
  const clear = useCallback(
    (keys: string[]) => set(Object.fromEntries(keys.map((key) => [key, null]))),
    [set],
  )
  return { params, get, getAll, set, clear }
}
