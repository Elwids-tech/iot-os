import { useCallback, useMemo, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom"
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
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@iot-os/ui/components/card"
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@iot-os/ui/components/sheet"
import { SearchableSelect } from "@iot-os/ui/components/searchable-select"
import {
  ArrowLeftIcon,
  CopyIcon,
  ChevronsUpDownIcon,
  GripVerticalIcon,
  MaximizeIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SaveIcon,
  Settings2Icon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"
import { api } from "../lib/api"
import { RequestError } from "../components/forms"
import { useDirtyContext, useUnsaved } from "../lib/unsaved"
import {
  absoluteError,
  appendLayout,
  cleanLayouts,
  dashboardPath,
  newWidget,
  PRESET_LABELS,
  readView,
  resolveRange,
  responsiveLayouts,
  widgetError,
  writeView,
} from "./model"
import { PanelEditor } from "./PanelEditor"
import { PanelBody, widgetRegistry } from "./registry"
import { TimeControls } from "./TimeControls"

const Grid = WidthProvider(Responsive)
const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }
const COLS = { lg: 12, md: 10, sm: 6, xs: 1, xxs: 1 }
const ROW_HEIGHT = 48
const GRID_MARGIN = 16

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
  const [addOpen, setAddOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState<string | null>(null)
  const [discard, setDiscard] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [switchSearch, setSwitchSearch] = useState("")
  const [breakpoint, setBreakpoint] = useState("lg")
  const layoutAction = useRef(false)
  const panelContent = useRef(new Map<string, HTMLDivElement>())
  const { setDirty } = useDirtyContext()
  const dirty =
    Boolean(draft && JSON.stringify(draft) !== JSON.stringify(base)) ||
    editorDirty
  const view = readView(params, saved.defaults)
  const rangeKey = JSON.stringify(view.range)
  const window = useMemo(() => resolveRange(view.range), [rangeKey])
  const list = useQuery({
    queryKey: ["dashboards", org],
    queryFn: () => api.dashboards(org),
  })
  const save = useCallback(async () => {
    if (!draft || saving) return false
    if (editorDirty) {
      setError(
        new Error(
          "Apply or cancel your panel edits before saving the dashboard.",
        ),
      )
      return false
    }
    const issue = !draft.name.trim()
      ? "Enter a dashboard name."
      : draft.widgets.map(widgetError).find(Boolean)
    if (issue) {
      setError(new Error(issue))
      return false
    }
    setSaving(true)
    setError(null)
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
      setError(issue)
      return false
    } finally {
      setSaving(false)
    }
  }, [
    draft,
    editorDirty,
    org,
    saved.uuid,
    base.revision,
    saving,
    cache,
    setDirty,
  ])
  useUnsaved(dirty, save)
  function updateView(next: DashboardView) {
    setParams(writeView(params, next))
  }
  function applyWidget(widget: DashboardWidget) {
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
          : appendLayout(current.layouts, widget.id),
      }
    })
    setEditor(null)
    setEditorDirty(false)
  }
  function cancelEditing() {
    if (dirty) setDiscard(true)
    else {
      setDraft(null)
      setSettingsOpen(false)
    }
  }
  function discardDraft() {
    setDraft(null)
    setEditor(null)
    setEditorDirty(false)
    setDirty(false)
    setError(null)
    setSettingsOpen(false)
    setDiscard(false)
    void cache.invalidateQueries({ queryKey: ["dashboard", org, saved.uuid] })
  }
  const absoluteIssue =
    params.has("from") && params.has("to")
      ? absoluteError(params.get("from")!, params.get("to")!)
      : null
  const fullWidget = dashboard.widgets.find((w) => w.id === fullscreen)
  const bodyProps = {
    preview: Boolean(draft),
    org,
    view,
    window,
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
      Math.max(
        1,
        Math.ceil((requiredHeight + GRID_MARGIN) / (ROW_HEIGHT + GRID_MARGIN)),
      ),
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
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-end gap-3">
          <Button asChild variant="outline" size="icon">
            <Link to={dashboardPath(org)} aria-label="All dashboards">
              <ArrowLeftIcon />
            </Link>
          </Button>
          <div className="w-full max-w-md">
            <SearchableSelect
              label="Dashboard"
              value={saved.uuid}
              selectedLabel={dashboard.name}
              options={(list.data ?? [saved])
                .filter((d) =>
                  d.name.toLowerCase().includes(switchSearch.toLowerCase()),
                )
                .map((d) => ({ value: d.uuid, label: d.name }))}
              search={switchSearch}
              onSearchChange={setSwitchSearch}
              onChange={(id) => navigate(dashboardPath(org, id))}
            />
          </div>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            {draft ? (
              <>
                <Button
                  variant="outline"
                  disabled={saving}
                  onClick={() => setAddOpen(true)}
                >
                  <PlusIcon data-icon="inline-start" />
                  Add widget
                </Button>
                <Button
                  variant="outline"
                  disabled={saving}
                  onClick={() => setSettingsOpen(true)}
                >
                  <Settings2Icon data-icon="inline-start" />
                  Dashboard settings
                </Button>
                <Button
                  variant="outline"
                  disabled={saving}
                  onClick={cancelEditing}
                >
                  Cancel editing
                </Button>
                <Button disabled={saving || !dirty} onClick={() => void save()}>
                  <SaveIcon data-icon="inline-start" />
                  {saving ? "Saving…" : "Save dashboard"}
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                onClick={() => {
                  setBase(saved)
                  setDraft(structuredClone(saved))
                  setError(null)
                }}
              >
                <PencilIcon data-icon="inline-start" />
                Edit dashboard
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{dashboard.name}</h1>
          <p className="text-sm text-muted-foreground">
            Organization-shared · {dashboard.widgets.length}{" "}
            {dashboard.widgets.length === 1 ? "panel" : "panels"}
          </p>
        </div>
        {draft && (
          <Badge variant="outline">
            {dirty ? "Unsaved changes" : "Editing"}
          </Badge>
        )}
      </div>
      <TimeControls
        view={view}
        onChange={updateView}
        onRefresh={() => {
          void cache.invalidateQueries({ queryKey: ["dashboard-latest", org] })
          void cache.invalidateQueries({ queryKey: ["dashboard-history", org] })
          void cache.invalidateQueries({ queryKey: ["dashboard-workflow-location", org] })
          void cache.invalidateQueries({ queryKey: ["dashboard-workflow-alerts", org] })
          void cache.invalidateQueries({
            queryKey: ["dashboard-state-history", org],
          })
        }}
      />
      {absoluteIssue && (
        <Alert>
          <AlertDescription>
            The URL time range is invalid: {absoluteIssue} Showing the saved
            dashboard default instead.
          </AlertDescription>
        </Alert>
      )}
      {draft && (
        <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
          <SheetContent className="data-[side=right]:w-full sm:data-[side=right]:max-w-md">
            <SheetHeader>
              <SheetTitle>Dashboard settings</SheetTitle>
              <SheetDescription>
                Changes stay in this draft until you save the dashboard.
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
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.target.value })
                  }
                />
              </Field>
              <Field>
                <FieldLabel>Current viewing settings</FieldLabel>
                <p className="text-sm text-muted-foreground">
                  {view.range.mode === "relative"
                    ? PRESET_LABELS[view.range.preset]
                    : "Fixed historical interval"}{" "}
                  · {view.timezone === "browser" ? "Browser time" : "UTC"} ·{" "}
                  {view.refresh ? `Refresh every ${view.refresh}s` : "Refresh off"}
                </p>
              </Field>
              <Field>
                <FieldLabel>Saved viewing defaults</FieldLabel>
                <p className="text-sm text-muted-foreground">
                  {draft.defaults.range.mode === "relative"
                    ? PRESET_LABELS[draft.defaults.range.preset]
                    : "Fixed historical interval"}{" "}
                  · {draft.defaults.timezone === "browser"
                    ? "Browser time"
                    : "UTC"}{" "}
                  ·{" "}
                  {draft.defaults.refresh
                    ? `Refresh every ${draft.defaults.refresh}s`
                    : "Refresh off"}
                </p>
                <Button
                  variant="outline"
                  disabled={saving}
                  onClick={() =>
                    setDraft({ ...draft, defaults: structuredClone(view) })
                  }
                >
                  Use current time settings as defaults
                </Button>
              </Field>
            </FieldGroup>
          </SheetContent>
        </Sheet>
      )}
      <RequestError error={error} />
      {error instanceof ApiError && error.status === 409 && (
        <Button variant="outline" onClick={() => setDiscard(true)}>
          Reload saved dashboard…
        </Button>
      )}
      {!dashboard.widgets.length ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Add your first panel</EmptyTitle>
            <EmptyDescription>
              Combine current parameter status with charts that explore history.
            </EmptyDescription>
          </EmptyHeader>
          {draft && (
            <Button onClick={() => setAddOpen(true)}>
              <PlusIcon data-icon="inline-start" />
              Add widget
            </Button>
          )}
        </Empty>
      ) : (
        <Grid
          className="dashboard-grid"
          layouts={gridLayouts as ResponsiveLayouts}
          breakpoints={BREAKPOINTS}
          cols={COLS}
          rowHeight={ROW_HEIGHT}
          margin={[GRID_MARGIN, GRID_MARGIN]}
          containerPadding={[0, 0]}
          isDraggable={Boolean(draft) && !saving}
          isResizable={Boolean(draft) && !saving}
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
          {dashboard.widgets.map((widget) => (
            <div key={widget.id}>
              <Card className="h-full overflow-hidden">
                <CardHeader className="flex flex-row items-start justify-between gap-2 pb-3">
                  <div className="min-w-0">
                    <CardTitle>
                      <span className="flex items-center gap-2">
                        {draft && (
                          <GripVerticalIcon
                            aria-label="Drag panel"
                            className="dashboard-drag-handle shrink-0 cursor-move text-muted-foreground"
                          />
                        )}
                        <span className="truncate" title={widget.title}>
                          {widget.title}
                        </span>
                      </span>
                    </CardTitle>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Panel menu: ${widget.title}`}
                      >
                        <MoreHorizontalIcon />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          onSelect={() => setFullscreen(widget.id)}
                        >
                          <MaximizeIcon />
                          View fullscreen
                        </DropdownMenuItem>
                        {draft && (
                          <>
                            <DropdownMenuItem
                              disabled={saving}
                              onSelect={() => setEditor(widget)}
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
                              onSelect={() =>
                                setDraft({
                                  ...draft,
                                  widgets: draft.widgets.filter(
                                    (w) => w.id !== widget.id,
                                  ),
                                  layouts: Object.fromEntries(
                                    Object.entries(draft.layouts).map(
                                      ([key, items]) => [
                                        key,
                                        items?.filter((i) => i.i !== widget.id),
                                      ],
                                    ),
                                  ),
                                })
                              }
                            >
                              <Trash2Icon />
                              Remove panel
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardHeader>
                <CardContent
                  ref={(node) => {
                    if (node) panelContent.current.set(widget.id, node)
                    else panelContent.current.delete(widget.id)
                  }}
                  className="min-h-0 flex-1 overflow-auto"
                >
                  <PanelBody {...bodyProps} widget={widget} />
                </CardContent>
              </Card>
            </div>
          ))}
        </Grid>
      )}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-h-[90svh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add widget</DialogTitle>
            <DialogDescription>
              Choose a panel connected to device parameters or a workflow.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {Object.entries(widgetRegistry).map(([type, definition]) => (
              <Card key={type}>
                <CardHeader>
                  <CardTitle>{definition.label}</CardTitle>
                  <CardDescription>{definition.description}</CardDescription>
                </CardHeader>
                <CardFooter>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setAddOpen(false)
                      setEditor(newWidget(type as DashboardWidget["type"]))
                    }}
                  >
                    Add {definition.label}
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      {editor && (
        <PanelEditor
          key={editor.id}
          initial={editor}
          {...bodyProps}
          onDirty={setEditorDirty}
          onClose={() => {
            setEditor(null)
            setEditorDirty(false)
          }}
          onApply={applyWidget}
        />
      )}
      <Dialog
        open={Boolean(fullWidget)}
        onOpenChange={(open) => !open && setFullscreen(null)}
      >
        <DialogContent className="flex h-[90svh] max-w-none flex-col sm:max-w-[95vw]">
          <DialogHeader>
            <DialogTitle>{fullWidget?.title}</DialogTitle>
            <DialogDescription>
              {fullWidget?.description || "Expanded panel view"}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto">
            {fullWidget && <PanelBody {...bodyProps} widget={fullWidget} />}
          </div>
        </DialogContent>
      </Dialog>
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
    </div>
  )
}
