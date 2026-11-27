"use client"

import * as React from "react"
import { ChevronRightIcon, LoaderCircleIcon } from "lucide-react"

import { Button } from "@iot-os/ui/components/button"
import { cn } from "@iot-os/ui/lib/utils"

export type TreeTableColumn<T> = {
  id: string
  header: string
  cell: (row: T) => React.ReactNode
  align?: "start" | "end"
  className?: string
  /** Hidden under 768 px; the first column always shows. */
  phoneHidden?: boolean
}

/** One loaded level of the tree: the rows so far and how to load the next page. */
export type TreeLevel<T> = {
  /** Undefined while the first page loads. */
  rows: T[] | undefined
  /** How many rows the level holds in all, for "Show more (25 of 140)". */
  total?: number
  hasMore: boolean
  loadingMore?: boolean
  onLoadMore: () => void
  /** Shown in place of the level's rows, e.g. a RequestError. */
  error?: React.ReactNode
}

export type TreeTableProps<T> = {
  /** Accessible name, e.g. "Hierarchy". */
  label: string
  columns: TreeTableColumn<T>[]
  rowKey: (row: T) => string
  /** Names the row for its expand button: "Show what is in Line 2". */
  rowLabel: (row: T) => string
  /** False hides the expand button; the level is not loaded until a row is expanded. */
  hasChildren: (row: T) => boolean
  /**
   * A hook loading one level: the top level for `null`, else the row's children. Called
   * once per expanded row, so it can use a query cache; invalidating it refreshes the tree.
   */
  useLevel: (parent: T | null) => TreeLevel<T>
  /** The highlighted row, e.g. the one a side panel shows. */
  selected?: string | null
  /** Enter, or a click on the row; the first column can hold its own link too. */
  onSelect?: (row: T) => void
  /** Keys expanded on first render, e.g. the ancestors of the selected row. */
  defaultExpanded?: string[]
  /** Shown inside the table when the top level has no rows. */
  empty?: React.ReactNode
  /** Menu or buttons at the end of each row. */
  rowActions?: (row: T) => React.ReactNode
  className?: string
}

type TreeContext<T> = TreeTableProps<T> & {
  expanded: Set<string>
  toggle: (key: string, open?: boolean) => void
  focused: string | null
  setFocused: (key: string) => void
}

const Context = React.createContext<TreeContext<never> | null>(null)
function useTree<T>() {
  return React.useContext(Context) as TreeContext<T> | null as TreeContext<T>
}

/**
 * A tree whose levels load as they open, one page at a time, as a WAI-ARIA treegrid:
 * arrow keys move between rows, Right opens and Left closes or goes to the parent,
 * Home and End jump, Enter selects. Rows sit in a panel like DataTable's.
 */
