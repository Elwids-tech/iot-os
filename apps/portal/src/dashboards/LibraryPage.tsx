import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import type { Dashboard } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import { Checkbox } from "@iot-os/ui/components/checkbox"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@iot-os/ui/components/command"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@iot-os/ui/components/dropdown-menu"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@iot-os/ui/components/empty"
import { Input } from "@iot-os/ui/components/input"
import { PageHeader } from "@iot-os/ui/components/page-header"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@iot-os/ui/components/popover"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@iot-os/ui/components/table"
import { formatAge, formatDateTime } from "@iot-os/ui/lib/format"
import { cn } from "@iot-os/ui/lib/utils"
import {
  ChevronDownIcon,
  FolderIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SearchIcon,
  StarIcon,
  Trash2Icon,
} from "lucide-react"
import { api } from "../lib/api"
import { Confirm, errorMessage, RequestError } from "../components/forms"
import { dashboardPath } from "./model"
import { definition, downloadJson } from "./importExport"
import { TEMPLATES, type DashboardTemplate } from "./templates"
import {
  BlankDialog,
  DuplicateDialog,
  GenerateDialog,
  ImportDialog,
  SettingsDialog,
} from "./LibraryDialogs"

const VIEWS = {
  all: "All dashboards",
  starred: "Starred",
  recent: "Recently viewed",
  mine: "Created by me",
  templates: "Templates",
} as const
type View = keyof typeof VIEWS
const SORTS = { viewed: "Last viewed", name: "Name", updated: "Updated" }
type Sort = keyof typeof SORTS

type Open =
  | { kind: "blank" | "import" | "profile" }
  | { kind: "template"; template: DashboardTemplate }
  | { kind: "settings" | "move" | "duplicate"; uuid: string }
  | { kind: "delete"; uuids: string[] }

