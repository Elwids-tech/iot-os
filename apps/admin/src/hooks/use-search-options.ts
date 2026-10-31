import { useEffect, useState } from "react"
import type { PaginatedResponse } from "@iot-os/api-client"

type SearchQuery = { search: string; page: number; perPage: number }

/**
 * Server-side search for a SearchableSelect: debounced, 25 per page, reset to the
 * first page when the search changes. `load` must be stable (module scope).
 */
export function useSearchOptions<T>(load: (query: SearchQuery) => Promise<PaginatedResponse<T>>, enabled = true) {
  const [items, setItems] = useState<T[]>([])
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [loading, setLoading] = useState(enabled)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let current = true
    setLoading(true)
    const timer = window.setTimeout(() => {
      load({ search, page, perPage: 25 })
        .then((result) => {
          if (!current) return
          setItems(result.data)
          setHasNextPage(result.meta.current_page < result.meta.last_page)
          setFailed(false)
        })
        .catch(() => {
          if (current) setFailed(true)
        })
        .finally(() => {
          if (current) setLoading(false)
        })
    }, 200)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [load, search, page, enabled])

  return {
    items,
    failed,
    select: {
      search,
      onSearchChange: (value: string) => {
        setSearch(value)
        setPage(1)
      },
      loading,
      page,
      hasNextPage,
      onPageChange: setPage,
    },
  }
}
