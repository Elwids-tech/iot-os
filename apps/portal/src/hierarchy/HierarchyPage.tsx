import { useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { EntityPreset, EntitySummary } from "@iot-os/api-client"
import { Badge } from "@iot-os/ui/components/badge"
import { Button } from "@iot-os/ui/components/button"
import { DataTable, RowLink, type DataColumn } from "@iot-os/ui/components/data-table"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { FilterBar, FilterSearch } from "@iot-os/ui/components/filter-bar"
import { TreeTable, type TreeTableColumn } from "@iot-os/ui/components/tree-table"
import { CollectionPage } from "@iot-os/ui/templates/collection-page"
import { NetworkIcon, PlusIcon } from "lucide-react"
import { api } from "../lib/api"
import { RequestError } from "../components/forms"
import { EntityForm } from "./EntityForm"
import { HierarchyTabs, hierarchyPath, refreshHierarchy, useEntityLevel, useEntityTypes, useHierarchyOrganization } from "./shared"

/**
 * Devices → Hierarchy (spec 009): the organization's tree of sites, buildings, lines and
 * other places, opened a level at a time; search finds any entity by name or path.
 */
export default function HierarchyPage() {
  const { org, capabilities, query: context } = useHierarchyOrganization()
  const client = useQueryClient()
  const navigate = useNavigate()
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)
  const typed = search.trim()
  const useLevel = useMemo(() => useEntityLevel(org), [org])
  const types = useEntityTypes(org)
  const topLevel = useQuery({ queryKey: ["entities", org, "level", null, "count"], queryFn: () => api.entities(org), enabled: Boolean(org) })
  const results = useQuery({
    queryKey: ["entities", org, "search", typed, page],
    queryFn: () => api.searchEntities(org, typed, page),
    enabled: Boolean(typed),
    placeholderData: keepPreviousData,
  })
  const empty = topLevel.data?.meta?.total === 0
  const noTypes = types.data?.data.every((type) => type.key === "site")

  const treeColumns = useMemo<TreeTableColumn<EntitySummary>[]>(
    () => [
      {
        id: "name",
        header: "Name",
        cell: (entity) => (
          <Link
            to={hierarchyPath(org, entity.uuid)}
            tabIndex={-1}
            className="block truncate font-medium hover:underline"
          >
            {entity.name}
          </Link>
        ),
      },
      { id: "type", header: "Type", phoneHidden: true, cell: (entity) => <Badge variant="outline">{entity.type.name}</Badge> },
      {
        id: "path",
        header: "Path name",
        phoneHidden: true,
        cell: (entity) => <span className="font-mono text-code text-muted-foreground">{entity.path_name}</span>,
      },
      {
        id: "children",
        header: "Inside",
        align: "end",
        phoneHidden: true,
        cell: (entity) => (entity.children_count ? entity.children_count.toLocaleString() : <span className="text-muted-foreground">0</span>),
      },
    ],
    [org],
  )
  const searchColumns = useMemo<DataColumn<EntitySummary>[]>(
    () => [
      {
        id: "name",
        header: "Name",
        mobile: "title",
        cell: (entity) => <RowLink to={hierarchyPath(org, entity.uuid)}>{entity.name}</RowLink>,
      },
      { id: "type", header: "Type", mobile: "badge", cell: (entity) => <Badge variant="outline">{entity.type.name}</Badge> },
      { id: "path", header: "Path", cell: (entity) => <span className="font-mono text-code break-all">{entity.path}</span> },
    ],
    [org],
  )

  if (context.data && !capabilities.view)
    return (
      <CollectionPage title="Hierarchy" tabs={<HierarchyTabs org={org} />}>
        <EmptyState title="No access to the hierarchy" description="Ask an administrator for the Entity view permission." />
      </CollectionPage>
    )

  return (
    <>
      <CollectionPage
        title="Hierarchy"
        description="Where devices and their data sit. Every point has a path through this tree."
        tabs={<HierarchyTabs org={org} />}
        actions={
          capabilities.manage && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <PlusIcon data-icon="inline-start" />
              New entity
            </Button>
          )
        }
        notices={
          <p className="text-body text-muted-foreground">
            Devices outside any site use the organization time zone, set in{" "}
            <Link className="text-foreground underline underline-offset-4" to={`/organizations/${org}/settings/general`}>
              Settings
            </Link>
            .
          </p>
        }
      >
        {empty && noTypes ? (
          <PresetPrompt org={org} canManage={capabilities.manage_types} onCreate={capabilities.manage ? () => setCreating(true) : undefined} />
        ) : (
          <>
            <FilterBar>
              <FilterSearch
                label="Search the hierarchy"
                placeholder="Search names and paths"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                  setPage(1)
                }}
              />
            </FilterBar>
            {typed ? (
              <DataTable
                id="entity-search"
                label="Search results"
                noun={["entity", "entities"]}
                rows={results.data?.data}
                rowKey={(entity) => entity.uuid}
                rowLabel={(entity) => entity.name}
                rowHref={(entity) => hierarchyPath(org, entity.uuid)}
                columns={searchColumns}
                filtered
                error={results.error ? <RequestError error={results.error} /> : undefined}
                pagination={{
                  page,
                  pageSize: results.data?.meta.per_page ?? 25,
                  total: results.data?.meta.total ?? 0,
                  pageCount: results.data?.meta.last_page,
                  onPageChange: setPage,
                }}
                empty={<EmptyState inset title="Nothing matches" description="Search by a name, a path name, or part of a path such as Plant/Line2." />}
              />
            ) : (
              <TreeTable
                label="Hierarchy"
                columns={treeColumns}
                rowKey={(entity) => entity.uuid}
                rowLabel={(entity) => entity.name}
                hasChildren={(entity) => entity.children_count > 0}
                useLevel={useLevel}
                onSelect={(entity) => navigate(hierarchyPath(org, entity.uuid))}
                empty={
                  <EmptyState
                    inset
                    icon={<NetworkIcon />}
                    title="Nothing in the hierarchy yet"
                    description="Start with a site or another top-level place, then add what is inside it."
                    action={
                      capabilities.manage && (
                        <Button size="sm" onClick={() => setCreating(true)}>
                          New entity
                        </Button>
                      )
                    }
                  />
                }
              />
            )}
          </>
        )}
      </CollectionPage>
      {creating && (
        <EntityForm
          org={org}
          parent={null}
          onClose={() => setCreating(false)}
          onSaved={async (entity) => {
            await refreshHierarchy(client, org)
            navigate(hierarchyPath(org, entity.uuid))
          }}
        />
      )}
    </>
  )
}

