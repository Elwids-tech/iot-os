import { useMemo } from "react"
import type { DirectoryQuery, Organization, PaginatedResponse } from "@iot-os/api-client"
import type { DataFilter, DataTableProps } from "@iot-os/ui/components/data-table"
import { useUrlState } from "@iot-os/ui/hooks/use-url-state"
import { DirectoryError } from "./DirectoryStates"
import { useDirectory, useDirectoryParameters } from "../hooks/use-directory"

/**
 * One admin directory endpoint as DataTable props: search and the
 * organization filter live in the URL, apply as you type, and page on the
 * server. Pages add columns, actions and their CollectionPage.
 */
export function useDirectoryTable<T>(
  load: (query: DirectoryQuery) => Promise<PaginatedResponse<T>>,
  { searchPlaceholder, organizations }: { searchPlaceholder: string; organizations?: Organization[] },
) {
  const url = useUrlState()
  const query = useDirectoryParameters()
  const { data, error, reload } = useDirectory(load, query)
  const organizationFilter = useMemo<DataFilter<T>[]>(
    () =>
      organizations
        ? [
            {
              id: "organization",
              label: "Organization",
              options: organizations.map((organization) => ({
                value: organization.uuid,
                label: organization.name,
              })),
              value: query.organization ? [query.organization] : [],
              onChange: (value) => url.set({ organization: value[0] ?? null }),
            },
          ]
        : [],
    [organizations, query.organization, url],
  )
  const table = {
    rows: data?.data,
    error: error ? <DirectoryError /> : undefined,
    search: {
      label: "Search",
      placeholder: searchPlaceholder,
      value: query.search ?? "",
      onChange: (value: string) => url.set({ search: value }),
    },
    filters: organizationFilter,
    filtered: Boolean(query.search || query.organization),
    onReset: () => url.clear(["search", "organization"]),
    pagination: {
      page: query.page ?? 1,
      pageSize: query.perPage ?? 25,
      total: data?.meta.total ?? 0,
      pageCount: data?.meta.last_page,
      onPageChange: (page: number) => url.set({ page: page > 1 ? String(page) : null }),
    },
  } satisfies Partial<DataTableProps<T>>
  return { data, reload, query, table }
}
