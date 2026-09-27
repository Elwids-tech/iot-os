import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import type {
  DashboardSource,
  DashboardView,
  DashboardWidget,
} from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import { PageHeader } from "@iot-os/ui/components/page-header"
import { StatusMark } from "@iot-os/ui/components/status-mark"
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
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldLegend,
} from "@iot-os/ui/components/field"
import { Input } from "@iot-os/ui/components/input"
import { Textarea } from "@iot-os/ui/components/textarea"
import { Checkbox } from "@iot-os/ui/components/checkbox"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@iot-os/ui/components/toggle-group"
import { SearchableSelect } from "@iot-os/ui/components/searchable-select"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CopyIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"
import { api } from "../lib/api"
import { RequestError } from "../components/forms"
import {
  appliedParameters,
  COLORS,
  NEUTRAL,
  newWidget,
  numeric,
  PANEL_LABELS,
  PRESET_LABELS,
  profilePrecision,
  sourceKey,
  thresholdError,
  widgetError,
} from "./model"
import { useDevices } from "./panelData"
import { PanelBody, widgetRegistry } from "./registry"
import { writableParameters, controlSpec } from "../controls/model"
import { isColorParameter } from "../history/model"
import { WorkflowPicker } from "./WorkflowPanelEditor"

type Widget = DashboardWidget
type SetWidget = (update: (current: Widget) => Widget) => void
const THRESHOLD_TYPES: Widget["type"][] = ["status", "gauge", "timeseries", "table"]
const section = "flex flex-col gap-3"
const sectionHeading = "skin-label text-sm font-semibold"

