import * as React from "react"
import { Link, useNavigate, type LinkProps } from "react-router-dom"
import {
  columnVisibilityFeature,
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  functionalUpdate,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  tableFeatures,
  useTable,
  type ColumnVisibilityState,
  type PaginationState,
  type RowData,
  type RowSelectionState,
  type SortingState,
  type Updater,
} from "@tanstack/react-table"
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  Columns3Icon,
  DownloadIcon,
  EllipsisIcon,
  ListFilterIcon,
  RowsIcon,
  SearchXIcon,
  XIcon,
} from "lucide-react"

import { Button } from "@iot-os/ui/components/button"
import { Checkbox } from "@iot-os/ui/components/checkbox"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@iot-os/ui/components/dropdown-menu"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { FilterSearch } from "@iot-os/ui/components/filter-bar"
import { Pager } from "@iot-os/ui/components/pager"
import { Panel, PanelFooter } from "@iot-os/ui/components/panel"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@iot-os/ui/components/popover"
import {
  SearchableMultiSelect,
  SearchableSelect,
} from "@iot-os/ui/components/searchable-select"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@iot-os/ui/components/select"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@iot-os/ui/components/table"
import { ToggleGroup, ToggleGroupItem } from "@iot-os/ui/components/toggle-group"
import { useIsMobile } from "@iot-os/ui/hooks/use-mobile"
import { formatNumber } from "@iot-os/ui/lib/format"
import { cn } from "@iot-os/ui/lib/utils"

/** One column, described by the page. DataTable owns the markup, sorting, visibility and phone layout. */
export type DataColumn<T> = {
  id: string
  header: string
  /** Keeps the header for screen readers only, e.g. a star toggle column. */
  headerHidden?: boolean
  cell: (row: T) => React.ReactNode
  /** Plain value for sorting, client search, summaries and CSV export. */
  value?: (row: T) => string | number | null | undefined
  sortable?: boolean
  /** Client tables search this column's value. */
  searchable?: boolean
  /** False keeps the column out of the Columns menu. Every column but the first can be hidden by default. */
  hideable?: boolean
  /** Hidden until the viewer turns it on under Columns. */
  hidden?: boolean
  align?: "start" | "end"
  className?: string
  /** Summary row over the page and over each group. */
  summary?: "sum" | "average" | "count" | ((rows: T[]) => React.ReactNode)
  /** Phone layout: one title, one badge, the rest as "Header value" lines unless hidden. */
  mobile?: "title" | "badge" | "meta" | "hidden"
}

export type DataFilter<T> = {
  id: string
  label: string
  options: { value: string; label: string }[]
  value: string[]
  onChange: (value: string[]) => void
  multiple?: boolean
  /** Client tables keep rows that match; server tables filter in the request instead. */
  match?: (row: T, value: string[]) => boolean
}

export type DataView = { value: string; label: string; count?: number }

export type DataGroup<T> = {
  id: string
  label: string
  value: (row: T) => string | null | undefined
}

export type BulkContext<T> = {
  /** Selected rows that are loaded; on server tables, rows from other pages are not. */
  rows: T[]
  ids: string[]
  clear: () => void
}

