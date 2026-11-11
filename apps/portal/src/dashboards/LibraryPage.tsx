import { RelativeTime } from "@iot-os/ui/components/freshness"
import { useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import type { Dashboard, DashboardCapabilities } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@iot-os/ui/components/dropdown-menu"
import { DataTable, RowLink, type DataColumn } from "@iot-os/ui/components/data-table"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { Status } from "@iot-os/ui/components/status-mark"
import { CollectionPage } from "@iot-os/ui/templates/collection-page"
import { cn } from "@iot-os/ui/lib/utils"
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CpuIcon,
  EllipsisIcon,
  FileUpIcon,
  LayoutDashboardIcon,
  LayoutTemplateIcon,
  LockIcon,
  PlusIcon,
  StarIcon,
  Trash2Icon,
} from "lucide-react"
import { api } from "../lib/api"
import { Confirm, errorMessage, RequestError } from "../components/forms"
import { dashboardPath } from "./model"
import { dashboardAbilities } from "./access"
import { forgetDashboardPlace } from "./lastPlace"
import { ShareDialog } from "./ShareDialog"
import { definition, downloadJson } from "./importExport"
import type { DashboardTemplate } from "./templates"
import {
  BlankDialog,
  DuplicateDialog,
  GenerateDialog,
  ImportDialog,
  SettingsDialog,
  TemplatesDialog,
} from "./LibraryDialogs"

const VIEWS = {
  all: "All",
  starred: "Starred",
  recent: "Recently viewed",
  mine: "Created by me",
} as const
type View = keyof typeof VIEWS
const SORTS = { viewed: "Last viewed", name: "Name", updated: "Updated" }
type Sort = keyof typeof SORTS
/** Folder filter value for dashboards without a folder; `?folder=` (empty) means the same. */
const UNFILED = "__unfiled__"
/** Choices after the default, "Not archived"; "All" includes archived dashboards. */
const ARCHIVED = { only: "Archived", include: "All" } as const
type Archived = keyof typeof ARCHIVED

type Open =
  | { kind: "blank" | "import" | "profile" | "templates" }
  | { kind: "template"; template: DashboardTemplate }
  | { kind: "settings" | "move" | "duplicate" | "share"; uuid: string }
  | { kind: "delete"; uuids: string[] }

/** Devices a dashboard reads from, by uuid, with the name the panels saved. */
function devicesOf(dashboard: Dashboard) {
  const devices = new Map<string, string>()
  for (const widget of dashboard.widgets) {
    for (const s of widget.config.sources)
      devices.set(s.device_uuid, s.device_name ?? s.device_uuid)
    for (const d of widget.config.devices ?? [])
      devices.set(d.device_uuid, d.device_name ?? d.device_uuid)
    for (const id of widget.config.location_device_uuids ?? [])
      if (!devices.has(id)) devices.set(id, id)
  }
  return devices
}

/** Next search string with `values` replacing their keys; null removes a key. */
function patch(
  params: URLSearchParams,
  values: Record<string, string | string[] | null>,
) {
  const next = new URLSearchParams(params)
  for (const [key, value] of Object.entries(values)) {
    next.delete(key)
    if (value !== null) for (const item of [value].flat()) next.append(key, item)
  }
  return "?" + next.toString()
}


