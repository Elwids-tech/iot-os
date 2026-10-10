import { useMemo, useState } from "react"
import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import type { DashboardView, DashboardWidget, DeviceProfileParameter } from "@iot-os/api-client"
import { Badge } from "@iot-os/ui/components/badge"
import { Button } from "@iot-os/ui/components/button"
import { Checkbox } from "@iot-os/ui/components/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@iot-os/ui/components/dialog"
import { Input } from "@iot-os/ui/components/input"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { ChevronDownIcon, ChevronRightIcon, XIcon } from "lucide-react"
import { api } from "../lib/api"
import { RequestError } from "../components/forms"
import { writableParameters } from "../controls/model"
import { appliedParameters, PANEL_LABELS } from "./model"
import { useLatest } from "./panelData"
import { PANEL_ICONS } from "./icons"
import { formatReading } from "./ReadoutPanels"
import { PanelBody, widgetRegistry } from "./registry"
import { VisualizationPicker } from "./VisualizationPicker"
import { OTHER_PANELS, panelFor, suggestPanels, type Candidate, type PanelType } from "./suggest"

const key = (c: Pick<Candidate, "device" | "parameter">) => `${c.device.uuid}:${c.parameter.uuid}`

/**
 * Data first: choose device parameters, then pick from suggestions drawn with
 * that data. The profile decides what fits; the editor stays one click away.
 */