export type DataTableProps<T> = {
  /** Remembers column and grouping choices per viewer. */
  id: string
  /** Accessible name, e.g. "Devices". */
  label: string
  /** Singular and plural for counts: ["device", "devices"]. */
  noun: [string, string]
  /** Undefined while the first page loads. */
  rows: T[] | undefined
  rowKey: (row: T) => string
  /** Names the row for assistive tech: "Select Boiler room sensor", "Actions for Boiler room sensor". */
  rowLabel?: (row: T) => string
  columns: DataColumn<T>[]
  /** The whole row opens this; put a RowLink in the first column for keyboard and phone users. */
  rowHref?: (row: T) => string
  /** Shown inside the panel instead of rows, e.g. a RequestError. */
  error?: React.ReactNode
  /** Shown inside the panel when there are no rows and nothing is filtered. */
  empty?: React.ReactNode
  /** Saved views above the table, e.g. lifecycle with counts. */
  views?: {
    label: string
    value: string
    options: DataView[]
    onChange: (value: string) => void
  }
  search?: {
    label: string
    placeholder?: string
    value: string
    onChange: (value: string) => void
  }
  filters?: DataFilter<T>[]
  groups?: DataGroup<T>[]
  /** Extra items at the end of the toolbar. */
  toolbar?: React.ReactNode
  /** Server sorting; leave out to sort loaded rows. */
  sort?: { value: SortingState; onChange: (value: SortingState) => void }
  defaultSort?: SortingState
  /** Server pagination; leave out to page loaded rows. */
  pagination?: {
    page: number
    pageSize: number
    total: number
    /** The server's page count, when it chooses the page size itself. */
    pageCount?: number
    onPageChange: (page: number) => void
    /** Leave out when the server fixes the page size; Rows per page then stays hidden. */
    onPageSizeChange?: (pageSize: number) => void
  }
  pageSizes?: number[]
  /** Server tables say whether the request is filtered, for "N devices match". */
  filtered?: boolean
  onReset?: () => void
  selectable?: boolean
  bulkActions?: (context: BulkContext<T>) => React.ReactNode
  /** Adds Export CSV for the selected rows, saved as `<exportName>-<date>.csv`. */
  exportName?: string
  /** Menu items for one row, shown behind a ⋯ button; return null for none. */
  rowActions?: (row: T) => React.ReactNode
  /** The query refreshes on this interval; the footer says so. */
  refreshSeconds?: number
}

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric },
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
  rowSelectionFeature,
  columnVisibilityFeature,
})
const EMPTY: never[] = []
const GROUP_COLUMN = "__group"
const PAGE_SIZES = [25, 50, 100]

function readStored<V>(key: string, fallback: V): V {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as V)
  } catch {
    return fallback
  }
}
function writeStored(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage can be blocked; the choice still applies until reload.
  }
}

const plural = (count: number, [one, many]: [string, string]) =>
  `${count.toLocaleString()} ${count === 1 ? one : many}`

/** The row's own name: the link keyboard and phone users follow. The whole row opens it too. */
export function RowLink({ className, ...props }: LinkProps) {
  return (
    <Link
      data-row-link=""
      className={cn(
        "font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:underline",
        "group-data-[slot=data-table-card]/card:after:absolute group-data-[slot=data-table-card]/card:after:inset-0",
        className,
      )}
      {...props}
    />
  )
}

/** A reference to another record: quiet until hovered, and above the row link on phones. */
export function RefLink({ className, ...props }: LinkProps) {
  return (
    <Link
      className={cn(
        "relative z-10 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline",
        className,
      )}
      {...props}
    />
  )
}

function summarize<T>(column: DataColumn<T>, rows: T[]): React.ReactNode {
  if (!column.summary) return null
  if (typeof column.summary === "function") return column.summary(rows)
  if (column.summary === "count") return rows.length.toLocaleString()
  const values = rows
    .map((row) => Number(column.value?.(row)))
    .filter(Number.isFinite)
  if (!values.length) return "—"
  const sum = values.reduce((total, value) => total + value, 0)
  return column.summary === "sum"
    ? formatNumber(sum)
    : formatNumber(sum / values.length, 2)
}

function toCsv<T>(columns: DataColumn<T>[], rows: T[]) {
  const quote = (value: unknown) => {
    const text = value === null || value === undefined ? "" : String(value)
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
  }
  const exported = columns.filter((column) => column.value)
  return [
    exported.map((column) => quote(column.header)).join(","),
    ...rows.map((row) =>
      exported.map((column) => quote(column.value!(row))).join(","),
    ),
  ].join("\n")
}

function download(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }))
  const link = Object.assign(document.createElement("a"), {
    href: url,
    download: `${name}-${new Date().toISOString().slice(0, 10)}.csv`,
  })
  link.click()
  URL.revokeObjectURL(url)
}