/** Full-page panel editor. Apply changes the dashboard draft only; Save dashboard shares it. */
export function PanelEditor({
  initial,
  org,
  view,
  window,
  dashboardName,
  backTo,
  onApply,
  onCancel,
  onDirty,
}: {
  initial: Widget
  org: string
  view: DashboardView
  window: { from: string; to: string }
  dashboardName: string
  /** Dashboard URL in edit mode; Back returns there and keeps the draft. */
  backTo: string
  onApply: (widget: Widget) => void
  onCancel: () => void
  onDirty: (dirty: boolean) => void
}) {
  const [widget, setWidget] = useState(() => structuredClone(initial))
  const [selected, setSelected] = useState(0)
  const [simulationEnabled, setSimulationEnabled] = useState(false)
  const [sample, setSample] = useState(0)
  const dirty = JSON.stringify(widget) !== JSON.stringify(initial)
  useEffect(() => {
    onDirty(dirty)
    return () => onDirty(false)
  }, [dirty, onDirty])
  const definition = widgetRegistry[widget.type]
  const source = widget.config.sources[selected]
  const error = widgetError(widget)
  const devices = useDevices(org, source ? [source.device_uuid] : [])
  const profileDecimals = source
    ? profilePrecision(devices(source.device_uuid)?.data, source.parameter_uuid)
    : undefined
  const update: SetWidget = (next) => setWidget(next)
  function patchSource(patch: Partial<DashboardSource>) {
    setWidget((current) => ({
      ...current,
      config: {
        ...current.config,
        sources: current.config.sources.map((s, index) =>
          index === selected ? { ...s, ...patch } : s,
        ),
      },
    }))
  }
  function changeType(type: Widget["type"]) {
    setWidget((current) => {
      const next = newWidget(type)
      const keep =
        widgetRegistry[type].editor === "parameter-panel" &&
        widgetRegistry[current.type].editor === "parameter-panel"
      return {
        ...next,
        id: current.id,
        title:
          current.title === PANEL_LABELS[current.type] ? next.title : current.title,
        description: current.description,
        config: keep
          ? { ...next.config, sources: current.config.sources }
          : next.config,
      }
    })
    setSelected(0)
    setSimulationEnabled(false)
  }
  return (
    <>
      <PageHeader
        title={`Edit ${widget.title || "panel"}`}
        heading={`Edit ${definition.label} panel`}
        back={{ to: backTo, label: dashboardName }}
        meta={dirty ? <StatusMark tone="warning">Not applied</StatusMark> : null}
        actions={
          <>
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              disabled={Boolean(error)}
              onClick={() =>
                onApply({
                  ...widget,
                  title: widget.title.trim(),
                  config: {
                    ...widget.config,
                    sources: widget.config.sources.map((s) => ({
                      ...s,
                      thresholds: [...s.thresholds].sort((a, b) => a.value - b.value),
                    })),
                  },
                })
              }
            >
              Apply to dashboard
            </Button>
          </>
        }
      >
        <span className="text-xs text-muted-foreground" id="visualization-label">
          Visualization
        </span>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          aria-labelledby="visualization-label"
          className="flex-wrap"
          value={widget.type}
          onValueChange={(type) => type && changeType(type as Widget["type"])}
        >
          {(Object.keys(widgetRegistry) as Widget["type"][]).map((type) => (
            <ToggleGroupItem key={type} value={type}>
              {PANEL_LABELS[type]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </PageHeader>
      <div className="grid gap-6 p-4 md:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
        <div className="flex min-w-0 flex-col gap-6">
          {error && (
            <p role="status" className="text-sm text-muted-foreground">
              {error}
            </p>
          )}
          <section aria-labelledby="preview-heading" className={section}>
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 id="preview-heading" className={sectionHeading}>
                Preview
              </h2>
              <span className="text-xs text-muted-foreground">
                {simulationEnabled
                  ? "Simulation"
                  : definition.mode === "latest"
                    ? "Latest values"
                    : view.range.mode === "relative"
                      ? PRESET_LABELS[view.range.preset]
                      : "Fixed range"}
              </span>
            </div>
            <div className="flex h-96 flex-col border bg-card">
              <div className="border-b px-3 py-2">
                <p className="truncate text-sm font-medium">
                  {widget.title || "Untitled panel"}
                </p>
                {widget.description && (
                  <p className="truncate text-xs text-muted-foreground">
                    {widget.description}
                  </p>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-3">
                <PanelBody
                  preview
                  org={org}
                  widget={widget}
                  view={view}
                  window={window}
                  simulation={
                    simulationEnabled && source
                      ? { source: sourceKey(source), value: sample }
                      : undefined
                  }
                />
              </div>
            </div>
            {widget.type === "status" && source && numeric(source) && (
              <FieldGroup>
                <Field orientation="horizontal">
                  <Checkbox
                    id="simulate-panel"
                    checked={simulationEnabled}
                    onCheckedChange={(checked) =>
                      setSimulationEnabled(checked === true)
                    }
                  />
                  <FieldLabel htmlFor="simulate-panel">
                    Simulate a value for {source.label}
                  </FieldLabel>
                </Field>
                {simulationEnabled && (
                  <Field>
                    <FieldLabel htmlFor="simulation-value">
                      Sample value · simulation only
                    </FieldLabel>
                    <Input
                      id="simulation-value"
                      type="number"
                      step="any"
                      value={Number.isFinite(sample) ? sample : ""}
                      onChange={(e) =>
                        setSample(
                          e.target.value === "" ? NaN : Number(e.target.value),
                        )
                      }
                    />
                    <FieldDescription>
                      Only the preview changes. Real telemetry is never edited.
                    </FieldDescription>
                  </Field>
                )}
              </FieldGroup>
            )}
          </section>
          {definition.editor === "parameter-panel" && (
            <DataSection
              org={org}
              widget={widget}
              update={update}
              onSelect={setSelected}
            />
          )}
          {definition.editor === "devices" && (
            <DevicesSection org={org} widget={widget} update={update} />
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-6 lg:border-l lg:pl-6 [&>section+section]:border-t [&>section+section]:pt-6">
          <section aria-labelledby="panel-heading" className={section}>
            <h2 id="panel-heading" className={sectionHeading}>
              Panel
            </h2>
            <FieldGroup>
              <Field data-invalid={!widget.title.trim()}>
                <FieldLabel htmlFor="panel-title">Panel title</FieldLabel>
                <Input
                  id="panel-title"
                  value={widget.title}
                  maxLength={120}
                  aria-invalid={!widget.title.trim()}
                  onChange={(e) => setWidget({ ...widget, title: e.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="panel-description">Description</FieldLabel>
                <Textarea
                  id="panel-description"
                  value={widget.description}
                  maxLength={1000}
                  onChange={(e) =>
                    setWidget({ ...widget, description: e.target.value })
                  }
                />
              </Field>
              {widget.type === "text" && (
                <Field data-invalid={!widget.config.text?.trim()}>
                  <FieldLabel htmlFor="panel-text">Text</FieldLabel>
                  <Textarea
                    id="panel-text"
                    className="min-h-40"
                    value={widget.config.text ?? ""}
                    maxLength={4000}
                    aria-invalid={!widget.config.text?.trim()}
                    onChange={(e) =>
                      setWidget({
                        ...widget,
                        config: { ...widget.config, text: e.target.value },
                      })
                    }
                  />
                  <FieldDescription>Plain text, up to 4000 characters.</FieldDescription>
                </Field>
              )}
              {definition.editor === "workflow-panel" && (
                <WorkflowPicker
                  org={org}
                  widget={widget}
                  onChange={(workflow_uuid) =>
                    setWidget({ ...widget, config: { sources: [], workflow_uuid } })
                  }
                />
              )}
            </FieldGroup>
          </section>
          {definition.editor === "parameter-panel" && (
            <section aria-labelledby="display-heading" className={section}>
              <h2 id="display-heading" className={sectionHeading}>
                Display
              </h2>
              {widget.type === "gauge" && (
                <FieldGroup className="grid grid-cols-2 gap-3">
                  {(["min", "max"] as const).map((key) => (
                    <Field key={key} data-invalid={Boolean(error?.includes("maximum"))}>
                      <FieldLabel htmlFor={`gauge-${key}`}>
                        {key === "min" ? "Minimum" : "Maximum"}
                      </FieldLabel>
                      <Input
                        id={`gauge-${key}`}
                        type="number"
                        step="any"
                        value={
                          Number.isFinite(widget.config[key])
                            ? widget.config[key]
                            : ""
                        }
                        onChange={(e) =>
                          setWidget({
                            ...widget,
                            config: {
                              ...widget.config,
                              [key]: e.target.value === "" ? NaN : Number(e.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                  ))}
                </FieldGroup>
              )}
              {widget.type === "controls" && (
                <Field>
                  <FieldLabel>Cards per row</FieldLabel>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    value={String(widget.config.columns ?? 1)}
                    onValueChange={(value) => {
                      if (!value) return
                      setWidget({
                        ...widget,
                        config: {
                          ...widget.config,
                          columns:
                            value === "auto"
                              ? "auto"
                              : (Number(value) as 1 | 2 | 3 | 4),
                        },
                      })
                    }}
                    aria-label="Cards per row"
                    className="flex-wrap"
                  >
                    {["auto", "1", "2", "3", "4"].map((value) => (
                      <ToggleGroupItem key={value} value={value}>
                        {value === "auto" ? "Auto" : value}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  <FieldDescription>
                    Cards collapse to fewer columns when the panel is narrow.
                  </FieldDescription>
                </Field>
              )}
              <SourcePicker widget={widget} selected={selected} onSelect={(index) => {
                setSelected(index)
                setSimulationEnabled(false)
              }} />
              {source ? (
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="source-label">Display label</FieldLabel>
                    <Input
                      id="source-label"
                      value={source.label}
                      maxLength={120}
                      onChange={(e) => patchSource({ label: e.target.value })}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="source-unit">Profile unit</FieldLabel>
                    <Input id="source-unit" readOnly value={source.unit ?? "No unit"} />
                    <FieldDescription>
                      Set by the device profile; the dashboard never converts it.
                    </FieldDescription>
                  </Field>
                  {numeric(source) && widget.type !== "controls" && (
                    <Field>
                      <FieldLabel htmlFor="source-precision">Decimal places</FieldLabel>
                      <Input
                        id="source-precision"
                        type="number"
                        min={0}
                        max={10}
                        step={1}
                        placeholder={
                          profileDecimals === undefined
                            ? "Profile default"
                            : `Profile: ${profileDecimals}`
                        }
                        value={source.precision ?? ""}
                        onChange={(e) =>
                          patchSource({
                            precision:
                              e.target.value === "" ? null : Number(e.target.value),
                          })
                        }
                      />
                    </Field>
                  )}
                  {widget.type === "timeseries" && (
                    <Field>
                      <FieldLabel htmlFor="series-color">Series colour</FieldLabel>
                      <Input
                        id="series-color"
                        type="color"
                        value={source.color}
                        onChange={(e) => patchSource({ color: e.target.value })}
                      />
                    </Field>
                  )}
                </FieldGroup>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Add a parameter under Data first.
                </p>
              )}
            </section>
          )}
          {THRESHOLD_TYPES.includes(widget.type) && (
            <ThresholdsSection
              widget={widget}
              source={source}
              update={update}
              patchSource={patchSource}
            />
          )}
        </div>
      </div>
    </>
  )
}

function SourcePicker({
  widget,
  selected,
  onSelect,
}: {
  widget: Widget
  selected: number
  onSelect: (index: number) => void
}) {
  const [search, setSearch] = useState("")
  const source = widget.config.sources[selected]
  return (
    <SearchableSelect
      label="Configure parameter"
      value={source ? sourceKey(source) : ""}
      onChange={(key) =>
        onSelect(widget.config.sources.findIndex((s) => sourceKey(s) === key))
      }
      search={search}
      onSearchChange={setSearch}
      options={widget.config.sources
        .filter((s) =>
          `${s.label} ${s.device_name}`.toLowerCase().includes(search.toLowerCase()),
        )
        .map((s) => ({
          value: sourceKey(s),
          label: `${s.label} · ${s.device_name ?? "Device"}`,
        }))}
      disabled={!widget.config.sources.length}
    />
  )
}

/** Device and parameter pickers plus the ordered source list. */
function DataSection({
  org,
  widget,
  update,
  onSelect,
}: {
  org: string
  widget: Widget
  update: SetWidget
  onSelect: (index: number) => void
}) {
  const [deviceId, setDeviceId] = useState("")
  const [parameterId, setParameterId] = useState("")
  const [deviceSearch, setDeviceSearch] = useState("")
  const [parameterSearch, setParameterSearch] = useState("")
  const [page, setPage] = useState(1)
  const devices = useQuery({
    queryKey: ["dashboard-devices", org, deviceSearch, page],
    queryFn: () => api.devices(org, { search: deviceSearch, page }),
    staleTime: 10000,
  })
  const device = useQuery({
    queryKey: ["dashboard-device", org, deviceId],
    queryFn: () => api.device(org, deviceId),
    enabled: Boolean(deviceId),
    staleTime: 30000,
  })
  const parameters =
    widget.type === "controls"
      ? writableParameters(device.data).filter(
          (parameter) => controlSpec(parameter).kind !== "unsupported",
        )
      : appliedParameters(device.data)
  const limit = widget.type === "gauge" ? 4 : 100
  function addSource() {
    const parameter = parameters.find((p) => p.uuid === parameterId)
    if (!parameter || !device.data) return
    const next: DashboardSource = {
      device_uuid: deviceId,
      parameter_uuid: parameter.uuid,
      device_name: device.data.name,
      label: parameter.label,
      unit: parameter.unit,
      data_type: parameter.data_type,
      format: parameter.format,
      display_widget:
        typeof parameter.display?.widget === "string"
          ? parameter.display.widget
          : null,
      precision: null,
      color: COLORS[widget.config.sources.length % COLORS.length],
      base: { ...NEUTRAL },
      thresholds: [],
    }
    if (widget.config.sources.some((s) => sourceKey(s) === sourceKey(next)))
      return
    onSelect(widget.config.sources.length)
    update((current) => ({
      ...current,
      config: { ...current.config, sources: [...current.config.sources, next] },
    }))
    setParameterId("")
    setParameterSearch("")
  }
  function move(index: number, direction: number) {
    const sources = [...widget.config.sources]
    ;[sources[index], sources[index + direction]] = [
      sources[index + direction],
      sources[index],
    ]
    update((current) => ({ ...current, config: { ...current.config, sources } }))
    onSelect(index + direction)
  }
  return (
    <section aria-labelledby="data-heading" className={section}>
      <h2 id="data-heading" className={sectionHeading}>
        Data
      </h2>
      <FieldGroup className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <SearchableSelect
          label="Device"
          value={deviceId}
          onChange={(id) => {
            setDeviceId(id)
            setParameterId("")
            setParameterSearch("")
          }}
          search={deviceSearch}
          onSearchChange={(search) => {
            setDeviceSearch(search)
            setPage(1)
          }}
          options={(devices.data?.data ?? []).map((d) => ({
            value: d.uuid,
            label: d.name,
          }))}
          loading={devices.isFetching}
          page={page}
          hasNextPage={page < (devices.data?.meta.last_page ?? 1)}
          onPageChange={setPage}
        />
        <SearchableSelect
          label="Parameter"
          value={parameterId}
          onChange={setParameterId}
          search={parameterSearch}
          onSearchChange={setParameterSearch}
          disabled={!deviceId}
          options={parameters
            .filter(
              (p) =>
                (!["timeseries", "gauge"].includes(widget.type) ||
                  ["number", "integer"].includes(p.data_type)) &&
                (widget.type !== "state_history" ||
                  ["boolean", "enum"].includes(p.data_type)) &&
                (widget.type !== "color_history" || isColorParameter(p)) &&
                `${p.label} ${p.key} ${p.unit ?? ""}`
                  .toLowerCase()
                  .includes(parameterSearch.toLowerCase()),
            )
            .map((p) => ({
              value: p.uuid,
              label: `${p.label} · ${p.key}${p.unit ? " · " + p.unit : ""}`,
            }))}
          loading={Boolean(deviceId) && device.isPending}
          emptyText="No matching applied parameters."
        />
        <Button
          type="button"
          variant="outline"
          disabled={
            !parameterId ||
            widget.config.sources.length >= limit ||
            widget.config.sources.some(
              (s) => s.device_uuid === deviceId && s.parameter_uuid === parameterId,
            )
          }
          onClick={addSource}
        >
          <PlusIcon data-icon="inline-start" />
          Add parameter
        </Button>
      </FieldGroup>
      <p className="text-xs text-muted-foreground">
        Parameters come from the applied profile, even before their first reading.
        {widget.type === "gauge" && " A gauge shows up to 4."}
      </p>
      <RequestError error={devices.error ?? device.error} />
      {widget.config.sources.length > 0 && (
        <ul aria-label="Panel parameters" className="flex flex-col border-t">
          {widget.config.sources.map((s, index) => (
            <li
              key={sourceKey(s)}
              className="flex min-h-(--row-h) items-center gap-2 border-b py-1"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{s.label}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {s.device_name} · {s.unit ?? "No unit"}
                </p>
              </div>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Move ${s.label} up`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUpIcon />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Move ${s.label} down`}
                disabled={index === widget.config.sources.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDownIcon />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Remove ${s.label}`}
                onClick={() => {
                  update((current) => ({
                    ...current,
                    config: {
                      ...current.config,
                      sources: current.config.sources.filter((_, i) => i !== index),
                    },
                  }))
                  onSelect(0)
                }}
              >
                <Trash2Icon />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Device health panels list devices, not parameters. */
function DevicesSection({
  org,
  widget,
  update,
}: {
  org: string
  widget: Widget
  update: SetWidget
}) {
  const [deviceId, setDeviceId] = useState("")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const devices = useQuery({
    queryKey: ["dashboard-devices", org, search, page],
    queryFn: () => api.devices(org, { search, page }),
    staleTime: 10000,
  })
  const chosen = widget.config.devices ?? []
  const option = devices.data?.data.find((d) => d.uuid === deviceId)
  return (
    <section aria-labelledby="devices-heading" className={section}>
      <h2 id="devices-heading" className={sectionHeading}>
        Devices
      </h2>
      <FieldGroup className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
        <SearchableSelect
          label="Device"
          value={deviceId}
          onChange={setDeviceId}
          search={search}
          onSearchChange={(value) => {
            setSearch(value)
            setPage(1)
          }}
          options={(devices.data?.data ?? []).map((d) => ({
            value: d.uuid,
            label: d.name,
          }))}
          loading={devices.isFetching}
          page={page}
          hasNextPage={page < (devices.data?.meta.last_page ?? 1)}
          onPageChange={setPage}
        />
        <Button
          type="button"
          variant="outline"
          disabled={
            !option ||
            chosen.length >= 50 ||
            chosen.some((d) => d.device_uuid === deviceId)
          }
          onClick={() => {
            if (!option) return
            update((current) => ({
              ...current,
              config: {
                ...current.config,
                devices: [
                  ...(current.config.devices ?? []),
                  { device_uuid: option.uuid, device_name: option.name },
                ],
              },
            }))
            setDeviceId("")
          }}
        >
          <PlusIcon data-icon="inline-start" />
          Add device
        </Button>
      </FieldGroup>
      <RequestError error={devices.error} />
      {chosen.length > 0 && (
        <ul aria-label="Panel devices" className="flex flex-col border-t">
          {chosen.map((d) => (
            <li
              key={d.device_uuid}
              className="flex h-(--row-h) items-center gap-2 border-b text-sm"
            >
              <span className="min-w-0 flex-1 truncate">
                {d.device_name ?? "Device"}
              </span>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Remove ${d.device_name ?? "device"}`}
                onClick={() =>
                  update((current) => ({
                    ...current,
                    config: {
                      ...current.config,
                      devices: (current.config.devices ?? []).filter(
                        (item) => item.device_uuid !== d.device_uuid,
                      ),
                    },
                  }))
                }
              >
                <Trash2Icon />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ThresholdsSection({
  widget,
  source,
  update,
  patchSource,
}: {
  widget: Widget
  source?: DashboardSource
  update: SetWidget
  patchSource: (patch: Partial<DashboardSource>) => void
}) {
  const [copyOpen, setCopyOpen] = useState(false)
  const [targets, setTargets] = useState<string[]>([])
  const issue = source ? thresholdError(source) : null
  return (
    <section aria-labelledby="thresholds-heading" className={section}>
      <h2 id="thresholds-heading" className={sectionHeading}>
        Thresholds
      </h2>
      {source && numeric(source) ? (
        <FieldGroup>
          <FieldDescription>
            Rules for {source.label} only. Lower bounds are inclusive. Colours
            are display rules, not alarms.
          </FieldDescription>
          <FieldSet>
            <FieldLegend>Base band</FieldLegend>
            <FieldDescription>
              {source.thresholds.some((t) => Number.isFinite(t.value))
                ? `Values below ${Math.min(...source.thresholds.map((t) => t.value).filter(Number.isFinite))}`
                : "All values until a threshold is added"}
            </FieldDescription>
            <FieldGroup className="grid grid-cols-[1fr_5rem] gap-3">
              <Field>
                <FieldLabel htmlFor="base-label">Label</FieldLabel>
                <Input
                  id="base-label"
                  maxLength={80}
                  value={source.base.label}
                  onChange={(e) =>
                    patchSource({ base: { ...source.base, label: e.target.value } })
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="base-color">Colour</FieldLabel>
                <Input
                  id="base-color"
                  type="color"
                  value={source.base.color}
                  onChange={(e) =>
                    patchSource({ base: { ...source.base, color: e.target.value } })
                  }
                />
              </Field>
            </FieldGroup>
          </FieldSet>
          {source.thresholds.map((rule, index) => {
            const next = source.thresholds
              .filter((t) => t.value > rule.value)
              .sort((a, b) => a.value - b.value)[0]
            const patchRule = (patch: Partial<typeof rule>) =>
              patchSource({
                thresholds: source.thresholds.map((t, i) =>
                  i === index ? { ...t, ...patch } : t,
                ),
              })
            return (
              <FieldSet key={index} className="border-t pt-3">
                <FieldLegend>Band {index + 1}</FieldLegend>
                <FieldDescription>
                  {Number.isFinite(rule.value)
                    ? `${rule.value} ≤ value${next ? ` < ${next.value}` : ", no upper limit"}`
                    : "Enter a boundary"}
                </FieldDescription>
                <FieldGroup className="grid grid-cols-[1fr_1fr_4rem] gap-2">
                  <Field data-invalid={Boolean(issue)}>
                    <FieldLabel htmlFor={`threshold-${index}`}>From</FieldLabel>
                    <Input
                      id={`threshold-${index}`}
                      type="number"
                      step="any"
                      value={Number.isFinite(rule.value) ? rule.value : ""}
                      aria-invalid={Boolean(issue)}
                      onChange={(e) =>
                        patchRule({
                          value: e.target.value === "" ? NaN : Number(e.target.value),
                        })
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`threshold-label-${index}`}>Label</FieldLabel>
                    <Input
                      id={`threshold-label-${index}`}
                      value={rule.label}
                      maxLength={80}
                      onChange={(e) => patchRule({ label: e.target.value })}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`threshold-color-${index}`}>Colour</FieldLabel>
                    <Input
                      id={`threshold-color-${index}`}
                      type="color"
                      value={rule.color}
                      onChange={(e) => patchRule({ color: e.target.value })}
                    />
                  </Field>
                </FieldGroup>
                <Button
                  variant="ghost"
                  size="sm"
                  className="self-start"
                  onClick={() =>
                    patchSource({
                      thresholds: source.thresholds.filter((_, i) => i !== index),
                    })
                  }
                >
                  <Trash2Icon data-icon="inline-start" />
                  Remove band {index + 1}
                </Button>
              </FieldSet>
            )
          })}
          {issue && (
            <p role="alert" className="text-sm text-destructive">
              {issue}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={source.thresholds.length >= 100}
              onClick={() =>
                patchSource({
                  thresholds: [
                    ...source.thresholds,
                    {
                      value: NaN,
                      label: `Band ${source.thresholds.length + 1}`,
                      color: COLORS[source.thresholds.length % COLORS.length],
                    },
                  ],
                })
              }
            >
              <PlusIcon data-icon="inline-start" />
              Add threshold
            </Button>
            <Button
              variant="outline"
              disabled={
                Boolean(issue) || widget.config.sources.filter(numeric).length < 2
              }
              onClick={() => {
                setTargets([])
                setCopyOpen(true)
              }}
            >
              <CopyIcon data-icon="inline-start" />
              Copy thresholds
            </Button>
          </div>
        </FieldGroup>
      ) : (
        <p className="text-sm text-muted-foreground">
          Choose a numeric parameter to set threshold bands.
        </p>
      )}
      <AlertDialog open={copyOpen} onOpenChange={setCopyOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Copy thresholds from {source?.label}</AlertDialogTitle>
            <AlertDialogDescription>
              Replace the Base band and all threshold rules on the selected
              parameters in this draft. Check the target units before copying.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <FieldSet>
            <FieldLegend>Destination parameters</FieldLegend>
            <FieldGroup>
              {widget.config.sources
                .filter(
                  (s) => numeric(s) && sourceKey(s) !== (source && sourceKey(source)),
                )
                .map((s) => (
                  <Field key={sourceKey(s)} orientation="horizontal">
                    <Checkbox
                      id={`copy-${s.parameter_uuid}-${s.device_uuid}`}
                      checked={targets.includes(sourceKey(s))}
                      onCheckedChange={(checked) =>
                        setTargets(
                          checked
                            ? [...targets, sourceKey(s)]
                            : targets.filter((id) => id !== sourceKey(s)),
                        )
                      }
                    />
                    <FieldLabel htmlFor={`copy-${s.parameter_uuid}-${s.device_uuid}`}>
                      {s.label} · {s.unit ?? "No unit"}
                    </FieldLabel>
                  </Field>
                ))}
            </FieldGroup>
          </FieldSet>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              disabled={!targets.length}
              onClick={() => {
                if (source)
                  update((current) => ({
                    ...current,
                    config: {
                      ...current.config,
                      sources: current.config.sources.map((s) =>
                        targets.includes(sourceKey(s))
                          ? {
                              ...s,
                              base: { ...source.base },
                              thresholds: source.thresholds.map((t) => ({ ...t })),
                            }
                          : s,
                      ),
                    },
                  }))
                setCopyOpen(false)
              }}
            >
              Replace selected thresholds
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