/** Devices a dashboard reads from, by uuid, with the name the panels saved. */
function devicesOf(dashboard: Dashboard) {
  const devices = new Map<string, string>()
  for (const widget of dashboard.widgets) {
    for (const s of widget.config.sources)
      devices.set(s.device_uuid, s.device_name ?? s.device_uuid)
    for (const d of widget.config.devices ?? [])
      devices.set(d.device_uuid, d.device_name ?? d.device_uuid)
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

function Age({ iso, never = "Never" }: { iso: string | null; never?: string }) {
  if (!iso) return <span className="text-muted-foreground">{never}</span>
  return (
    <time dateTime={iso} title={formatDateTime(iso)}>
      {formatAge(iso)} ago
    </time>
  )
}

export function DashboardLibrary({
  org,
  canManage,
}: {
  org: string
  canManage: boolean
}) {
  const query = useQuery({
    queryKey: ["dashboards", org],
    queryFn: () => api.dashboards(org),
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
  const [selected, setSelected] = useState<string[]>([])

  const rawView = params.get("view")
  const view: View =
    rawView && rawView in VIEWS && (rawView !== "templates" || canManage)
      ? (rawView as View)
      : "all"
  const folder = params.get("folder")
  const search = params.get("q") ?? ""
  const tags = params.getAll("tag")
  const devices = params.getAll("device")
  const rawSort = params.get("sort")
  const sort: Sort = rawSort && rawSort in SORTS ? (rawSort as Sort) : "viewed"
  const filtered = Boolean(search || tags.length || devices.length)

  const all = query.data ?? []
  const byView: Record<Exclude<View, "templates">, Dashboard[]> = {
    all,
    starred: all.filter((d) => d.starred),
    recent: all.filter((d) => d.last_viewed_at),
    mine: all.filter(
      (d) => session.data && d.created_by === session.data.id,
    ),
  }
  const folders = [
    ...new Set(all.flatMap((d) => (d.folder ? [d.folder] : []))),
  ].sort((a, b) => a.localeCompare(b))
  const unfiled = all.filter((d) => !d.folder).length
  const allTags = [...new Set(all.flatMap((d) => d.tags))].sort()
  const allDevices = new Map<string, string>()
  for (const d of all) for (const [id, name] of devicesOf(d)) allDevices.set(id, name)

  const needle = search.trim().toLowerCase()
  const rows = (view === "templates" ? [] : byView[view])
    .filter((d) => folder === null || (d.folder ?? "") === folder)
    .filter(
      (d) =>
        !needle ||
        d.name.toLowerCase().includes(needle) ||
        d.tags.some((t) => t.toLowerCase().includes(needle)) ||
        [...devicesOf(d).values()].some((n) =>
          n.toLowerCase().includes(needle),
        ),
    )
    .filter((d) => !tags.length || d.tags.some((t) => tags.includes(t)))
    .filter(
      (d) =>
        !devices.length || [...devicesOf(d).keys()].some((id) => devices.includes(id)),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : sort === "updated"
          ? b.updated_at.localeCompare(a.updated_at)
          : (b.last_viewed_at ?? "").localeCompare(a.last_viewed_at ?? "") ||
            a.name.localeCompare(b.name),
    )
  const chosen = all.filter((d) => selected.includes(d.uuid))
  const find = (uuid: string) => all.find((d) => d.uuid === uuid)

  async function created(dashboard: Dashboard, edit = false) {
    cache.setQueryData(["dashboard", org, dashboard.uuid], dashboard)
    await cache.invalidateQueries({ queryKey: ["dashboards", org] })
    setOpen(null)
    navigate(dashboardPath(org, dashboard.uuid), edit ? { state: { edit } } : undefined)
  }
  async function star(dashboard: Dashboard) {
    try {
      const next = await api.starDashboard(org, dashboard.uuid, !dashboard.starred)
      cache.setQueryData<Dashboard[]>(["dashboards", org], (list) =>
        list?.map((d) => (d.uuid === next.uuid ? next : d)),
      )
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }
  function exportRows(list: Dashboard[]) {
    if (list.length === 1) downloadJson(list[0].name, definition(list[0]))
    else downloadJson("dashboards", list.map(definition))
  }

  const navLink = (current: boolean) =>
    cn(
      "flex h-8 shrink-0 items-center gap-2 rounded-md px-2 text-sm whitespace-nowrap outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring md:w-full",
      current && "bg-muted font-medium",
    )
  const count = (n: number) => (
    <span className="ml-auto pl-2 text-xs text-muted-foreground tabular-nums">
      {n}
    </span>
  )
  const deleting = open?.kind === "delete" ? open.uuids.flatMap((id) => find(id) ?? []) : []
  const target = open && "uuid" in open ? find(open.uuid) : undefined

  return (
    <>
      <PageHeader
        title="Dashboards"
        actions={
          canManage && (
            <div className="flex">
              <Button
                className="rounded-r-none"
                onClick={() => setOpen({ kind: "blank" })}
              >
                <PlusIcon data-icon="inline-start" />
                New dashboard
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon"
                    className="rounded-l-none border-l-primary-foreground/25"
                    aria-label="More ways to create a dashboard"
                  >
                    <ChevronDownIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-auto">
                  <DropdownMenuItem onSelect={() => setOpen({ kind: "blank" })}>
                    Blank
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      navigate({ search: patch(params, { view: "templates", folder: null }) })
                    }
                  >
                    From template
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setOpen({ kind: "profile" })}>
                    From device profile
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setOpen({ kind: "import" })}>
                    Import JSON
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )
        }
      />
      <div className="grid gap-4 p-4 md:grid-cols-[11rem_minmax(0,1fr)] md:gap-6 md:p-6">
        <nav
          aria-label="Dashboard views"
          className="flex gap-1 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0"
        >
          {(Object.keys(VIEWS) as View[])
            .filter((v) => v !== "templates" || canManage)
            .map((v) => {
              const current = folder === null && view === v
              return (
                <Link
                  key={v}
                  to={{ search: patch(params, { view: v === "all" ? null : v, folder: null }) }}
                  aria-current={current ? "page" : undefined}
                  className={navLink(current)}
                >
                  {VIEWS[v]}
                  {v === "templates"
                    ? count(TEMPLATES.length)
                    : v !== "recent" && count(byView[v].length)}
                </Link>
              )
            })}
          {folders.length > 0 && (
            <>
              <h2 className="skin-label mt-4 hidden px-2 text-xs text-muted-foreground md:block">
                Folders
              </h2>
              {[...folders, ""].map((name) => {
                const current = folder === name
                const n = name ? all.filter((d) => d.folder === name).length : unfiled
                if (!n) return null
                return (
                  <Link
                    key={name || "unfiled"}
                    to={{ search: patch(params, { view: null, folder: name }) }}
                    aria-current={current ? "page" : undefined}
                    className={navLink(current)}
                  >
                    <FolderIcon className="size-4 text-muted-foreground" />
                    <span className="truncate">{name || "Unfiled"}</span>
                    {count(n)}
                  </Link>
                )
              })}
            </>
          )}
        </nav>

        {view === "templates" ? (
          <section aria-labelledby="templates-heading" className="min-w-0">
            <h2 id="templates-heading" className="sr-only">
              Templates
            </h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Template</TableHead>
                  <TableHead className="hidden md:table-cell">Needs</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {TEMPLATES.map((template) => (
                  <TableRow key={template.id}>
                    <TableCell className="whitespace-normal">
                      <div className="font-medium">{template.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {template.creates}
                      </div>
                    </TableCell>
                    <TableCell className="hidden whitespace-normal text-muted-foreground md:table-cell">
                      {template.needs}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Use template ${template.name}`}
                        onClick={() => setOpen({ kind: "template", template })}
                      >
                        Use template
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        ) : (
          <section aria-labelledby="list-heading" className="flex min-w-0 flex-col gap-3">
            <h2 id="list-heading" className="sr-only">
              {folder === null ? VIEWS[view] : folder || "Unfiled"}
            </h2>
            {chosen.length ? (
              <div className="flex min-h-8 flex-wrap items-center gap-2">
                <span className="text-sm font-medium tabular-nums">
                  {chosen.length} selected
                </span>
                <Button size="sm" variant="outline" onClick={() => exportRows(chosen)}>
                  Export JSON
                </Button>
                {canManage && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setOpen({ kind: "delete", uuids: chosen.map((d) => d.uuid) })
                    }
                  >
                    <Trash2Icon data-icon="inline-start" />
                    Delete
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
                  Clear selection
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-full sm:w-64">
                  <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="search"
                    aria-label="Search dashboards"
                    placeholder="Search name, tag or device"
                    className="h-8 pl-8"
                    value={search}
                    onChange={(e) =>
                      setParams(patch(params, { q: e.target.value || null }), {
                        replace: true,
                      })
                    }
                  />
                </div>
                <FilterMenu
                  label="Tags"
                  options={allTags.map((t) => ({ value: t, label: t }))}
                  selected={tags}
                  empty="No tags yet"
                  onChange={(next) => setParams(patch(params, { tag: next }), { replace: true })}
                />
                <FilterMenu
                  label="Device"
                  options={[...allDevices].map(([value, label]) => ({ value, label }))}
                  selected={devices}
                  empty="No devices on these dashboards"
                  onChange={(next) =>
                    setParams(patch(params, { device: next }), { replace: true })
                  }
                />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline">
                      Sort: {SORTS[sort]}
                      <ChevronDownIcon data-icon="inline-end" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuRadioGroup
                      value={sort}
                      onValueChange={(next) =>
                        setParams(patch(params, { sort: next === "viewed" ? null : next }), {
                          replace: true,
                        })
                      }
                    >
                      {(Object.keys(SORTS) as Sort[]).map((s) => (
                        <DropdownMenuRadioItem key={s} value={s}>
                          {SORTS[s]}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
                <span className="ml-auto text-sm text-muted-foreground tabular-nums">
                  {rows.length} {rows.length === 1 ? "dashboard" : "dashboards"}
                </span>
              </div>
            )}
            <RequestError error={query.error} />
            {query.error && (
              <Button variant="outline" className="self-start" onClick={() => query.refetch()}>
                Retry dashboards
              </Button>
            )}
            {query.isPending ? (
              <Skeleton className="h-64 w-full" />
            ) : rows.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="hidden w-8 sm:table-cell">
                      <Checkbox
                        aria-label="Select all dashboards"
                        checked={
                          rows.every((d) => selected.includes(d.uuid))
                            ? true
                            : rows.some((d) => selected.includes(d.uuid))
                              ? "indeterminate"
                              : false
                        }
                        onCheckedChange={(checked) =>
                          setSelected(checked === true ? rows.map((d) => d.uuid) : [])
                        }
                      />
                    </TableHead>
                    <TableHead className="w-8">
                      <span className="sr-only">Starred</span>
                    </TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden sm:table-cell">Folder</TableHead>
                    <TableHead className="hidden lg:table-cell">Tags</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Panels</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Devices</TableHead>
                    <TableHead className="hidden xl:table-cell">Owner</TableHead>
                    <TableHead className="hidden md:table-cell">Updated</TableHead>
                    <TableHead>Last viewed</TableHead>
                    <TableHead className="w-8">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((d) => (
                    <TableRow
                      key={d.uuid}
                      data-state={selected.includes(d.uuid) ? "selected" : undefined}
                    >
                      <TableCell className="hidden sm:table-cell">
                        <Checkbox
                          aria-label={`Select ${d.name}`}
                          checked={selected.includes(d.uuid)}
                          onCheckedChange={(checked) =>
                            setSelected((list) =>
                              checked === true
                                ? [...list, d.uuid]
                                : list.filter((id) => id !== d.uuid),
                            )
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label={`Star ${d.name}`}
                          aria-pressed={d.starred}
                          onClick={() => star(d)}
                        >
                          <StarIcon
                            className={cn(d.starred && "fill-current text-warning")}
                          />
                        </Button>
                      </TableCell>
                      <TableCell className="max-w-64 truncate">
                        <Link
                          to={dashboardPath(org, d.uuid)}
                          className="font-medium underline-offset-4 outline-none hover:underline focus-visible:underline"
                        >
                          {d.name}
                        </Link>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">
                        {d.folder}
                      </TableCell>
                      <TableCell className="hidden max-w-32 truncate text-muted-foreground lg:table-cell">
                        {d.tags.join(", ")}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums sm:table-cell">
                        {d.widgets.length}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums sm:table-cell">
                        {devicesOf(d).size}
                      </TableCell>
                      <TableCell className="hidden max-w-32 truncate text-muted-foreground xl:table-cell">
                        {d.created_by_name}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground tabular-nums md:table-cell">
                        <Age iso={d.updated_at} />
                      </TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">
                        <Age iso={d.last_viewed_at} />
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              aria-label={`Actions for ${d.name}`}
                            >
                              <MoreHorizontalIcon />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-auto">
                            <DropdownMenuItem asChild>
                              <Link to={dashboardPath(org, d.uuid)}>Open</Link>
                            </DropdownMenuItem>
                            {canManage && (
                              <>
                                <DropdownMenuItem
                                  onSelect={() => setOpen({ kind: "duplicate", uuid: d.uuid })}
                                >
                                  Duplicate
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onSelect={() => setOpen({ kind: "settings", uuid: d.uuid })}
                                >
                                  Settings
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onSelect={() => setOpen({ kind: "move", uuid: d.uuid })}
                                >
                                  Move to folder
                                </DropdownMenuItem>
                              </>
                            )}
                            <DropdownMenuItem onSelect={() => exportRows([d])}>
                              Export JSON
                            </DropdownMenuItem>
                            {canManage && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  variant="destructive"
                                  onSelect={() => setOpen({ kind: "delete", uuids: [d.uuid] })}
                                >
                                  Delete
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              !query.error && (
                <Empty className="border">
                  <EmptyHeader>
                    <EmptyTitle>
                      {!all.length
                        ? "No dashboards yet"
                        : filtered
                          ? "No matching dashboards"
                          : view === "starred"
                            ? "No starred dashboards"
                            : view === "recent"
                              ? "No recently viewed dashboards"
                              : "No dashboards created by you"}
                    </EmptyTitle>
                    {!all.length && (
                      <EmptyDescription>
                        {canManage
                          ? "Start blank, from a template or from a device profile."
                          : "People who manage devices can create dashboards for this organization."}
                      </EmptyDescription>
                    )}
                  </EmptyHeader>
                  {filtered ? (
                    <EmptyContent>
                      <Button
                        variant="outline"
                        onClick={() =>
                          setParams(patch(params, { q: null, tag: null, device: null }))
                        }
                      >
                        Clear filters
                      </Button>
                    </EmptyContent>
                  ) : (
                    !all.length &&
                    canManage && (
                      <EmptyContent className="flex-row justify-center">
                        <Button onClick={() => setOpen({ kind: "blank" })}>
                          <PlusIcon data-icon="inline-start" />
                          New dashboard
                        </Button>
                        <Button variant="outline" asChild>
                          <Link to={{ search: patch(params, { view: "templates" }) }}>
                            Browse templates
                          </Link>
                        </Button>
                      </EmptyContent>
                    )
                  )}
                </Empty>
              )
            )}
          </section>
        )}
      </div>

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
          setSelected((list) => list.filter((id) => !deleting.some((d) => d.uuid === id)))
          await cache.invalidateQueries({ queryKey: ["dashboards", org] })
          if (failed) throw failed.reason
        }}
      />
    </>
  )
}

function FilterMenu({
  label,
  options,
  selected,
  onChange,
  empty,
}: {
  label: string
  options: { value: string; label: string }[]
  selected: string[]
  onChange: (next: string[]) => void
  empty: string
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline">
          {label}
          {selected.length > 0 && (
            <span className="tabular-nums text-muted-foreground">
              {selected.length}
            </span>
          )}
          <ChevronDownIcon data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0" aria-label={label}>
        <Command>
          <CommandInput
            aria-label={`Search ${label.toLowerCase()}`}
            placeholder={`Search ${label.toLowerCase()}`}
          />
          <CommandList aria-label={label}>
            <CommandEmpty>{options.length ? "No matches" : empty}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const checked = selected.includes(option.value)
                return (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    keywords={[option.label]}
                    aria-checked={checked}
                    data-checked={checked}
                    onSelect={() =>
                      onChange(
                        checked
                          ? selected.filter((v) => v !== option.value)
                          : [...selected, option.value],
                      )
                    }
                  >
                    {option.label}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