/**
 * Filament-style table on TanStack Table: saved views, search, filters with
 * chips, grouping, a column manager, selection with bulk actions, row actions,
 * summaries, rows per page and server or client paging. The toolbar sits on
 * the canvas and the table in a Panel.
 */
export function DataTable<T extends RowData>(props: DataTableProps<T>) {
  const {
    id,
    label,
    noun,
    rows,
    rowKey,
    columns,
    rowHref,
    views,
    search,
    filters = [],
    groups = [],
    sort,
    defaultSort = [],
    pagination,
    pageSizes = PAGE_SIZES,
    selectable = false,
    bulkActions,
    exportName,
    rowActions,
  } = props
  const navigate = useNavigate()
  // One layout in the DOM at a time: a table on wide screens, cards on phones.
  const phone = useIsMobile()
  const storageKey = `iot-table:${id}`
  const spec = React.useMemo(
    () => new Map(columns.map((column) => [column.id, column])),
    [columns],
  )

  // Client tables filter here; server tables receive rows the request already filtered.
  const searchValue = search?.value.trim().toLowerCase() ?? ""
  const activeFilters = filters.filter((filter) => filter.value.length > 0)
  const processed = React.useMemo(() => {
    if (!rows) return undefined
    let result = rows
    const searchable = columns.filter((column) => column.searchable && column.value)
    // Pages that search fields outside the columns filter the rows themselves.
    if (!pagination && searchValue && searchable.length) {
      result = result.filter((row) =>
        searchable.some((column) =>
          String(column.value!(row) ?? "").toLowerCase().includes(searchValue),
        ),
      )
    }
    for (const filter of activeFilters) {
      if (filter.match) result = result.filter((row) => filter.match!(row, filter.value))
    }
    return result
    // activeFilters is derived from filters each render; its values are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, pagination, searchValue, columns, JSON.stringify(activeFilters.map((f) => [f.id, f.value]))])
  const filtered = props.filtered ?? Boolean(searchValue || activeFilters.length)

  const [groupId, setGroupId] = React.useState<string>(() =>
    readStored(`${storageKey}:group`, ""),
  )
  const group = groups.find((option) => option.id === groupId)
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set())

  // Client tables sort by the group first so a group never splits across pages;
  // server tables group the page they receive.
  const [clientSort, setClientSort] = React.useState<SortingState>(defaultSort)
  const userSort = sort?.value ?? clientSort
  const sorting: SortingState =
    group && !sort ? [{ id: GROUP_COLUMN, desc: false }, ...userSort] : userSort
  const onSortingChange = (updater: Updater<SortingState>) => {
    const next = functionalUpdate(updater, sorting).filter((s) => s.id !== GROUP_COLUMN)
    if (sort) sort.onChange(next)
    else setClientSort(next)
  }

  const [clientPage, setClientPage] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: readStored(`${storageKey}:page-size`, pageSizes[0]),
  })
  const paginationState: PaginationState = pagination
    ? { pageIndex: pagination.page - 1, pageSize: pagination.pageSize }
    : clientPage
  const onPaginationChange = (updater: Updater<PaginationState>) => {
    const next = functionalUpdate(updater, paginationState)
    if (next.pageSize !== paginationState.pageSize) {
      writeStored(`${storageKey}:page-size`, next.pageSize)
      if (pagination) pagination.onPageSizeChange?.(next.pageSize)
      else setClientPage({ pageIndex: 0, pageSize: next.pageSize })
    } else if (pagination) pagination.onPageChange(next.pageIndex + 1)
    else setClientPage(next)
  }
  // A new search or filter starts client tables on the first page.
  React.useEffect(() => {
    if (!pagination) setClientPage((page) => ({ ...page, pageIndex: 0 }))
  }, [pagination, processed?.length])

  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({})
  // Client tables drop selected rows that no longer exist, such as after a bulk delete.
  React.useEffect(() => {
    if (pagination || !processed) return
    const ids = new Set(processed.map((row) => rowKey(row)))
    setRowSelection((current) => {
      const kept = Object.entries(current).filter(([key]) => ids.has(key))
      return kept.length === Object.keys(current).length ? current : Object.fromEntries(kept)
    })
    // rowKey is a pure accessor; the rows are what change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination, processed])
  const [columnVisibility, setColumnVisibility] = React.useState<ColumnVisibilityState>(() =>
    readStored(
      `${storageKey}:columns`,
      Object.fromEntries(columns.filter((c) => c.hidden).map((c) => [c.id, false])),
    ),
  )
  const onColumnVisibilityChange = (updater: Updater<ColumnVisibilityState>) => {
    setColumnVisibility((current) => {
      const next = functionalUpdate(updater, current)
      writeStored(`${storageKey}:columns`, next)
      return next
    })
  }

  const definitions = React.useMemo(() => {
    const helper = createColumnHelper<typeof features, T>()
    const groupColumn = helper.accessor((row: T): unknown => group?.value(row) || "\uffff", {
      id: GROUP_COLUMN,
      enableHiding: false,
      sortFn: "alphanumeric",
    })
    return [groupColumn, ...columns.map((column, index) =>
      helper.accessor((row: T): unknown => column.value?.(row) ?? undefined, {
        id: column.id,
        header: column.header,
        enableSorting: Boolean(column.sortable),
        enableHiding: column.hideable ?? index > 0,
        sortFn: "alphanumeric",
        sortUndefined: "last",
      }),
    )]
  }, [columns, group])

  const table = useTable({
    features,
    columns: definitions,
    data: processed ?? (EMPTY as T[]),
    getRowId: (row: T) => rowKey(row),
    state: {
      sorting,
      pagination: paginationState,
      rowSelection,
      columnVisibility: { ...columnVisibility, [GROUP_COLUMN]: false },
    },
    onSortingChange,
    onPaginationChange,
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange,
    manualSorting: Boolean(sort),
    manualPagination: Boolean(pagination),
    rowCount: pagination?.pageCount ? undefined : pagination?.total,
    pageCount: pagination?.pageCount,
    enableRowSelection: selectable,
    enableSortingRemoval: false,
  })

  const visible = table
    .getVisibleLeafColumns()
    .map((column) => spec.get(column.id))
    .filter((column): column is DataColumn<T> => Boolean(column))
  const pageRows = table.getRowModel().rows
  const total = pagination?.total ?? processed?.length ?? 0
  const selectedIds = Object.keys(rowSelection).filter((key) => rowSelection[key])
  const selectedRows = table.getSelectedRowModel().rows.map((row) => row.original)
  const clearSelection = () => table.resetRowSelection(true)
  const hasSummary = visible.some((column) => column.summary)
  const span = visible.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0)
  const reset = () => {
    search?.onChange("")
    filters.forEach((filter) => filter.value.length && filter.onChange([]))
    props.onReset?.()
  }

  const grouped = React.useMemo(() => {
    if (!group) return null
    const buckets = new Map<string, typeof pageRows>()
    for (const row of pageRows) {
      const key = group.value(row.original) || ""
      buckets.set(key, [...(buckets.get(key) ?? []), row])
    }
    return [...buckets.entries()]
  }, [group, pageRows])

  const renderRow = (row: (typeof pageRows)[number]) => {
    const href = rowHref?.(row.original)
    // Rows with nothing to do (rowActions returns null) get no menu button.
    const actions = rowActions?.(row.original)
    return (
      <TableRow
        key={row.id}
        data-state={row.getIsSelected() ? "selected" : undefined}
        className={cn(href && "cursor-pointer")}
        onClick={
          href
            ? (event) => {
                const target = event.target as HTMLElement
                if (target.closest("a,button,input,label,[role=checkbox],[role=menuitem]")) return
                if (window.getSelection()?.toString()) return
                if (event.metaKey || event.ctrlKey) window.open(href, "_blank", "noopener")
                else navigate(href)
              }
            : undefined
        }
      >
        {selectable && (
          <TableCell className="w-10 pr-0">
            <Checkbox
              aria-label={props.rowLabel ? `Select ${props.rowLabel(row.original)}` : "Select row"}
              checked={row.getIsSelected()}
              onClick={(event) => row.getToggleSelectedHandler()(event)}
            />
          </TableCell>
        )}
        {visible.map((column) => (
          <TableCell
            key={column.id}
            className={cn(column.align === "end" && "text-right", column.className)}
          >
            {column.cell(row.original)}
          </TableCell>
        ))}
        {rowActions && (
          <TableCell className="w-10 pl-0 text-right">
            {actions ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={props.rowLabel ? `Actions for ${props.rowLabel(row.original)}` : "Row actions"}
                >
                  <EllipsisIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {actions}
              </DropdownMenuContent>
            </DropdownMenu>
            ) : null}
          </TableCell>
        )}
      </TableRow>
    )
  }

  const summaryRow = (rowsForSummary: T[], key: string, caption: string) => (
    <TableRow key={key} className="bg-sunken hover:bg-sunken">
      {selectable && <TableCell />}
      {visible.map((column, index) => (
        <TableCell
          key={column.id}
          className={cn("text-meta font-medium text-muted-foreground", column.align === "end" && "text-right")}
        >
          {column.summary ? summarize(column, rowsForSummary) : index === 0 ? caption : null}
        </TableCell>
      ))}
      {rowActions && <TableCell />}
    </TableRow>
  )

  const titleColumn = columns.find((column) => column.mobile === "title") ?? columns[0]
  const badgeColumn = columns.find((column) => column.mobile === "badge")
  const metaColumns = visible.filter(
    (column) =>
      column !== titleColumn && column !== badgeColumn && column.mobile !== "hidden",
  )
  const loading = rows === undefined
  const isEmpty = !loading && !props.error && (processed?.length ?? 0) === 0
  const pageCount = table.getPageCount()
  const hideable = table.getAllLeafColumns().filter((column) => column.getCanHide())

  return (
    <div data-slot="data-table" className="flex min-w-0 flex-col gap-3">
      <Toolbar
        label={label}
        views={views}
        search={search}
        filters={filters}
        groups={groups}
        groupId={groupId}
        onGroup={(next) => {
          setGroupId(next)
          setCollapsed(new Set())
          writeStored(`${storageKey}:group`, next)
        }}
        columns={hideable.map((column) => ({
          id: column.id,
          header: spec.get(column.id)?.header ?? column.id,
          visible: column.getIsVisible(),
          toggle: (value: boolean) => column.toggleVisibility(value),
        }))}
        extra={props.toolbar}
      />
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" aria-label="Active filters" role="group">
          {activeFilters.map((filter) => (
            <span
              key={filter.id}
              className="inline-flex h-7 max-w-full items-center gap-1 rounded-md bg-accent pr-1 pl-2.5 text-meta text-accent-foreground ring-1 ring-primary/30 ring-inset"
            >
              <span className="truncate">
                {filter.label}:{" "}
                {filter.value
                  .map((value) => filter.options.find((o) => o.value === value)?.label ?? value)
                  .join(", ")}
              </span>
              <button
                type="button"
                aria-label={`Remove ${filter.label} filter`}
                className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-background/60 hover:text-foreground"
                onClick={() => filter.onChange([])}
              >
                <XIcon className="size-3.5" />
              </button>
            </span>
          ))}
          <Button variant="ghost" size="sm" onClick={reset}>
            Reset
          </Button>
        </div>
      )}
      <Panel>
        {(selectedIds.length > 0) && (
          <div
            data-slot="data-table-bulk"
            className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-accent px-4 py-2 text-body"
          >
            <span className="font-medium">{selectedIds.length.toLocaleString()} selected</span>
            {!pagination && selectedIds.length < total && (
              <Button variant="link" size="sm" className="h-auto p-0" onClick={() => table.toggleAllRowsSelected(true)}>
                Select all {total.toLocaleString()}
              </Button>
            )}
            <Button variant="link" size="sm" className="h-auto p-0 text-muted-foreground" onClick={clearSelection}>
              Clear
            </Button>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {bulkActions?.({ rows: selectedRows, ids: selectedIds, clear: clearSelection })}
              {exportName && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => download(exportName, toCsv(visible, selectedRows))}
                >
                  <DownloadIcon data-icon="inline-start" />
                  Export CSV
                </Button>
              )}
            </div>
          </div>
        )}
        {props.error ? (
          <div className="p-4">{props.error}</div>
        ) : isEmpty ? (
          filtered ? (
            <EmptyState
              inset
              icon={<SearchXIcon />}
              title={`No matching ${noun[1]}`}
              description="Try another search, or clear the filters."
              action={
                <Button variant="outline" size="sm" onClick={reset}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            (props.empty ?? <EmptyState inset title={`No ${noun[1]} yet`} />)
          )
        ) : (
          !phone ? (
            <div>
              <Table aria-label={label}>
                <TableHeader className="bg-sunken">
                  <TableRow className="hover:bg-transparent">
                    {selectable && (
                      <TableHead className="w-10 pr-0">
                        <Checkbox
                          aria-label="Select all rows on this page"
                          disabled={loading}
                          checked={
                            table.getIsAllPageRowsSelected()
                              ? true
                              : table.getIsSomePageRowsSelected()
                                ? "indeterminate"
                                : false
                          }
                          onCheckedChange={(value) => table.toggleAllPageRowsSelected(value === true)}
                        />
                      </TableHead>
                    )}
                    {visible.map((column) => {
                      const state = table.getColumn(column.id)
                      const direction = state?.getIsSorted()
                      return (
                        <TableHead
                          key={column.id}
                          aria-sort={
                            direction === "asc" ? "ascending" : direction === "desc" ? "descending" : undefined
                          }
                          className={cn("text-meta font-medium text-muted-foreground", column.align === "end" && "text-right")}
                        >
                          {column.sortable && state ? (
                            <button
                              type="button"
                              className={cn(
                                "-mx-1 inline-flex items-center gap-1 rounded px-1 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                                direction && "text-foreground",
                              )}
                              onClick={() => state.toggleSorting(direction === "asc")}
                            >
                              {column.header}
                              {direction === "asc" ? (
                                <ArrowUpIcon className="size-3.5" aria-hidden />
                              ) : direction === "desc" ? (
                                <ArrowDownIcon className="size-3.5" aria-hidden />
                              ) : (
                                <ArrowUpDownIcon className="size-3.5 opacity-50" aria-hidden />
                              )}
                            </button>
                          ) : column.headerHidden ? (
                            <span className="sr-only">{column.header}</span>
                          ) : (
                            column.header
                          )}
                        </TableHead>
                      )
                    })}
                    {rowActions && (
                      <TableHead className="w-10">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading
                    ? Array.from({ length: 5 }, (_, index) => (
                        <TableRow key={index} className="hover:bg-transparent">
                          {Array.from({ length: span }, (_, cell) => (
                            <TableCell key={cell}>
                              <Skeleton className="h-4 w-full max-w-40" />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    : grouped
                      ? grouped.flatMap(([key, groupRows]) => {
                          const open = !collapsed.has(key)
                          const toggle = () =>
                            setCollapsed((current) => {
                              const next = new Set(current)
                              if (next.has(key)) next.delete(key)
                              else next.add(key)
                              return next
                            })
                          return [
                            <TableRow key={`group:${key}`} className="bg-background hover:bg-background">
                              <TableCell colSpan={span} className="py-1.5">
                                <button
                                  type="button"
                                  aria-expanded={open}
                                  onClick={toggle}
                                  className="inline-flex items-center gap-2 rounded text-heading focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                                >
                                  <ChevronDownIcon
                                    aria-hidden
                                    className={cn("size-4 text-muted-foreground transition-transform", !open && "-rotate-90")}
                                  />
                                  {key || `No ${group!.label.toLowerCase()}`}
                                  <span className="text-meta font-normal text-muted-foreground">
                                    {plural(groupRows.length, noun)}
                                  </span>
                                </button>
                              </TableCell>
                            </TableRow>,
                            ...(open ? groupRows.map(renderRow) : []),
                            ...(open && hasSummary
                              ? [summaryRow(groupRows.map((r) => r.original), `summary:${key}`, "Subtotal")]
                              : []),
                          ]
                        })
                      : pageRows.map(renderRow)}
                  {!loading && hasSummary && (!grouped || grouped.length > 1) &&
                    summaryRow(pageRows.map((row) => row.original), "summary", pageCount > 1 ? "This page" : "Total")}
                </TableBody>
              </Table>
            </div>
          ) : (
            <ul aria-label={label} className="divide-y">
              {loading
                ? Array.from({ length: 3 }, (_, index) => (
                    <li key={index} className="flex flex-col gap-2 px-4 py-3">
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="h-3 w-1/2" />
                    </li>
                  ))
                : pageRows.map((row) => (
                    <li
                      key={row.id}
                      data-slot="data-table-card"
                      className="group/card relative flex min-w-0 flex-col gap-1 px-4 py-3 has-[[data-row-link]:focus-visible]:ring-2 has-[[data-row-link]:focus-visible]:ring-ring has-[[data-row-link]:focus-visible]:ring-inset"
                    >
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <div className="min-w-0">{titleColumn?.cell(row.original)}</div>
                        {badgeColumn && <div className="shrink-0">{badgeColumn.cell(row.original)}</div>}
                      </div>
                      {metaColumns.length > 0 && (
                        <p className="flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 text-meta text-muted-foreground">
                          {metaColumns.map((column) => (
                            <span key={column.id} className="min-w-0 truncate">
                              {column.header} {column.cell(row.original)}
                            </span>
                          ))}
                        </p>
                      )}
                    </li>
                  ))}
            </ul>
          )
        )}
        <PanelFooter>
          <span className="flex flex-wrap items-center gap-x-2">
            <span role="status">
              {loading ? "Loading…" : `${plural(total, noun)}${filtered ? " match" : ""}`}
            </span>
            {props.refreshSeconds && !loading && (
              <span>· updates every {props.refreshSeconds} s</span>
            )}
          </span>
          {!loading && total > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {total > pageSizes[0] && (!pagination || pagination.onPageSizeChange) && (
                <label className="flex items-center gap-2">
                  <span>Rows per page</span>
                  <Select
                    value={String(paginationState.pageSize)}
                    onValueChange={(value) => table.setPageSize(Number(value))}
                  >
                    <SelectTrigger size="sm" className="h-7 w-20" aria-label="Rows per page">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {pageSizes.map((size) => (
                        <SelectItem key={size} value={String(size)}>
                          {size}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              )}
              <Pager
                page={paginationState.pageIndex + 1}
                pageCount={pageCount}
                label={`${label} pages`}
                onPageChange={(next) => table.setPageIndex(next - 1)}
              />
            </div>
          )}
        </PanelFooter>
      </Panel>
    </div>
  )
}

function Toolbar<T>({
  label,
  views,
  search,
  filters,
  groups,
  groupId,
  onGroup,
  columns,
  extra,
}: {
  label: string
  views: DataTableProps<T>["views"]
  search: DataTableProps<T>["search"]
  filters: DataFilter<T>[]
  groups: DataGroup<T>[]
  groupId: string
  onGroup: (id: string) => void
  columns: { id: string; header: string; visible: boolean; toggle: (value: boolean) => void }[]
  extra?: React.ReactNode
}) {
  const active = filters.filter((filter) => filter.value.length > 0).length
  const filterTitleId = React.useId()
  return (
    <div data-slot="data-table-toolbar" className="flex flex-wrap items-center gap-2">
      {views && (
        <div className="max-w-full overflow-x-auto scrollbar-none">
          <ToggleGroup
            type="single"
            size="sm"
            spacing={0}
            aria-label={views.label}
            value={views.value}
            onValueChange={(value) => value && views.onChange(value)}
            className="gap-0 rounded-lg bg-sunken p-0.5 shadow-[inset_0_0_0_1px_var(--border)]"
          >
            {views.options.map((option) => (
              <ToggleGroupItem
                key={option.value}
                value={option.value}
                className="gap-1.5 rounded-md! px-2.5 text-muted-foreground hover:bg-transparent data-[state=on]:border-transparent data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-panel data-[state=on]:hover:bg-card data-[state=on]:hover:text-foreground"
              >
                {option.label}
                {option.count !== undefined && (
                  <span className="font-normal text-muted-foreground tabular-nums">
                    {option.count.toLocaleString()}
                  </span>
                )}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      )}
      {search && (
        <FilterSearch
          label={search.label}
          placeholder={search.placeholder}
          value={search.value}
          onChange={(event) => search.onChange(event.target.value)}
        />
      )}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {extra}
        {filters.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" aria-label={active ? `Filters, ${active} active` : "Filters"}>
                <ListFilterIcon data-icon="inline-start" />
                Filters
                {active > 0 && (
                  <span className="grid min-w-4.5 place-items-center rounded-full bg-primary px-1 text-micro leading-4.5 font-semibold text-primary-foreground tabular-nums">
                    {active}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 gap-3 p-3" aria-labelledby={`${filterTitleId}-title`}>
              <p id={`${filterTitleId}-title`} className="text-heading">Filter {label.toLowerCase()}</p>
              {filters.map((filter) => (
                <FilterControl key={filter.id} filter={filter} />
              ))}
            </PopoverContent>
          </Popover>
        )}
        {groups.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <RowsIcon data-icon="inline-start" />
                {groupId ? `Group: ${groups.find((g) => g.id === groupId)?.label ?? ""}` : "Group"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Group rows by</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={groupId} onValueChange={onGroup}>
                <DropdownMenuRadioItem value="">None</DropdownMenuRadioItem>
                {groups.map((option) => (
                  <DropdownMenuRadioItem key={option.id} value={option.id}>
                    {option.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {columns.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Columns3Icon data-icon="inline-start" />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Show columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {columns.map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  checked={column.visible}
                  onCheckedChange={(value) => column.toggle(value === true)}
                  onSelect={(event) => event.preventDefault()}
                >
                  {column.header}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}

function FilterControl<T>({ filter }: { filter: DataFilter<T> }) {
  const [query, setQuery] = React.useState("")
  const options = React.useMemo(
    () => [{ value: "", label: `Any ${filter.label.toLowerCase()}` }, ...filter.options],
    [filter.label, filter.options],
  )
  if (filter.multiple) {
    return (
      <SearchableMultiSelect
        label={filter.label}
        values={filter.value}
        options={filter.options}
        onChange={filter.onChange}
        placeholder={`Any ${filter.label.toLowerCase()}`}
      />
    )
  }
  return (
    <SearchableSelect
      label={filter.label}
      value={filter.value[0] ?? ""}
      options={options.filter((option) =>
        option.label.toLowerCase().includes(query.trim().toLowerCase()),
      )}
      onChange={(value) => filter.onChange(value ? [value] : [])}
      search={query}
      onSearchChange={setQuery}
      selectedLabel={
        filter.value[0]
          ? filter.options.find((option) => option.value === filter.value[0])?.label
          : undefined
      }
      placeholder={`Any ${filter.label.toLowerCase()}`}
    />
  )
}