export function AddPanelDialog({
  open,
  onOpenChange,
  org,
  view,
  window,
  initial = [],
  onAdd,
  onCustomize,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  org: string
  view: DashboardView
  window: { from: string; to: string }
  /** Parameters to start with, for example from a device page. */
  initial?: Candidate[]
  onAdd: (widget: DashboardWidget) => void
  onCustomize: (widget: DashboardWidget) => void
}) {
  const [selected, setSelected] = useState<Map<string, Candidate>>(() => new Map(initial.map((c) => [key(c), c])))
  const candidates = [...selected.values()]
  const suggestions = suggestPanels(candidates).slice(0, 3)
  function toggle(candidate: Candidate) {
    setSelected((current) => {
      const next = new Map(current)
      if (next.has(key(candidate))) next.delete(key(candidate))
      else next.set(key(candidate), candidate)
      return next
    })
  }
  const close = () => {
    onOpenChange(false)
    setSelected(new Map())
  }
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="flex max-h-[92svh] flex-col gap-4 sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Add panel</DialogTitle>
          <DialogDescription>
            Choose what to show. Suggestions use each parameter's profile: its type, unit, range and states.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 gap-4 overflow-auto md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] md:overflow-hidden">
          <ParameterPicker org={org} view={view} selected={selected} onToggle={toggle} />
          <section aria-label="Suggested panels" className="flex min-h-0 flex-col gap-3 md:overflow-auto">
            {candidates.length > 0 && (
              <ul aria-label="Selected parameters" className="flex flex-wrap gap-1.5">
                {candidates.map((c) => (
                  <li key={key(c)}>
                    <Badge variant="secondary" className="gap-1 pr-1">
                      {c.parameter.label}
                      <span className="text-muted-foreground">· {c.device.name}</span>
                      <button
                        type="button"
                        className="rounded-sm p-0.5 hover:bg-accent"
                        aria-label={`Remove ${c.parameter.label}`}
                        onClick={() => toggle(c)}
                      >
                        <XIcon className="size-3" />
                      </button>
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
            {candidates.length === 0 ? (
              <div className="flex flex-col gap-2 rounded-md border border-dashed p-6 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">Choose one or more parameters</p>
                <p>Select parameters on the left to see panels drawn with their current data.</p>
              </div>
            ) : (
              <div className="grid gap-3 lg:grid-cols-3">
                {suggestions.map((suggestion, index) => {
                  const panel = panelFor(suggestion.type, candidates)
                  const Icon = PANEL_ICONS[suggestion.type]
                  return (
                    <article
                      key={suggestion.type}
                      aria-label={`${PANEL_LABELS[suggestion.type]} suggestion`}
                      className={`flex min-w-0 flex-col gap-2 rounded-md border bg-card p-3 ${index === 0 ? "ring-1 ring-primary" : ""}`}
                    >
                      <div className="flex items-center gap-2">
                        <Icon className="size-4 text-muted-foreground" />
                        <span className="font-medium">{PANEL_LABELS[suggestion.type]}</span>
                        {index === 0 && <Badge className="ml-auto">Best fit</Badge>}
                      </div>
                      <div className="pointer-events-none h-44 overflow-hidden rounded-sm border bg-background p-2" aria-hidden>
                        <PanelBody preview org={org} widget={panel} view={view} window={window} />
                      </div>
                      <p className="text-xs text-muted-foreground">{suggestion.reason}</p>
                      <div className="mt-auto flex flex-wrap gap-2">
                        <Button size="sm" onClick={() => { onAdd(panel); close() }}>
                          Add panel
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => { onCustomize(panel); close() }}>
                          Customize
                        </Button>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
            <div className="flex flex-col gap-2 border-t pt-3">
              {candidates.length > 0 && (
                <div className="max-w-sm">
                  <VisualizationPicker
                    value={suggestions[0]?.type ?? "status"}
                    candidates={candidates}
                    onChange={(type: PanelType) => {
                      onCustomize(panelFor(type, OTHER_PANELS.includes(type) ? [] : candidates))
                      close()
                    }}
                  />
                </div>
              )}
              <p className="text-xs text-muted-foreground">Panels without device parameters</p>
              <div className="flex flex-wrap gap-2">
                {OTHER_PANELS.map((type) => {
                  const Icon = PANEL_ICONS[type]
                  return (
                    <Button
                      key={type}
                      size="sm"
                      variant="outline"
                      title={widgetRegistry[type].description}
                      onClick={() => { onCustomize(panelFor(type, [])); close() }}
                    >
                      <Icon data-icon="inline-start" />
                      {PANEL_LABELS[type]}
                    </Button>
                  )
                })}
              </div>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Searchable devices; expanding one lists its profile parameters with current values. */
function ParameterPicker({
  org,
  view,
  selected,
  onToggle,
}: {
  org: string
  view: DashboardView
  selected: Map<string, Candidate>
  onToggle: (candidate: Candidate) => void
}) {
  const [search, setSearch] = useState("")
  const [expanded, setExpanded] = useState<string | null>(null)
  const devices = useInfiniteQuery({
    queryKey: ["dashboard-device-pages", org, search],
    queryFn: ({ pageParam }) => api.devices(org, { search, page: pageParam, per_page: 50 }),
    initialPageParam: 1,
    getNextPageParam: ({ meta }) => (meta.current_page < meta.last_page ? meta.current_page + 1 : undefined),
    staleTime: 10000,
  })
  const list = devices.data?.pages.flatMap((page) => page.data) ?? []
  return (
    <section aria-label="Device parameters" className="flex min-h-0 flex-col gap-2 rounded-md border bg-card p-2 md:overflow-hidden">
      <Input
        aria-label="Search devices"
        placeholder="Search devices"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <RequestError error={devices.error} />
      <ul className="flex min-h-0 flex-col gap-0.5 overflow-auto" aria-busy={devices.isFetching}>
        {devices.isPending
          ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)
          : list.map((device) => (
              <li key={device.uuid}>
                <button
                  type="button"
                  aria-expanded={expanded === device.uuid}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                  onClick={() => setExpanded((current) => (current === device.uuid ? null : device.uuid))}
                >
                  {expanded === device.uuid ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />}
                  <span className="min-w-0 flex-1 truncate font-medium">{device.name}</span>
                  {device.profile && <span className="truncate text-xs text-muted-foreground">{device.profile.name}</span>}
                </button>
                {expanded === device.uuid && (
                  <DeviceParameters org={org} view={view} device={device} selected={selected} onToggle={onToggle} />
                )}
              </li>
            ))}
        {devices.data && !list.length && (
          <li className="p-2 text-sm text-muted-foreground">No devices match.</li>
        )}
        {devices.hasNextPage && (
          <li>
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              disabled={devices.isFetchingNextPage}
              onClick={() => void devices.fetchNextPage()}
            >
              {devices.isFetchingNextPage ? "Loading…" : "Show more devices"}
            </Button>
          </li>
        )}
      </ul>
    </section>
  )
}

function DeviceParameters({
  org,
  view,
  device,
  selected,
  onToggle,
}: {
  org: string
  view: DashboardView
  device: { uuid: string; name: string }
  selected: Map<string, Candidate>
  onToggle: (candidate: Candidate) => void
}) {
  const detail = useQuery({
    queryKey: ["dashboard-device", org, device.uuid],
    queryFn: () => api.device(org, device.uuid),
    staleTime: 30000,
  })
  const latest = useLatest(org, [device.uuid], view.refresh)(device.uuid)
  const writable = useMemo(() => new Set(writableParameters(detail.data).map((p) => p.uuid)), [detail.data])
  const parameters: DeviceProfileParameter[] = appliedParameters(detail.data)
  if (detail.isPending) return <Skeleton className="ml-6 h-16" />
  if (!parameters.length)
    return <p className="ml-6 p-2 text-xs text-muted-foreground">No applied profile parameters yet.</p>
  return (
    <ul aria-label={`${device.name} parameters`} className="ml-4 flex flex-col border-l pl-2">
      {parameters.map((parameter) => {
        const candidate: Candidate = { device, parameter, writable: writable.has(parameter.uuid) }
        const id = `parameter-${device.uuid}-${parameter.uuid}`
        const reading = latest?.data?.data.find((m) => m.parameter_uuid === parameter.uuid)
        return (
          <li key={parameter.uuid} className="flex items-center gap-2 rounded-sm px-1 py-1 hover:bg-accent/60">
            <Checkbox id={id} checked={selected.has(key(candidate))} onCheckedChange={() => onToggle(candidate)} />
            <label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer flex-col">
              <span className="truncate text-sm">{parameter.label}</span>
              <span className="truncate font-mono text-xs text-muted-foreground">
                {[parameter.kind, parameter.unit].filter(Boolean).join(" · ")}
              </span>
            </label>
            {reading && reading.value !== null && reading.value !== undefined && (
              <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                {formatReading(reading.value, typeof parameter.display?.precision === "number" ? parameter.display.precision : undefined)}
                {parameter.unit ? ` ${parameter.unit}` : ""}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
