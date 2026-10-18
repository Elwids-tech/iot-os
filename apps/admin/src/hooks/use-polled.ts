import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Loads data now, again whenever `key` changes, and every `intervalMs` while the tab is
 * visible. A refresh keeps the previous data on screen; `error` is the last failure.
 */
export function usePolled<T>(load: () => Promise<T>, key: string, intervalMs: number | null = null) {
  const [data, setData] = useState<T>()
  const [error, setError] = useState<unknown>()
  const [loading, setLoading] = useState(true)
  const loader = useRef(load)
  loader.current = load
  const generation = useRef(0)

  const reload = useCallback(async () => {
    const current = ++generation.current
    setLoading(true)
    try {
      const next = await loader.current()
      if (current === generation.current) {
        setData(next)
        setError(undefined)
      }
    } catch (caught) {
      if (current === generation.current) setError(caught)
    } finally {
      if (current === generation.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    setData(undefined)
    void reload()
  }, [key, reload])

  useEffect(() => {
    if (!intervalMs) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void reload()
    }, intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs, key, reload])

  return { data, error, loading, reload, setData }
}
