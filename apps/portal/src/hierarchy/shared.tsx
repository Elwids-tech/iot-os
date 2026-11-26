import { useInfiniteQuery, useQuery, type QueryClient } from "@tanstack/react-query"
import { useParams } from "react-router-dom"
import type { EntityCapabilities, EntitySummary } from "@iot-os/api-client"
import { PageTabs } from "@iot-os/ui/components/page-tabs"
import type { TreeLevel } from "@iot-os/ui/components/tree-table"
import { api } from "../lib/api"
import { RequestError } from "../components/forms"

export { allowedTypes, entityLabel } from "./model"

const denied: EntityCapabilities = { view: false, manage: false, manage_types: false }

export const hierarchyPath = (org: string, entity = "") =>
  `/organizations/${encodeURIComponent(org)}/hierarchy${entity ? "/" + encodeURIComponent(entity) : ""}`

/** The organization and what the signed-in person may do with its hierarchy. */
export function useHierarchyOrganization() {
  const { organizationUuid = "" } = useParams()
  const query = useQuery({
    queryKey: ["device-organization", organizationUuid],
    queryFn: () => api.organizationContext(organizationUuid),
  })
  return {
    org: organizationUuid,
    capabilities: query.data?.capabilities?.entities ?? denied,
    query,
  }
}

/** The Hierarchy area's pages: the tree, its types, and geofences (formerly under Locations). */
export function HierarchyTabs({ org }: { org: string }) {
  return (
    <PageTabs
      label="Hierarchy"
      items={[
        { to: hierarchyPath(org), label: "Tree", end: true },
        { to: `${hierarchyPath(org)}/types`, label: "Types" },
        { to: `/organizations/${encodeURIComponent(org)}/geofences`, label: "Geofences" },
      ]}
    />
  )
}

export function useEntityTypes(org: string) {
  return useQuery({ queryKey: ["entity-types", org], queryFn: () => api.entityTypes(org), enabled: Boolean(org) })
}

/** One level of the tree, a page of 100 at a time, from the query cache. */
export function useEntityLevel(org: string) {
  return function useLevel(parent: EntitySummary | null): TreeLevel<EntitySummary> {
    const query = useInfiniteQuery({
      queryKey: ["entities", org, "level", parent?.uuid ?? null],
      queryFn: ({ pageParam }) => api.entities(org, { parent: parent?.uuid ?? null, page: pageParam }),
      initialPageParam: 1,
      getNextPageParam: (last) => (last.meta && last.meta.current_page < last.meta.last_page ? last.meta.current_page + 1 : undefined),
    })
    return {
      rows: query.data?.pages.flatMap((page) => page.data),
      total: query.data?.pages[0]?.meta?.total,
      hasMore: Boolean(query.hasNextPage),
      loadingMore: query.isFetchingNextPage,
      onLoadMore: () => void query.fetchNextPage(),
      error: query.error ? <RequestError error={query.error} /> : undefined,
    }
  }
}

/** After any change to the tree: every level, every entity page, and lists that filter by entity. */
export function refreshHierarchy(client: QueryClient, org: string) {
  return Promise.all([
    client.invalidateQueries({ queryKey: ["entities", org] }),
    client.invalidateQueries({ queryKey: ["entity", org] }),
    client.invalidateQueries({ queryKey: ["entity-types", org] }),
    client.invalidateQueries({ queryKey: ["sites", org] }),
  ])
}
