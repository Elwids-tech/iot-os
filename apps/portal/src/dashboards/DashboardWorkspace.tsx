import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useLocation, useNavigate, useSearchParams } from "react-router-dom"
import {
  Responsive,
  WidthProvider,
  type ResponsiveLayouts,
} from "react-grid-layout/legacy"
import "react-grid-layout/css/styles.css"
import "react-resizable/css/styles.css"
import {
  ApiError,
  type Dashboard,
  type DashboardView,
  type DashboardWidget,
} from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import { PageHeader } from "@iot-os/ui/components/page-header"
import { usePanelGap } from "@iot-os/ui/components/skin"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@iot-os/ui/components/dialog"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@iot-os/ui/components/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@iot-os/ui/components/dropdown-menu"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@iot-os/ui/components/empty"
import { Alert, AlertDescription } from "@iot-os/ui/components/alert"
import { Field, FieldGroup, FieldLabel } from "@iot-os/ui/components/field"
import { Input } from "@iot-os/ui/components/input"
import { Badge } from "@iot-os/ui/components/badge"
import { Toggle } from "@iot-os/ui/components/toggle"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@iot-os/ui/components/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@iot-os/ui/components/command"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@iot-os/ui/components/sheet"
import { cn } from "@iot-os/ui/lib/utils"
import {
  ActivityIcon,
  BellIcon,
  ChartLineIcon,
  ChartNoAxesGanttIcon,
  ChevronDownIcon,
  ChevronsUpDownIcon,
  CopyIcon,
  DownloadIcon,
  FileJsonIcon,
  GaugeIcon,
  GripVerticalIcon,
  HistoryIcon,
  LinkIcon,
  MapPinIcon,
  MaximizeIcon,
  MonitorIcon,
  MoreHorizontalIcon,
  PaletteIcon,
  PanelRightIcon,
  PencilIcon,
  PlusIcon,
  Rows3Icon,
  SaveIcon,
  Settings2Icon,
  Share2Icon,
  SlidersHorizontalIcon,
  StarIcon,
  TableIcon,
  Trash2Icon,
  TypeIcon,
} from "lucide-react"
import { toast } from "sonner"
import { api } from "../lib/api"
import { Confirm, errorMessage, RequestError } from "../components/forms"
import { useDirtyContext, useUnsaved } from "../lib/unsaved"
import {
  absoluteError,
  appendLayout,
  cleanLayouts,
  dashboardPath,
  fileName,
  newWidget,
  PANEL_LABELS,
  PRESET_LABELS,
  readView,
  resolveRange,
  responsiveLayouts,
  saveFile,
  toCsv,
  widgetError,
  writeView,
} from "./model"
import { PanelEditor } from "./PanelEditor"
import { PanelBody, widgetRegistry } from "./registry"
import { TimeControls } from "./TimeControls"
import { ContextRail } from "./ContextRail"
import { panelCsvRows } from "./panelData"
import { VersionHistory } from "./VersionHistory"
import { DuplicateDialog, SettingsDialog } from "./LibraryDialogs"
import { definition, downloadJson } from "./importExport"

const Grid = WidthProvider(Responsive)
const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }
const COLS: Record<string, number> = { lg: 12, md: 10, sm: 6, xs: 1, xxs: 1 }
const ROW_HEIGHT = 48
const RAIL_KEY = "iot-dashboard-rail"
// Per-viewer Status display by panel id; absent means fit automatically.
const DISPLAY_KEY = "iot-dashboard-status-display"
const ICONS: Record<DashboardWidget["type"], typeof GaugeIcon> = {
  status: Rows3Icon,
  gauge: GaugeIcon,
  table: TableIcon,
  controls: SlidersHorizontalIcon,
  device_health: ActivityIcon,
  timeseries: ChartLineIcon,
  state_history: ChartNoAxesGanttIcon,
  color_history: PaletteIcon,
  location: MapPinIcon,
  alerts: BellIcon,
  text: TypeIcon,
}
const NO_CSV: DashboardWidget["type"][] = ["text", "controls", "location", "alerts"]

function readStorage<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return value ? (JSON.parse(value) as T) : fallback
  } catch {
    return fallback
  }
}
function writeStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage can be blocked; the choice lasts for this page.
  }
}