/** An organization with no entities and only the Site type: offer a preset first. */
function PresetPrompt({ org, canManage, onCreate }: { org: string; canManage: boolean; onCreate?: () => void }) {
  const client = useQueryClient()
  const presets = useQuery({ queryKey: ["entity-presets", org], queryFn: () => api.entityPresets(org) })
  const apply = useMutation({
    mutationFn: (preset: EntityPreset) => api.applyEntityPreset(org, preset.key),
    onSuccess: () =>
      Promise.all([refreshHierarchy(client, org), client.invalidateQueries({ queryKey: ["entity-presets", org] })]),
  })
  return (
    <section aria-labelledby="preset-heading" className="flex flex-col gap-4 rounded-xl bg-card p-6 shadow-panel">
      <div className="flex flex-col gap-1">
        <h2 id="preset-heading" className="text-heading">
          Start from a preset
        </h2>
        <p className="text-body text-muted-foreground">
          A preset adds types and the rules between them, such as which may sit under a site. You can change them
          afterwards under Types.
        </p>
      </div>
      <RequestError error={presets.error ?? apply.error} />
      <ul className="grid gap-3 md:grid-cols-3">
        {(presets.data?.data ?? []).map((preset) => (
          <li key={preset.key} className="flex flex-col gap-3 rounded-lg border p-4">
            <div className="flex flex-col gap-1">
              <h3 className="text-body font-medium">{preset.name}</h3>
              <p className="text-meta text-muted-foreground">{preset.description}</p>
            </div>
            <p className="text-meta text-muted-foreground">
              {preset.types.map((type) => type.name).join(" · ")}
            </p>
            {canManage && (
              <Button
                size="sm"
                variant="outline"
                className="mt-auto self-start"
                disabled={apply.isPending}
                onClick={() => apply.mutate(preset)}
              >
                {apply.isPending && apply.variables?.key === preset.key ? "Applying…" : `Use ${preset.name}`}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {onCreate && (
        <p className="text-body text-muted-foreground">
          Or{" "}
          <Button variant="link" className="h-auto p-0" onClick={onCreate}>
            create a site
          </Button>{" "}
          with the types you have.
        </p>
      )}
    </section>
  )
}
