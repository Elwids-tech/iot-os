import { useCallback } from "react"
import { useSearchParams } from "react-router-dom"

/**
 * Table state in the address bar, so a filtered list can be shared and
 * survives reload. Changing anything but the page returns to page one.
 */
export function useUrlState() {
  const [params, setParams] = useSearchParams()
  const get = useCallback((key: string) => params.get(key) ?? "", [params])
  const getAll = useCallback((key: string) => params.getAll(key), [params])
  const set = useCallback(
    (values: Record<string, string | string[] | null | undefined>) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current)
          for (const [key, value] of Object.entries(values)) {
            next.delete(key)
            for (const item of [value ?? []].flat()) if (item) next.append(key, item)
          }
          if (!("page" in values)) next.delete("page")
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )
  const clear = useCallback(
    (keys: string[]) => set(Object.fromEntries(keys.map((key) => [key, null]))),
    [set],
  )
  return { params, get, getAll, set, clear }
}