export function DashboardWorkspace({
  org,
  saved,
  canManage,
}: {
  org: string
  saved: Dashboard
  canManage: boolean
}) {
  const location = useLocation(),
    navigate = useNavigate(),
    cache = useQueryClient()
  const [params, setParams] = useSearchParams()
  const gap = usePanelGap()
  const [draft, setDraft] = useState<Dashboard | null>(() =>
    location.state?.edit && canManage ? structuredClone(saved) : null,
  )
  const [base, setBase] = useState(saved)
  const dashboard = draft ?? saved
  const gridLayouts = useMemo(
    () => responsiveLayouts(dashboard.layouts),
    [dashboard.layouts],
  )
  const [editor, setEditor] = useState<DashboardWidget | null>(null)
  const [editorDirty, setEditorDirty] = useState(false)
  const [editorDiscard, setEditorDiscard] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const addPlacement = useRef<"available" | "bottom">("available")
  const [revealWidget, setRevealWidget] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [dialog, setDialog] = useState<
    "settings" | "duplicate" | "history" | "delete" | null
  >(null)
  const [discard, setDiscard] = useState(false)
  const [saving, setSaving] = useState(false)
  const [starring, setStarring] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [invalidPanel, setInvalidPanel] = useState<string | null>(null)
  const [breakpoint, setBreakpoint] = useState("lg")
  const [railOpen, setRailOpen] = useState(() => readStorage(RAIL_KEY, false))
  const [displays, setDisplays] = useState<
    Record<string, "cells" | "table">
  >(() => readStorage(DISPLAY_KEY, {}))
  const layoutAction = useRef(false)
  const panelContent = useRef(new Map<string, HTMLDivElement>())
  useEffect(() => {
    if (!revealWidget || editor) return
    const frame = requestAnimationFrame(() => {
      panelContent.current.get(revealWidget)?.scrollIntoView({ block: "center" })
      setRevealWidget(null)
    })
    return () => cancelAnimationFrame(frame)
  }, [revealWidget, editor])
  const { setDirty } = useDirtyContext()
  const draftDirty = Boolean(
    draft && JSON.stringify(draft) !== JSON.stringify(base),
  )
  const dirty = draftDirty || editorDirty
  const view = readView(params, saved.defaults)
  const rangeKey = JSON.stringify(view.range)
  // Absolute ranges stay fixed; relative panels resolve their window per fetch.
  const window = useMemo(() => resolveRange(view.range), [rangeKey])
  const compare = params.get("compare") === "1"
  const kiosk = params.get("kiosk") === "1"
  const editorParam = params.get("edit-panel")
  const list = useQuery({
    queryKey: ["dashboards", org],
    queryFn: () => api.dashboards(org),
  })
  const save = useCallback(async () => {
    if (!draft || saving) return false
    if (editorDirty) {
      setError(
        new Error("Apply or cancel your panel edits before saving the dashboard."),
      )
      return false
    }
    if (!draft.name.trim()) {
      setError(new Error("Enter a dashboard name."))
      return false
    }
    const invalid = draft.widgets.find((w) => widgetError(w))
    if (invalid) {
      setInvalidPanel(invalid.id)
      setError(
        new Error(`${invalid.title.trim() || "Untitled panel"}: ${widgetError(invalid)}`),
      )
      return false
    }
    setSaving(true)
    setError(null)
    setInvalidPanel(null)
    try {
      const next = await api.updateDashboard(org, saved.uuid, {
        name: draft.name.trim(),
        widgets: draft.widgets,
        layouts: cleanLayouts(draft.layouts),
        defaults: draft.defaults,
        revision: base.revision,
      })
      cache.setQueryData(["dashboard", org, saved.uuid], next)
      void cache.invalidateQueries({ queryKey: ["dashboards", org] })
      setBase(next)
      setDraft(null)
      setSettingsOpen(false)
      setDirty(false)
      toast.success("Dashboard saved")
      return true
    } catch (issue) {
      // Name the panel behind a server validation error and highlight it.
      const field =
        issue instanceof ApiError && issue.status === 422
          ? Object.keys(
              (issue.payload as { errors?: Record<string, string[]> } | null)
                ?.errors ?? {},
            ).find((key) => /^widgets\.\d+/.test(key))
          : undefined
      const widget = field ? draft.widgets[Number(field.split(".")[1])] : undefined
      setInvalidPanel(widget?.id ?? null)
      setError(widget ? new Error(`${widget.title}: ${errorMessage(issue)}`) : issue)
      return false
    } finally {
      setSaving(false)
    }
  }, [draft, editorDirty, org, saved.uuid, base.revision, saving, cache, setDirty])
  // Offer "Save and leave" only when the dashboard draft changed; an unsent
  // control value alone has nothing for Save to write.
  useUnsaved(dirty, draftDirty ? save : undefined)
  useEffect(() => {
    if (invalidPanel)
      document
        .getElementById(`panel-${invalidPanel}`)
        ?.scrollIntoView({ block: "nearest" })
  }, [invalidPanel])
  // The editor lives at ?edit-panel=<id>. Browser Back (or the header link)
  // removes the parameter; unapplied edits ask before closing.
  useEffect(() => {
    if (editor) {
      if (editorParam === editor.id) return
      if (editorDirty) {
        const next = new URLSearchParams(params)
        next.set("edit-panel", editor.id)
        setParams(next, { state: { panelEditor: true } })
        setEditorDiscard(true)
      } else setEditor(null)
      return
    }
    if (!editorParam) return
    // A reload, shared link or Forward opens the editor for a saved or
    // drafted panel; unknown ids (and viewers) drop the parameter.
    const widget = (draft ?? saved).widgets.find((w) => w.id === editorParam)
    if (widget && canManage) {
      if (!draft) startEditing()
      setEditor(structuredClone(widget))
    } else setParam("edit-panel", null)
    // Runs when the URL or permission changes, not when the editor state does.
  }, [editorParam, canManage])
  const kioskView = useRef<HTMLDivElement>(null)
  const kioskButton = useRef<HTMLButtonElement>(null)
  const wasKiosk = useRef(kiosk)
  useEffect(() => {
    if (kiosk) {
      const root = document.getElementById("root")
      const wasInert = root?.inert ?? false
      const overflow = document.body.style.overflow
      document.body.style.overflow = "hidden"
      root?.setAttribute("inert", "")
      kioskView.current?.focus()
      wasKiosk.current = true
      return () => {
        if (root) root.inert = wasInert
        document.body.style.overflow = overflow
      }
    }
    // Back from kiosk: return focus to the button that opened it.
    if (wasKiosk.current) kioskButton.current?.focus()
    wasKiosk.current = false
  }, [kiosk])
  useEffect(() => {
    if (!kiosk) return
    const exit = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !document.querySelector("[role=dialog],[role=alertdialog],[role=menu]")
      )
        setParam("kiosk", null)
    }
    document.addEventListener("keydown", exit)
    return () => document.removeEventListener("keydown", exit)
  })
  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params)
    if (value === null) next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }
  function updateView(next: DashboardView) {
    setParams(writeView(params, next))
  }
  function openEditor(widget: DashboardWidget) {
    setEditor(widget)
    const next = new URLSearchParams(params)
    next.set("edit-panel", widget.id)
    setParams(next, { state: { panelEditor: true } })
  }
  function closeEditor() {
    setEditor(null)
    setEditorDirty(false)
    setEditorDiscard(false)
    if (location.state?.panelEditor) navigate(-1)
    else setParam("edit-panel", null)
  }
  function startEditing() {
    setBase(saved)
    setDraft(structuredClone(saved))
    setError(null)
    setInvalidPanel(null)
  }
  function openAdd(placement: "available" | "bottom" = "available") {
    addPlacement.current = placement
    setAddOpen(true)
  }
  function applyWidget(widget: DashboardWidget) {
    const isNew = !draft?.widgets.some((item) => item.id === widget.id)
    setDraft((current) => {
      if (!current) return current
      const existing = current.widgets.some((w) => w.id === widget.id)
      return {
        ...current,
        widgets: existing
          ? current.widgets.map((w) => (w.id === widget.id ? widget : w))
          : [...current.widgets, widget],
        layouts: existing
          ? current.layouts
          : appendLayout(current.layouts, widget.id, addPlacement.current),
      }
    })
    if (invalidPanel === widget.id) setInvalidPanel(null)
    // Duplicate panel applies without an open editor.
    if (editor) closeEditor()
    if (isNew) setRevealWidget(widget.id)
  }
  function removePanel(widget: DashboardWidget) {
    if (!draft) return
    const index = draft.widgets.findIndex((w) => w.id === widget.id)
    const items = Object.fromEntries(
      Object.entries(draft.layouts).map(([key, list]) => [
        key,
        list?.find((item) => item.i === widget.id),
      ]),
    )
    setDraft((current) =>
      current && {
        ...current,
        widgets: current.widgets.filter((w) => w.id !== widget.id),
        layouts: Object.fromEntries(
          Object.entries(current.layouts).map(([key, list]) => [
            key,
            list?.filter((item) => item.i !== widget.id),
          ]),
        ),
      },
    )
    toast(`Removed ${widget.title}`, {
      action: {
        label: "Undo",
        onClick: () =>
          setDraft((current) =>
            current && !current.widgets.some((w) => w.id === widget.id)
              ? {
                  ...current,
                  widgets: [
                    ...current.widgets.slice(0, index),
                    widget,
                    ...current.widgets.slice(index),
                  ],
                  layouts: Object.fromEntries(
                    Object.entries(current.layouts).map(([key, list]) => {
                      const item = items[key]
                      return [
                        key,
                        item
                          ? [...(list ?? []), item]
                          : appendLayout({ [key]: list ?? [] }, widget.id)[key],
                      ]
                    }),
                  ),
                }
              : current,
          ),
      },
    })
  }
  /** Keyboard move for the focused drag handle at the current breakpoint. */
  function nudge(widgetId: string, key: string) {
    // The PUT payload is already captured while saving; later moves would be lost.
    if (saving) return
    setDraft((current) => {
      if (!current) return current
      const layout = responsiveLayouts(current.layouts)[breakpoint] ?? []
      const item = layout.find((i) => i.i === widgetId)
      if (!item) return current
      let next = layout
      if (key === "ArrowLeft" || key === "ArrowRight") {
        const x = Math.min(
          (COLS[breakpoint] ?? 12) - item.w,
          Math.max(0, item.x + (key === "ArrowLeft" ? -1 : 1)),
        )
        next = layout.map((i) => (i.i === widgetId ? { ...i, x } : i))
      } else {
        // Vertical moves swap with the nearest panel above or below, since
        // the grid compacts panels upward.
        const beside = layout.filter(
          (i) => i.i !== widgetId && i.x < item.x + item.w && i.x + i.w > item.x,
        )
        const up = key === "ArrowUp"
        const other = up
          ? beside.filter((i) => i.y < item.y).sort((a, b) => b.y - a.y)[0]
          : beside.filter((i) => i.y > item.y).sort((a, b) => a.y - b.y)[0]
        if (!other) return current
        next = layout.map((i) =>
          i.i === widgetId
            ? { ...i, y: up ? other.y : item.y + other.h }
            : i.i === other.i
              ? { ...i, y: up ? other.y + item.h : item.y }
              : i,
        )
      }
      return {
        ...current,
        layouts: cleanLayouts({ ...current.layouts, [breakpoint]: next }),
      }
    })
  }
  function cancelEditing() {
    if (dirty) setDiscard(true)
    else {
      setDraft(null)
      setSettingsOpen(false)
      setInvalidPanel(null)
    }
  }
  function discardDraft() {
    setDraft(null)
    setEditor(null)
    setEditorDirty(false)
    setDirty(false)
    setError(null)
    setInvalidPanel(null)
    setSettingsOpen(false)
    setDiscard(false)
    void cache.invalidateQueries({ queryKey: ["dashboard", org, saved.uuid] })
  }
  async function toggleStar() {
    setStarring(true)
    try {
      const next = await api.starDashboard(org, saved.uuid, !saved.starred)
      cache.setQueryData<Dashboard>(["dashboard", org, saved.uuid], (current) =>
        current ? { ...current, starred: next.starred } : current,
      )
      void cache.invalidateQueries({ queryKey: ["dashboards", org] })
    } catch (issue) {
      toast.error(errorMessage(issue))
    } finally {
      setStarring(false)
    }
  }
  function link(extra: Record<string, string> = {}) {
    const next = writeView(params, view)
    for (const key of ["kiosk", "edit-panel", "panel"]) next.delete(key)
    for (const [key, value] of Object.entries(extra)) next.set(key, value)
    return `${globalThis.location.origin}${location.pathname}?${next}`
  }
  async function copy(url: string, what: string) {
    try {
      await navigator.clipboard.writeText(url)
      toast.success(`${what} copied`)
    } catch {
      toast.error("The browser blocked copying. Copy the address bar instead.")
    }
  }
  function downloadCsv(widget: DashboardWidget) {
    const rows = panelCsvRows(cache, org, widget, view)
    if (!rows.length) {
      toast("Nothing loaded to download yet")
      return
    }
    saveFile(
      `${fileName(widget.title)}.csv`,
      "﻿" + toCsv(rows),
      "text/csv;charset=utf-8",
    )
  }
  function chooseDisplay(id: string, value: string) {
    setDisplays((current) => {
      const next = { ...current }
      if (value === "cells" || value === "table") next[id] = value
      else delete next[id]
      writeStorage(DISPLAY_KEY, next)
      return next
    })
  }
  const absoluteIssue =
    params.has("from") && params.has("to")
      ? absoluteError(params.get("from")!, params.get("to")!)
      : null
  const fullWidget = dashboard.widgets.find((w) => w.id === params.get("panel"))
  const bodyProps = {
    preview: Boolean(draft),
    org,
    view,
    window,
    compare,
    onZoom: (from: string, to: string) =>
      updateView({ ...view, range: { mode: "absolute", from, to } }),
  }
  function fitPanelHeight(widgetId: string) {
    const content = panelContent.current.get(widgetId)
    if (!content) return
    const header = content.previousElementSibling as HTMLElement | null
    const contentTop = content.getBoundingClientRect().top
    const contentStyle = getComputedStyle(content)
    const visibleLeaves = Array.from(content.querySelectorAll<HTMLElement>("*"))
      .filter((element) => {
        const style = getComputedStyle(element)
        return (
          element.childElementCount === 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          style.position !== "absolute"
        )
      })
      .map((element) => element.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0)
    const contentBottom = Math.max(
      contentTop + Number.parseFloat(contentStyle.paddingTop || "0"),
      ...visibleLeaves.map((rect) => rect.bottom),
    )
    const naturalContentHeight =
      contentBottom -
      contentTop +
      Number.parseFloat(contentStyle.paddingBottom || "0")
    const requiredHeight = (header?.offsetHeight ?? 0) + naturalContentHeight + 2
    const rows = Math.min(
      100,
      Math.max(1, Math.ceil((requiredHeight + gap) / (ROW_HEIGHT + gap))),
    )
    setDraft((current) => {
      if (!current) return current
      const currentLayout = responsiveLayouts(current.layouts)[breakpoint] ?? []
      return {
        ...current,
        layouts: cleanLayouts({
          ...current.layouts,
          [breakpoint]: currentLayout.map((item) =>
            item.i === widgetId ? { ...item, h: rows } : item,
          ),
        }),
      }
    })
  }
  const backTo = `${location.pathname}?${(() => {
    const next = new URLSearchParams(params)
    next.delete("edit-panel")
    return next
  })()}`

  if (editor)
    return (
      <>
        <PanelEditor
          key={editor.id}
          initial={editor}
          org={org}
          view={view}
          window={window}
          dashboardName={dashboard.name}
          backTo={backTo}
          onDirty={setEditorDirty}
          onCancel={() => (editorDirty ? setEditorDiscard(true) : closeEditor())}
          onApply={applyWidget}
        />
        <AlertDialog open={editorDiscard} onOpenChange={setEditorDiscard}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Discard panel changes?</AlertDialogTitle>
              <AlertDialogDescription>
                Unapplied changes in this editor will be lost. Your dashboard
                draft is unchanged.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep editing</AlertDialogCancel>
              <Button variant="destructive" onClick={closeEditor}>
                Discard panel changes
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    )

  const folders = [
    ...new Set((list.data ?? []).flatMap((d) => (d.folder ? [d.folder] : []))),
  ]
  const grid = !dashboard.widgets.length ? (
    <Empty className="border">
      <EmptyHeader>
        <EmptyTitle>No panels yet</EmptyTitle>
        {!canManage && (
          <EmptyDescription>
            People who can manage devices add panels here.
          </EmptyDescription>
        )}
      </EmptyHeader>
      {canManage && (
        <Button
          onClick={() => {
            if (!draft) startEditing()
            openAdd()
          }}
        >
          <PlusIcon data-icon="inline-start" />
          Add panel
        </Button>
      )}
    </Empty>
  ) : (
    <div className={cn(!gap && "border-t border-l")}>
      <Grid
        className="dashboard-grid"
        autoSize
        isBounded={false}
        compactType={null}
        style={draft ? { minHeight: (Math.max(0, ...(gridLayouts[breakpoint] ?? []).map((item) => item.y + item.h)) + 6) * (ROW_HEIGHT + gap) } : undefined}
        layouts={gridLayouts as ResponsiveLayouts}
        breakpoints={BREAKPOINTS}
        cols={COLS}
        rowHeight={ROW_HEIGHT}
        margin={[gap, gap]}
        containerPadding={[0, 0]}
        isDraggable={Boolean(draft) && !saving && !kiosk}
        isResizable={Boolean(draft) && !saving && !kiosk}
        resizeHandles={["s", "e", "se"]}
        draggableHandle=".dashboard-drag-handle"
        onBreakpointChange={setBreakpoint}
        onDragStart={() => {
          layoutAction.current = true
        }}
        onResizeStart={() => {
          layoutAction.current = true
        }}
        onLayoutChange={(_, layouts) => {
          if (draft && layoutAction.current) {
            setDraft((current) =>
              current ? { ...current, layouts: cleanLayouts(layouts) } : null,
            )
            layoutAction.current = false
          }
        }}
      >
        {dashboard.widgets.map((widget) => {
          const devices = [
            ...new Set(
              widget.config.sources.flatMap((s) =>
                s.device_name ? [s.device_name] : [],
              ),
            ),
          ]
          const meta =
            widget.type === "controls"
              ? "Live · 1 s"
              : devices.length > 2
                ? `${devices.length} devices`
                : devices.join(", ")
          return (
            // Chart dimensions must settle with the grid, not animate through
            // intermediate sizes that trigger synchronous measurement updates.
            <div key={widget.id} style={{ transition: "none" }}>
              <div
                id={`panel-${widget.id}`}
                className={cn(
                  "flex h-full flex-col overflow-hidden bg-card text-card-foreground",
                  gap ? "border" : "border-r border-b",
                  invalidPanel === widget.id && "ring-2 ring-destructive ring-inset",
                )}
              >
                <div className="flex items-start gap-2 border-b py-1.5 pr-1.5 pl-3">
                  {draft && (
                    <button
                      type="button"
                      aria-label="Drag panel"
                      title="Drag, or use arrow keys to move"
                      disabled={saving}
                      className="dashboard-drag-handle -ml-1.5 mt-0.5 shrink-0 cursor-move rounded-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onKeyDown={(event) => {
                        if (event.key.startsWith("Arrow")) {
                          event.preventDefault()
                          nudge(widget.id, event.key)
                        }
                      }}
                    >
                      <GripVerticalIcon className="size-4" />
                    </button>
                  )}
                  <div className="min-w-0 flex-1 py-0.5">
                    <h2
                      id={`panel-title-${widget.id}`}
                      className="skin-label truncate text-sm font-medium"
                      title={widget.title}
                    >
                      {widget.title}
                    </h2>
                    {widget.description && (
                      <p
                        className="truncate text-xs text-muted-foreground"
                        title={widget.description}
                      >
                        {widget.description}
                      </p>
                    )}
                  </div>
                  {meta && (
                    <span className="hidden max-w-[40%] truncate py-0.5 text-xs text-muted-foreground sm:block">
                      {meta}
                    </span>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Panel menu: ${widget.title}`}
                      >
                        <MoreHorizontalIcon />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuGroup>
                        <DropdownMenuItem onSelect={() => setParam("panel", widget.id)}>
                          <MaximizeIcon />
                          View fullscreen
                        </DropdownMenuItem>
                        {!NO_CSV.includes(widget.type) && (
                          <DropdownMenuItem onSelect={() => downloadCsv(widget)}>
                            <DownloadIcon />
                            Download CSV
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onSelect={() => void copy(link({ panel: widget.id }), "Panel link")}
                        >
                          <LinkIcon />
                          Copy link
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                      {widget.type === "status" && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuLabel className="text-xs text-muted-foreground">
                            Show as
                          </DropdownMenuLabel>
                          <DropdownMenuRadioGroup
                            value={displays[widget.id] ?? "auto"}
                            onValueChange={(value) => chooseDisplay(widget.id, value)}
                          >
                            <DropdownMenuRadioItem value="auto">
                              Fit automatically
                            </DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="cells">
                              Cells
                            </DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="table">
                              Table
                            </DropdownMenuRadioItem>
                          </DropdownMenuRadioGroup>
                        </>
                      )}
                      {draft && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuGroup>
                            <DropdownMenuItem
                              disabled={saving}
                              onSelect={() => openEditor(widget)}
                            >
                              <PencilIcon />
                              Edit panel
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={saving}
                              onSelect={() => fitPanelHeight(widget.id)}
                            >
                              <ChevronsUpDownIcon />
                              Fit height to content
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={saving}
                              onSelect={() =>
                                applyWidget({
                                  ...structuredClone(widget),
                                  id: crypto.randomUUID(),
                                  title: `${widget.title.slice(0, 110)} (copy)`,
                                })
                              }
                            >
                              <CopyIcon />
                              Duplicate panel
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={saving}
                              onSelect={() => removePanel(widget)}
                            >
                              <Trash2Icon />
                              Remove panel
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div
                  ref={(node) => {
                    if (node) panelContent.current.set(widget.id, node)
                    else panelContent.current.delete(widget.id)
                  }}
                  // Focusable so keyboard users can scroll a panel whose
                  // content is taller than its grid cell.
                  role="group"
                  tabIndex={0}
                  aria-labelledby={`panel-title-${widget.id}`}
                  className="min-h-0 flex-1 overflow-auto p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                >
                  <PanelBody
                    {...bodyProps}
                    widget={widget}
                    display={displays[widget.id]}
                  />
                </div>
              </div>
            </div>
          )
        })}
      </Grid>
    </div>
  )

  const fullscreen = (
    <Dialog open={Boolean(fullWidget)} onOpenChange={(open) => !open && setParam("panel", null)}>
      <DialogContent className="flex h-[90svh] max-w-none flex-col sm:max-w-[95vw]">
        <DialogHeader>
          <DialogTitle>{fullWidget?.title}</DialogTitle>
          <DialogDescription>
            {fullWidget?.description || (fullWidget && PANEL_LABELS[fullWidget.type])}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto">
          {fullWidget && (
            <PanelBody
              {...bodyProps}
              widget={fullWidget}
              display={displays[fullWidget.id]}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )

  if (kiosk)
    // Portaled outside #root, which is inert meanwhile, so the shell is out of
    // the tab order and screen reader browse mode.
    return createPortal(
      <div
        ref={kioskView}
        data-kiosk
        tabIndex={-1}
        aria-label={`${dashboard.name}, kiosk`}
        role="region"
        className="fixed inset-0 z-40 flex flex-col overflow-auto bg-background outline-none"
      >
        <PageHeader
          title={dashboard.name}
          meta={<UpdatedAt org={org} timezone={view.timezone} />}
          actions={
            <Button variant="outline" size="sm" onClick={() => setParam("kiosk", null)}>
              Exit kiosk
            </Button>
          }
        />
        <div className="p-4">{grid}</div>
        {fullscreen}
      </div>,
      document.body,
    )

  const panels = `${dashboard.widgets.length} ${dashboard.widgets.length === 1 ? "panel" : "panels"}`
  return (
    <>
      <PageHeader
        className="sticky top-0 z-20 bg-background"
        title={dashboard.name}
        heading={
          <DashboardSwitcher
            name={dashboard.name}
            current={saved.uuid}
            dashboards={list.data ?? [saved]}
            onChange={(id) => navigate(dashboardPath(org, id))}
          />
        }
        back={{ to: dashboardPath(org), label: "Dashboards" }}
        meta={
          <span className="flex items-center gap-2">
            {!draft && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-pressed={Boolean(saved.starred)}
                disabled={starring}
                onClick={() => void toggleStar()}
                aria-label="Star dashboard"
                title={saved.starred ? "Starred" : "Star"}
              >
                <StarIcon className={cn(saved.starred && "fill-warning text-warning")} />
              </Button>
            )}
            <span className="truncate">
              {dashboard.folder ? `${dashboard.folder} · ` : ""}
              {panels}
            </span>
            {draft && (
              <Badge variant="outline">{dirty ? "Unsaved changes" : "Editing"}</Badge>
            )}
          </span>
        }
        actions={
          draft ? (
            <>
              <Button ref={kioskButton} variant="outline" onClick={() => setParam("kiosk", "1")}><MonitorIcon data-icon="inline-start" /><span className="max-sm:sr-only">Kiosk</span></Button>
              <Button variant="outline" disabled={saving} onClick={() => openAdd()}>
                <PlusIcon data-icon="inline-start" />
                <span className="max-sm:sr-only">Add panel</span>
              </Button>
              <Button
                variant="outline"
                disabled={saving}
                onClick={() => setSettingsOpen(true)}
                aria-label="Dashboard settings"
                title="Dashboard settings"
              >
                <Settings2Icon />
              </Button>
              <Button variant="outline" disabled={saving} onClick={cancelEditing}>
                Cancel<span className="sr-only"> editing</span>
              </Button>
              <Button disabled={saving || !dirty} onClick={() => void save()}>
                <SaveIcon data-icon="inline-start" />
                {saving ? "Saving…" : <>Save<span className="sr-only"> dashboard</span></>}
              </Button>
            </>
          ) : (
            <>
              <Toggle
                variant="outline"
                pressed={railOpen}
                onPressedChange={(open) => {
                  setRailOpen(open)
                  writeStorage(RAIL_KEY, open)
                }}
                aria-label="Context panel"
                title="Context panel"
              >
                <PanelRightIcon />
              </Toggle>
              <Button variant="outline" onClick={() => void copy(link(), "Dashboard link")}>
                <Share2Icon data-icon="inline-start" />
                <span className="max-sm:sr-only">Share</span>
              </Button>
              <Button
                ref={kioskButton}
                variant="outline"
                onClick={() => setParam("kiosk", "1")}
              >
                <MonitorIcon data-icon="inline-start" />
                <span className="max-sm:sr-only">Kiosk</span>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label="More dashboard actions">
                    <MoreHorizontalIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuGroup>
                    {canManage && (
                      <DropdownMenuItem onSelect={() => setDialog("duplicate")}>
                        <CopyIcon />
                        Duplicate
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      onSelect={() => downloadJson(saved.name, definition(saved))}
                    >
                      <FileJsonIcon />
                      Export JSON
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setDialog("history")}>
                      <HistoryIcon />
                      Version history
                    </DropdownMenuItem>
                    {canManage && (
                      <DropdownMenuItem onSelect={() => setDialog("settings")}>
                        <Settings2Icon />
                        Settings
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuGroup>
                  {canManage && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => setDialog("delete")}
                      >
                        <Trash2Icon />
                        Delete
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              {canManage && (
                <Button onClick={startEditing}>
                  <PencilIcon data-icon="inline-start" />
                  Edit<span className="sr-only"> dashboard</span>
                </Button>
              )}
            </>
          )
        }
      >
        <TimeControls
          view={view}
          defaults={saved.defaults}
          compare={compare}
          onChange={updateView}
          onCompare={(on) => setParam("compare", on ? "1" : null)}
          onRefresh={() => {
            for (const key of [
              "dashboard-latest",
              "dashboard-history",
              "dashboard-state-history",
              "dashboard-workflow-location",
              "dashboard-workflow-alerts",
              "dashboard-location-map",
            ])
              void cache.invalidateQueries({ queryKey: [key, org] })
          }}
        >
          <UpdatedAt org={org} timezone={view.timezone} />
        </TimeControls>
      </PageHeader>
      <div className="flex min-w-0 flex-col lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 md:p-6">
          {absoluteIssue && (
            <Alert>
              <AlertDescription>
                The URL time range is invalid: {absoluteIssue} Showing the saved
                dashboard default instead.
              </AlertDescription>
            </Alert>
          )}
          <RequestError error={error} />
          {error instanceof ApiError && error.status === 409 && (
            <Button variant="outline" className="self-start" onClick={() => setDiscard(true)}>
              Reload saved dashboard…
            </Button>
          )}
          {grid}
          {draft && dashboard.widgets.length > 0 && (
            <Button variant="outline" disabled={saving} onClick={() => openAdd("bottom")}>
              <PlusIcon data-icon="inline-start" />Add panel below
            </Button>
          )}
        </div>
        {railOpen && !draft && (
          <div className="border-t lg:w-72 lg:shrink-0 lg:border-t-0 lg:border-l">
            <ContextRail
              org={org}
              dashboard={saved}
              canManage={canManage}
              timezone={view.timezone}
            />
          </div>
        )}
      </div>
      {draft && (
        <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
          <SheetContent className="data-[side=right]:w-full sm:data-[side=right]:max-w-md">
            <SheetHeader>
              <SheetTitle>Dashboard settings</SheetTitle>
              <SheetDescription>
                Changes stay in this draft until you save.
              </SheetDescription>
            </SheetHeader>
            <FieldGroup className="overflow-y-auto px-4 pb-4">
              <Field data-invalid={!draft.name.trim()}>
                <FieldLabel htmlFor="dashboard-name">Dashboard name</FieldLabel>
                <Input
                  id="dashboard-name"
                  maxLength={120}
                  value={draft.name}
                  disabled={saving}
                  aria-invalid={!draft.name.trim()}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel>Current viewing settings</FieldLabel>
                <p className="text-sm text-muted-foreground">
                  {viewSummary(view)}
                </p>
              </Field>
              <Field>
                <FieldLabel>Saved viewing defaults</FieldLabel>
                <p className="text-sm text-muted-foreground">
                  {viewSummary(draft.defaults)}
                </p>
                <Button
                  variant="outline"
                  disabled={saving}
                  onClick={() => setDraft({ ...draft, defaults: structuredClone(view) })}
                >
                  Use current time settings as defaults
                </Button>
              </Field>
            </FieldGroup>
          </SheetContent>
        </Sheet>
      )}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add panel</DialogTitle>
            <DialogDescription>Choose what the panel shows.</DialogDescription>
          </DialogHeader>
          {[...new Set(Object.values(widgetRegistry).map((d) => d.group))].map((group) => (
            <section key={group} className="flex flex-col gap-2">
              <h3 className="skin-label text-xs text-muted-foreground">{group}</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {(Object.keys(widgetRegistry) as DashboardWidget["type"][])
                  .filter((type) => widgetRegistry[type].group === group)
                  .map((type) => {
                    const Icon = ICONS[type]
                    return (
                      <Button
                        key={type}
                        variant="outline"
                        aria-label={`Add ${PANEL_LABELS[type]}`}
                        aria-describedby={`add-${type}`}
                        className="h-auto items-start justify-start gap-3 p-3 text-left whitespace-normal"
                        onClick={() => {
                          setAddOpen(false)
                          openEditor(newWidget(type))
                        }}
                      >
                        <Icon className="mt-0.5 text-muted-foreground" />
                        <span className="flex flex-col gap-0.5">
                          <span className="font-medium">{PANEL_LABELS[type]}</span>
                          <span id={`add-${type}`} className="text-xs font-normal text-muted-foreground">
                            {widgetRegistry[type].description}
                          </span>
                        </span>
                      </Button>
                    )
                  })}
              </div>
            </section>
          ))}
        </DialogContent>
      </Dialog>
      {fullscreen}
      <AlertDialog open={discard} onOpenChange={setDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard dashboard changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Your draft will be discarded and the latest saved dashboard
              loaded. Other dashboards will not change.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay</AlertDialogCancel>
            <Button variant="destructive" onClick={discardDraft}>
              Discard and reload
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Sheet open={dialog === "history"} onOpenChange={(open) => setDialog(open ? "history" : null)}>
        <SheetContent className="data-[side=right]:w-full sm:data-[side=right]:max-w-md">
          <SheetHeader>
            <SheetTitle>Version history</SheetTitle>
            <SheetDescription>Restoring saves the old version as a new one.</SheetDescription>
          </SheetHeader>
          <div className="overflow-y-auto px-4 pb-4">
            {dialog === "history" && (
              <VersionHistory
                org={org}
                dashboard={saved.uuid}
                revision={saved.revision}
                canManage={canManage}
                onRestored={(next) => {
                  setBase(next)
                  setDialog(null)
                }}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
      {dialog === "settings" && (
        <SettingsDialog
          org={org}
          dashboard={saved}
          folders={folders}
          folderOnly={false}
          onReload={() => cache.invalidateQueries({ queryKey: ["dashboard", org, saved.uuid] })}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "duplicate" && (
        <DuplicateDialog org={org} dashboard={saved} onClose={() => setDialog(null)} />
      )}
      <Confirm
        open={dialog === "delete"}
        title={`Delete ${saved.name}?`}
        description="The dashboard is removed for everyone in this organization."
        action="Delete dashboard"
        onClose={() => setDialog(null)}
        onConfirm={async () => {
          await api.deleteDashboard(org, saved.uuid)
          toast.success(`Deleted ${saved.name}`)
          navigate(dashboardPath(org), { replace: true })
          cache.removeQueries({ queryKey: ["dashboard", org, saved.uuid] })
          await cache.invalidateQueries({ queryKey: ["dashboards", org] })
        }}
      />
    </>
  )
}

function viewSummary(view: DashboardView) {
  return [
    view.range.mode === "relative"
      ? PRESET_LABELS[view.range.preset]
      : "Fixed historical interval",
    view.timezone === "browser" ? "Browser time" : "UTC",
    view.refresh ? `Refresh every ${view.refresh}s` : "Refresh off",
  ].join(" · ")
}

/** The title is also the switcher: a searchable list of this organization's dashboards. */
function DashboardSwitcher({
  name,
  current,
  dashboards,
  onChange,
}: {
  name: string
  current: string
  dashboards: Dashboard[]
  onChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          title="Switch dashboard"
          className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="truncate">{name}</span>
          <ChevronDownIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] p-0" aria-label="Switch dashboard">
        <Command>
          <CommandInput aria-label="Search dashboards" placeholder="Search dashboards…" />
          <CommandList aria-label="Dashboards">
            <CommandEmpty>No matching dashboards</CommandEmpty>
            <CommandGroup>
              {dashboards.map((d) => (
                <CommandItem
                  key={d.uuid}
                  value={d.uuid}
                  keywords={[d.name, d.folder ?? ""]}
                  data-checked={d.uuid === current}
                  onSelect={() => {
                    setOpen(false)
                    if (d.uuid !== current) onChange(d.uuid)
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{d.name}</span>
                  {d.folder && (
                    <span className="truncate text-xs text-muted-foreground">{d.folder}</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/**
 * Time of the last successful dashboard data fetch. Subscribes on its own so
 * that each panel refresh re-renders this label, not the whole grid.
 */
function UpdatedAt({
  org,
  timezone,
}: {
  org: string
  timezone: DashboardView["timezone"]
}) {
  const cache = useQueryClient()
  const ours = (key: readonly unknown[]) =>
    typeof key[0] === "string" && key[0].startsWith("dashboard-") && key[1] === org
  const [at, setAt] = useState(
    () =>
      Math.max(
        0,
        ...cache
          .getQueryCache()
          .findAll({ predicate: (query) => ours(query.queryKey) })
          .map((query) => query.state.dataUpdatedAt),
      ) || null,
  )
  useEffect(
    () =>
      cache.getQueryCache().subscribe((event) => {
        if (
          event.type === "updated" &&
          event.action.type === "success" &&
          ours(event.query.queryKey)
        )
          setAt(Date.now())
      }),
    // ours only reads org.
    [cache, org],
  )
  if (!at) return null
  return (
    <span className="text-xs whitespace-nowrap text-muted-foreground">
      Updated{" "}
      <span className="font-mono tabular-nums">
        {new Date(at).toLocaleTimeString(undefined, {
          hourCycle: "h23",
          ...(timezone === "utc" ? { timeZone: "UTC" } : {}),
        })}
      </span>
    </span>
  )
}
