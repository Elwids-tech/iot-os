import { useEffect, useState } from "react"
import type {
  DirectoryQuery,
  Organization,
  PaginatedResponse,
} from "@iot-os/api-client"
import { useSearchParams } from "react-router-dom"
import { apiClient } from "../lib/api-client"

type DirectoryState<T> = {
  data?: PaginatedResponse<T>
  error: boolean
}

export function isFiltered(query: DirectoryQuery): boolean {
  return Boolean(query.search || query.organization || (query.page ?? 1) > 1)
}

export function useDirectoryParameters(): DirectoryQuery {
  const [searchParams] = useSearchParams()
  const parsedPage = Number.parseInt(searchParams.get("page") ?? "1", 10)

  return {
    search: searchParams.get("search") ?? undefined,
    organization: searchParams.get("organization") ?? undefined,
    page: Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1,
    perPage: 25,
  }
}

export function useDirectory<T>(
  load: (query: DirectoryQuery) => Promise<PaginatedResponse<T>>,
  query: DirectoryQuery,
): DirectoryState<T> & { reload: () => void } {
  const [state, setState] = useState<DirectoryState<T>>({ error: false })
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let active = true

    setState({ error: false })
    load(query)
      .then((data) => {
        if (active) setState({ data, error: false })
      })
      .catch(() => {
        if (active) setState({ error: true })
      })

    return () => {
      active = false
    }
  }, [load, query.organization, query.page, query.perPage, query.search, version])

  return { ...state, reload: () => setVersion((current) => current + 1) }
}

export function useOrganizationOptions(): Organization[] {
  const [organizations, setOrganizations] = useState<Organization[]>([])

  useEffect(() => {
    let active = true

    apiClient
      .adminOrganizations({ perPage: 100 })
      .then((response) => {
        if (active) setOrganizations(response.data)
      })
      .catch(() => {
        if (active) setOrganizations([])
      })

    return () => {
      active = false
    }
  }, [])

  return organizations
}