export function TreeTable<T>(props: TreeTableProps<T>) {
  const [expanded, setExpanded] = React.useState(() => new Set(props.defaultExpanded ?? []))
  const [focused, setFocused] = React.useState<string | null>(null)
  const body = React.useRef<HTMLTableSectionElement>(null)
  const expandKey = (props.defaultExpanded ?? []).join("|")
  React.useEffect(() => {
    if (!expandKey) return
    setExpanded((current) => new Set([...current, ...expandKey.split("|")]))
  }, [expandKey])
  const toggle = React.useCallback((key: string, open?: boolean) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (open ?? !next.has(key)) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])
  const context: TreeContext<T> = { ...props, expanded, toggle, focused, setFocused }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTableSectionElement>) => {
    const rows = Array.from(body.current?.querySelectorAll<HTMLTableRowElement>("tr[data-tree-key]") ?? [])
    const current = (event.target as HTMLElement).closest<HTMLTableRowElement>("tr[data-tree-key]")
    if (!current || event.target !== current) return
    const index = rows.indexOf(current)
    const key = current.dataset.treeKey ?? ""
    const level = Number(current.getAttribute("aria-level"))
    const open = current.getAttribute("aria-expanded")
    const go = (row: HTMLTableRowElement | undefined) => {
      if (!row) return
      event.preventDefault()
      row.focus()
    }
    switch (event.key) {
      case "ArrowDown":
        return go(rows[index + 1])
      case "ArrowUp":
        return go(rows[index - 1])
      case "Home":
        return go(rows[0])
      case "End":
        return go(rows[rows.length - 1])
      case "ArrowRight":
        event.preventDefault()
        if (open === "false") toggle(key, true)
        else if (open === "true" && Number(rows[index + 1]?.getAttribute("aria-level")) > level) rows[index + 1]?.focus()
        return
      case "ArrowLeft":
        event.preventDefault()
        if (open === "true") toggle(key, false)
        else go(rows.slice(0, index).reverse().find((row) => Number(row.getAttribute("aria-level")) < level))
        return
      case "Enter":
      case " ":
        event.preventDefault()
        current.click()
        return
    }
  }

  return (
    <Context.Provider value={context as unknown as TreeContext<never>}>
      <div
        data-slot="tree-table"
        className={cn("overflow-x-auto rounded-xl bg-card shadow-panel", props.className)}
      >
        <table role="treegrid" aria-label={props.label} className="w-full text-body">
          <thead className="border-b bg-sunken text-meta text-muted-foreground">
            <tr>
              {props.columns.map((column, index) => (
                <th
                  key={column.id}
                  scope="col"
                  className={cn(
                    "h-8 px-3 text-left font-medium whitespace-nowrap",
                    column.align === "end" && "text-right",
                    index > 0 && column.phoneHidden && "max-md:hidden",
                    column.className,
                  )}
                >
                  {column.header}
                </th>
              ))}
              {props.rowActions && (
                <th scope="col" className="w-10 px-2">
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody ref={body} onKeyDown={onKeyDown}>
            <Level<T> parent={null} depth={1} />
          </tbody>
        </table>
      </div>
    </Context.Provider>
  )
}

function Level<T>({ parent, depth }: { parent: T | null; depth: number }) {
  const tree = useTree<T>()
  const level = tree.useLevel(parent)
  const span = tree.columns.length + (tree.rowActions ? 1 : 0)
  const indent = { paddingInlineStart: `calc(${depth - 1} * 1.25rem + 0.75rem)` }
  if (level.error)
    return (
      <tr>
        <td colSpan={span} className="px-3 py-2" style={indent}>
          {level.error}
        </td>
      </tr>
    )
  if (!level.rows)
    return (
      <tr aria-busy="true">
        <td colSpan={span} className="px-3 py-2 text-muted-foreground" style={indent}>
          <span className="inline-flex items-center gap-2">
            <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
            Loading…
          </span>
        </td>
      </tr>
    )
  if (!level.rows.length && parent === null && tree.empty)
    return (
      <tr>
        <td colSpan={span}>{tree.empty}</td>
      </tr>
    )
  const first = level.rows[0] ? tree.rowKey(level.rows[0]) : null
  return (
    <>
      {level.rows.map((row, index) => (
        <Row<T>
          key={tree.rowKey(row)}
          row={row}
          depth={depth}
          position={index + 1}
          size={level.total ?? level.rows!.length}
          tabbable={tree.focused ? tree.focused === tree.rowKey(row) : parent === null && tree.rowKey(row) === first}
        />
      ))}
      {level.hasMore && (
        <tr>
          <td colSpan={span} className="py-1" style={indent}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={level.loadingMore}
              onClick={level.onLoadMore}
            >
              {level.loadingMore ? "Loading…" : "Show more"}
              {level.total !== undefined && (
                <span className="text-meta text-muted-foreground tabular-nums">
                  {level.rows.length.toLocaleString()} of {level.total.toLocaleString()}
                </span>
              )}
            </Button>
          </td>
        </tr>
      )}
    </>
  )
}

function Row<T>({
  row,
  depth,
  position,
  size,
  tabbable,
}: {
  row: T
  depth: number
  position: number
  size: number
  tabbable: boolean
}) {
  const tree = useTree<T>()
  const key = tree.rowKey(row)
  const branch = tree.hasChildren(row)
  const open = branch && tree.expanded.has(key)
  const selected = tree.selected === key
  return (
    <>
      <tr
        data-tree-key={key}
        aria-level={depth}
        aria-posinset={position}
        aria-setsize={size}
        aria-expanded={branch ? open : undefined}
        aria-selected={tree.onSelect ? selected : undefined}
        tabIndex={tabbable ? 0 : -1}
        onFocus={(event) => {
          if (event.target === event.currentTarget) tree.setFocused(key)
        }}
        onClick={(event) => {
          // Links, buttons and menus inside the row act on their own.
          if ((event.target as HTMLElement).closest("a, button, [role=menu]") && event.target !== event.currentTarget) return
          tree.onSelect?.(row)
        }}
        className={cn(
          "border-b outline-none last:border-0 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          tree.onSelect && "cursor-pointer",
          selected && "bg-muted",
        )}
      >
        {tree.columns.map((column, index) => (
          <td
            key={column.id}
            role="gridcell"
            className={cn(
              "h-10 px-3 py-1.5 align-middle",
              column.align === "end" && "text-right tabular-nums",
              index > 0 && column.phoneHidden && "max-md:hidden",
              column.className,
            )}
            style={index === 0 ? { paddingInlineStart: `calc(${depth - 1} * 1.25rem + 0.25rem)` } : undefined}
          >
            {index === 0 ? (
              <span className="flex min-w-0 items-center gap-1">
                {branch ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    tabIndex={-1}
                    aria-label={`${open ? "Hide" : "Show"} what is in ${tree.rowLabel(row)}`}
                    onClick={() => tree.toggle(key)}
                    className="shrink-0"
                  >
                    <ChevronRightIcon className={cn("transition-transform", open && "rotate-90")} />
                  </Button>
                ) : (
                  <span aria-hidden="true" className="w-7 shrink-0" />
                )}
                <span className="min-w-0 flex-1">{column.cell(row)}</span>
              </span>
            ) : (
              column.cell(row)
            )}
          </td>
        ))}
        {tree.rowActions && (
          <td role="gridcell" className="w-10 px-2 text-right">
            {tree.rowActions(row)}
          </td>
        )}
      </tr>
      {open && <Level<T> parent={row} depth={depth + 1} />}
    </>
  )
}