export function DashboardLibrary({
  org,
  capabilities,
}: {
  org: string
  capabilities: DashboardCapabilities
}) {
  const canCreate = capabilities.create
  // The library filters archived dashboards itself, so it reads them with the others.
  const query = useQuery({
    queryKey: ["dashboards", org, "library"],
    queryFn: () => api.dashboards(org, "include"),
  })
  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => api.me(),
    staleTime: 60000,
  })
  const cache = useQueryClient(),
    navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [open, setOpen] = useState<Open | null>(null)

  const rawView = params.get("view")
  const view: View = rawView && rawView in VIEWS ? (rawView as View) : "all"
  // null: any folder; "": dashboards without one.
  const rawFolder = params.get("folder")
  const folder = rawFolder === null ? null : rawFolder === UNFILED ? "" : rawFolder
  const search = params.get("q") ?? ""
  const tags = params.getAll("tag")
  const devices = params.getAll("device")
  const rawSort = params.get("sort")
  const sort: Sort = rawSort && rawSort in SORTS ? (rawSort as Sort) : "viewed"
  const rawArchived = params.get("archived")
  const archived: Archived | null = rawArchived && rawArchived in ARCHIVED ? (rawArchived as Archived) : null
  // "All" widens the default view, so its count reads as a total, not a match.
  const filtered = Boolean(search || tags.length || devices.length || folder !== null || archived === "only")

  // Templates used to be a view; old links open the template picker instead.
  useEffect(() => {
    if (rawView !== "templates") return
    if (canCreate) setOpen({ kind: "templates" })
    setParams(patch(params, { view: null }), { replace: true })
  }, [rawView, canCreate])

  const everything = query.data ?? []
  const archivedTotal = everything.filter((d) => d.archived_at).length
  const all = everything.filter((d) => archived === "include" || (archived === "only") === Boolean(d.archived_at))
  const inView: Record<View, (d: Dashboard) => boolean> = {
    all: () => true,
    starred: (d) => d.starred,
    recent: (d) => Boolean(d.last_viewed_at),
    mine: (d) => Boolean(session.data && d.created_by === session.data.id),
  }
  const byView = Object.fromEntries(
    (Object.keys(VIEWS) as View[]).map((v) => [v, all.filter(inView[v])]),
  ) as Record<View, Dashboard[]>
  const folders = [
    ...new Set(all.flatMap((d) => (d.folder ? [d.folder] : []))),
  ].sort((a, b) => a.localeCompare(b))
  const unfiled = all.filter((d) => !d.folder).length
  const allTags = [...new Set(all.flatMap((d) => d.tags))].sort()
  const allDevices = new Map<string, string>()
  for (const d of all) for (const [id, name] of devicesOf(d)) allDevices.set(id, name)

  const needle = search.trim().toLowerCase()
  const matches = (d: Dashboard) =>
    (folder === null || (d.folder ?? "") === folder) &&
    (!needle ||
      d.name.toLowerCase().includes(needle) ||
      d.tags.some((t) => t.toLowerCase().includes(needle)) ||
      [...devicesOf(d).values()].some((n) => n.toLowerCase().includes(needle))) &&
    (!tags.length || d.tags.some((t) => tags.includes(t))) &&
    (!devices.length || [...devicesOf(d).keys()].some((id) => devices.includes(id)))
  // The default view says how many archived dashboards it leaves out of what would match.
  const hiddenArchived = archived
    ? 0
    : everything.filter((d) => d.archived_at && inView[view](d) && matches(d)).length
  const showArchived = () => setParams(patch(params, { archived: "include" }), { replace: true })
  const rows = byView[view]
    .filter(matches)
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : sort === "updated"
          ? b.updated_at.localeCompare(a.updated_at)
          : (b.last_viewed_at ?? "").localeCompare(a.last_viewed_at ?? "") ||
            a.name.localeCompare(b.name),
    )
  const find = (uuid: string) => everything.find((d) => d.uuid === uuid)

  async function created(dashboard: Dashboard, edit = false) {
    cache.setQueryData(["dashboard", org, dashboard.uuid], dashboard)
    await cache.invalidateQueries({ queryKey: ["dashboards", org] })
    setOpen(null)
    navigate(dashboardPath(org, dashboard.uuid), edit ? { state: { edit } } : undefined)
  }
  async function star(dashboard: Dashboard) {
    try {
      const next = await api.starDashboard(org, dashboard.uuid, !dashboard.starred)
      cache.setQueriesData<Dashboard[]>({ queryKey: ["dashboards", org] }, (list) =>
        list?.map((d) => (d.uuid === next.uuid ? next : d)),
      )
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }
  /** Archives (or restores) each dashboard; archiving offers Undo, since nothing is lost. */
  async function setArchived(list: Dashboard[], archive: boolean, undo = false) {
    const results = await Promise.allSettled(
      list.map((d) => (archive ? api.archiveDashboard(org, d.uuid) : api.restoreDashboard(org, d.uuid))),
    )
    if (archive && session.data) for (const d of list) forgetDashboardPlace(session.data.id, org, d.uuid)
    for (const d of list) void cache.invalidateQueries({ queryKey: ["dashboard", org, d.uuid] })
    await cache.invalidateQueries({ queryKey: ["dashboards", org] })
    const failed = results.find((r) => r.status === "rejected")
    if (failed) return void toast.error(errorMessage(failed.reason))
    const what = list.length === 1 ? list[0].name : `${list.length} dashboards`
    if (!archive) return void toast.success(undo ? `${what} is back` : `Restored ${what}`)
    toast.success(`Archived ${what}`, {
      action: { label: "Undo", onClick: () => void setArchived(list, false, true) },
    })
  }
  function exportRows(list: Dashboard[]) {
    if (list.length === 1) downloadJson(list[0].name, definition(list[0]))
    else downloadJson("dashboards", list.map(definition))
  }

  const deleting = open?.kind === "delete" ? open.uuids.flatMap((id) => find(id) ?? []) : []
  const target = open && "uuid" in open ? find(open.uuid) : undefined
  const sortState = [{ id: sort, desc: sort !== "name" }]
  const columns: DataColumn<Dashboard>[] = [
    {
      id: "star",
      header: "Starred",
      headerHidden: true,
      hideable: false,
      mobile: "hidden",
      className: "w-8",
      cell: (d) => (
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={`Star ${d.name}`}
          aria-pressed={d.starred}
          onClick={() => star(d)}
        >
          <StarIcon className={cn(d.starred && "fill-current text-warning")} />
        </Button>
      ),
    },
    {
      id: "name",
      header: "Name",
      mobile: "title",
      sortable: true,
      className: "max-w-64 truncate",
      value: (d) => d.name,
      cell: (d) =>
        d.archived_at ? (
          <span className="flex min-w-0 items-center gap-2">
            <RowLink to={dashboardPath(org, d.uuid)} className="truncate">
              {d.name}
            </RowLink>
            <Status value="archived" className="shrink-0 text-meta" />
          </span>
        ) : (
          <RowLink to={dashboardPath(org, d.uuid)}>{d.name}</RowLink>
        ),
    },
    {
      id: "access",
      header: "Access",
      mobile: "hidden",
      value: (d) => (d.access === "restricted" ? "Restricted" : "Organization"),
      cell: (d) =>
        d.access === "restricted" ? (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground" title="Only the people and roles it is shared with">
            <LockIcon aria-hidden className="size-3.5" />
            Restricted
          </span>
        ) : (
          <span className="text-muted-foreground">Organization</span>
        ),
    },
    { id: "folder", header: "Folder", value: (d) => d.folder, cell: (d) => <span className="text-muted-foreground">{d.folder}</span> },
    {
      id: "tags",
      header: "Tags",
      mobile: "hidden",
      className: "max-w-32 truncate",
      value: (d) => d.tags.join(", "),
      cell: (d) => <span className="text-muted-foreground">{d.tags.join(", ")}</span>,
    },
    { id: "panels", header: "Panels", align: "end", mobile: "hidden", value: (d) => d.widgets.length, cell: (d) => <span className="tabular-nums">{d.widgets.length}</span> },
    { id: "devices", header: "Devices", align: "end", mobile: "hidden", value: (d) => devicesOf(d).size, cell: (d) => <span className="tabular-nums">{devicesOf(d).size}</span> },
    { id: "owner", header: "Owner", hidden: true, mobile: "hidden", value: (d) => d.created_by_name, cell: (d) => <span className="text-muted-foreground">{d.created_by_name}</span> },
    { id: "updated", header: "Updated", sortable: true, mobile: "hidden", value: (d) => d.updated_at, cell: (d) => <RelativeTime at={d.updated_at} className="text-muted-foreground" /> },
    { id: "viewed", header: "Last viewed", sortable: true, value: (d) => d.last_viewed_at, cell: (d) => <RelativeTime at={d.last_viewed_at} className="text-muted-foreground" /> },
  ]
  const emptyTitle = !everything.length
    ? "No dashboards yet"
    : archived === "only"
      ? "No archived dashboards"
      : hiddenArchived && view === "all"
        ? "No current dashboards"
    : view === "starred"
      ? "No starred dashboards"
      : view === "recent"
        ? "No recently viewed dashboards"
        : "No dashboards created by you"

  return (
    <>
      <CollectionPage
        title="Dashboards"
        actions={
          canCreate && (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="More ways to create a dashboard">
                    <EllipsisIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onSelect={() => setOpen({ kind: "templates" })}>
                    <LayoutTemplateIcon />
                    From template…
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setOpen({ kind: "profile" })}>
                    <CpuIcon />
                    From device profile…
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setOpen({ kind: "import" })}>
                    <FileUpIcon />
                    Import JSON…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button size="sm" onClick={() => setOpen({ kind: "blank" })}>
                <PlusIcon data-icon="inline-start" />
                New dashboard
              </Button>
            </>
          )
        }
      >
        <DataTable
          id="dashboards"
          label="Dashboards"
          noun={["dashboard", "dashboards"]}
          rows={query.isPending ? undefined : rows}
          rowKey={(d) => d.uuid}
          rowLabel={(d) => d.name}
          rowHref={(d) => dashboardPath(org, d.uuid)}
          columns={columns}
          views={{
            label: "View",
            value: view,
            onChange: (value) => setParams(patch(params, { view: value === "all" ? null : value }), { replace: true }),
            options: (Object.keys(VIEWS) as View[]).map((value) => ({
              value,
              label: VIEWS[value],
              count: query.isPending ? undefined : byView[value].length,
            })),
          }}
          error={
            query.error ? (
              <RequestError error={query.error}>
                <Button variant="outline" onClick={() => query.refetch()}>
                  Retry dashboards
                </Button>
              </RequestError>
            ) : undefined
          }
          search={{
            label: "Search dashboards",
            placeholder: "Search name, tag or device",
            value: search,
            onChange: (value) => setParams(patch(params, { q: value || null }), { replace: true }),
          }}
          filters={[
            ...(folders.length
              ? [
                  {
                    id: "folder",
                    label: "Folder",
                    options: [
                      ...folders.map((name) => ({ value: name, label: name })),
                      ...(unfiled ? [{ value: UNFILED, label: "Unfiled" }] : []),
                    ],
                    value: folder === null ? [] : [folder || UNFILED],
                    onChange: (next: string[]) => setParams(patch(params, { folder: next[0] ?? null }), { replace: true }),
                  },
                ]
              : []),
            {
              id: "tags",
              label: "Tags",
              multiple: true,
              options: allTags.map((t) => ({ value: t, label: t })),
              value: tags,
              onChange: (next) => setParams(patch(params, { tag: next }), { replace: true }),
            },
            {
              id: "device",
              label: "Device",
              multiple: true,
              options: [...allDevices].map(([value, label]) => ({ value, label })),
              value: devices,
              onChange: (next) => setParams(patch(params, { device: next }), { replace: true }),
            },
            // Libraries that never archive keep their filters as they were.
            ...(archivedTotal || archived
              ? [
                  {
                    id: "archived",
                    label: "Archived",
                    anyLabel: "Not archived",
                    options: (Object.keys(ARCHIVED) as Archived[]).map((value) => ({ value, label: ARCHIVED[value] })),
                    value: archived ? [archived] : [],
                    onChange: (next: string[]) => setParams(patch(params, { archived: next[0] ?? null }), { replace: true }),
                  },
                ]
              : []),
          ]}
          filtered={filtered}
          onReset={() => setParams(patch(params, { q: null, tag: null, device: null, folder: null, archived: null }))}
          note={
            hiddenArchived > 0 && (
              <>
                {hiddenArchived.toLocaleString()} archived {hiddenArchived === 1 ? "dashboard" : "dashboards"} hidden{" "}
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-meta"
                  aria-label="Show archived dashboards"
                  onClick={showArchived}
                >
                  Show
                </Button>
              </>
            )
          }
          sort={{
            value: sortState,
            onChange: (next) => {
              const id = (next[0]?.id ?? "viewed") as Sort
              setParams(patch(params, { sort: id === "viewed" ? null : id }), { replace: true })
            },
          }}
          groups={[
            { id: "folder", label: "Folder", value: (d) => d.folder },
            { id: "owner", label: "Owner", value: (d) => d.created_by_name },
          ]}
          selectable
          bulkActions={({ rows: chosen }) => (
            <>
              <Button size="sm" variant="outline" onClick={() => exportRows(chosen)}>
                Export JSON
              </Button>
              {chosen.every((d) => dashboardAbilities(d, capabilities).delete) && (
                <>
                  {chosen.every((d) => !d.archived_at) && (
                    <Button size="sm" variant="outline" onClick={() => void setArchived(chosen, true)}>
                      <ArchiveIcon data-icon="inline-start" />
                      Archive
                    </Button>
                  )}
                  {chosen.every((d) => d.archived_at) && (
                    <Button size="sm" variant="outline" onClick={() => void setArchived(chosen, false)}>
                      <ArchiveRestoreIcon data-icon="inline-start" />
                      Restore
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setOpen({ kind: "delete", uuids: chosen.map((d) => d.uuid) })}
                  >
                    <Trash2Icon data-icon="inline-start" />
                    Delete
                  </Button>
                </>
              )}
            </>
          )}
          rowActions={(d) => (
            <>
              <DropdownMenuItem asChild>
                <Link to={dashboardPath(org, d.uuid)}>Open</Link>
              </DropdownMenuItem>
              {dashboardAbilities(d, capabilities).share && (
                <DropdownMenuItem onSelect={() => setOpen({ kind: "share", uuid: d.uuid })}>Share</DropdownMenuItem>
              )}
              {canCreate && <DropdownMenuItem onSelect={() => setOpen({ kind: "duplicate", uuid: d.uuid })}>Duplicate</DropdownMenuItem>}
              {dashboardAbilities(d, capabilities).edit && (
                <>
                  <DropdownMenuItem onSelect={() => setOpen({ kind: "settings", uuid: d.uuid })}>Settings</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setOpen({ kind: "move", uuid: d.uuid })}>Move to folder</DropdownMenuItem>
                </>
              )}
              <DropdownMenuItem onSelect={() => exportRows([d])}>Export JSON</DropdownMenuItem>
              {dashboardAbilities(d, capabilities).delete && (
                <>
                  <DropdownMenuSeparator />
                  {/* Archiving needs what deleting does: the owner or Dashboard.manage. */}
                  <DropdownMenuItem onSelect={() => void setArchived([d], !d.archived_at)}>
                    {d.archived_at ? "Restore" : "Archive"}
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onSelect={() => setOpen({ kind: "delete", uuids: [d.uuid] })}>
                    Delete
                  </DropdownMenuItem>
                </>
              )}
            </>
          )}
          empty={
            <EmptyState
              inset
              icon={hiddenArchived ? <ArchiveIcon /> : <LayoutDashboardIcon />}
              title={emptyTitle}
              description={
                hiddenArchived
                  ? `${hiddenArchived.toLocaleString()} archived ${hiddenArchived === 1 ? "dashboard is" : "dashboards are"} hidden from this list.`
                  : !everything.length
                    ? canCreate
                      ? "Start blank, from a template or from a device profile."
                      : "People who can create dashboards add them here."
                    : undefined
              }
              action={
                hiddenArchived ? (
                  <Button variant="outline" size="sm" onClick={showArchived}>
                    Show archived dashboards
                  </Button>
                ) : (
                  !everything.length &&
                  canCreate && (
                    <>
                      <Button size="sm" onClick={() => setOpen({ kind: "blank" })}>
                        <PlusIcon data-icon="inline-start" />
                        New dashboard
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setOpen({ kind: "templates" })}>
                        Browse templates
                      </Button>
                    </>
                  )
                )
              }
            />
          }
        />
      </CollectionPage>

      {open?.kind === "blank" && (
        <BlankDialog
          org={org}
          onClose={() => setOpen(null)}
          onCreated={(d) => created(d, true)}
        />
      )}
      {open?.kind === "import" && (
        <ImportDialog
          org={org}
          onClose={() => setOpen(null)}
          onCreated={(list) => {
            if (list.length === 1) return created(list[0])
            toast.success(`Imported ${list.length} dashboards`)
            setOpen(null)
            return cache.invalidateQueries({ queryKey: ["dashboards", org] })
          }}
        />
      )}
      {open?.kind === "share" && target && (
        <ShareDialog
          org={org}
          dashboard={target}
          link={`${globalThis.location.origin}${dashboardPath(org, target.uuid)}`}
          onClose={() => setOpen(null)}
          onSaved={() => void cache.invalidateQueries({ queryKey: ["dashboards", org] })}
        />
      )}
      {open?.kind === "templates" && (
        <TemplatesDialog
          onUse={(template) => setOpen({ kind: "template", template })}
          onClose={() => setOpen(null)}
        />
      )}
      {(open?.kind === "profile" || open?.kind === "template") && (
        <GenerateDialog
          org={org}
          template={open.kind === "template" ? open.template : undefined}
          folders={folders}
          onClose={() => setOpen(null)}
          onCreated={(d) => created(d)}
        />
      )}
      {(open?.kind === "settings" || open?.kind === "move") && target && (
        <SettingsDialog
          org={org}
          dashboard={target}
          folders={folders}
          folderOnly={open.kind === "move"}
          onReload={() => query.refetch()}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.kind === "duplicate" && target && (
        <DuplicateDialog
          org={org}
          dashboard={target}
          onClose={() => setOpen(null)}
        />
      )}
      <Confirm
        open={open?.kind === "delete"}
        title={
          deleting.length === 1
            ? `Delete ${deleting[0].name}?`
            : `Delete ${deleting.length} dashboards?`
        }
        description={`${
          deleting.length === 1
            ? `${deleting[0].widgets.length} panels. Links to it`
            : "Links to them"
        } stop working. This cannot be undone.`}
        action={deleting.length === 1 ? "Delete dashboard" : "Delete dashboards"}
        onClose={() => setOpen(null)}
        onConfirm={async () => {
          const results = await Promise.allSettled(
            deleting.map((d) => api.deleteDashboard(org, d.uuid)),
          )
          const failed = results.find((r) => r.status === "rejected")
          await cache.invalidateQueries({ queryKey: ["dashboards", org] })
          if (failed) throw failed.reason
        }}
      />
    </>
  )
}
