import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import type {
  DashboardSource,
  DashboardView,
  DashboardWidget,
} from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@iot-os/ui/components/card"
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
import { Badge } from "@iot-os/ui/components/badge"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@iot-os/ui/components/tabs"
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
  numeric,
  sourceKey,
  thresholdError,
  widgetError,
} from "./model"
import { PanelBody, widgetRegistry } from "./registry"
import { writableParameters, controlSpec } from "../controls/model"

export function PanelEditor({
  initial,
  org,
  view,
  window,
  refreshToken,
  onApply,
  onClose,
  onDirty,
}: {
  initial: DashboardWidget
  org: string
  view: DashboardView
  window: { from: string; to: string }
  refreshToken: number
  onApply: (widget: DashboardWidget) => void
  onClose: () => void
  onDirty: (dirty: boolean) => void
}) {
  const [widget, setWidget] = useState(() => structuredClone(initial))
  const [tab, setTab] = useState(
    initial.config.sources.length ? "panel" : "data",
  )
  const [deviceId, setDeviceId] = useState("")
  const [parameterId, setParameterId] = useState("")
  const [deviceSearch, setDeviceSearch] = useState("")
  const [parameterSearch, setParameterSearch] = useState("")
  const [sourceSearch, setSourceSearch] = useState("")
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState(0)
  const [simulationEnabled, setSimulationEnabled] = useState(false)
  const [sample, setSample] = useState(0)
  const [copyOpen, setCopyOpen] = useState(false)
  const [targets, setTargets] = useState<string[]>([])
  const [discardOpen, setDiscardOpen] = useState(false)
  const dirty = JSON.stringify(widget) !== JSON.stringify(initial)
  useEffect(() => {
    onDirty(dirty)
    return () => onDirty(false)
  }, [dirty, onDirty])
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
  const source = widget.config.sources[selected]
  const error = widgetError(widget)
  function patchSource(patch: Partial<DashboardSource>) {
    setWidget((current) => ({
      ...current,
      config: {
        sources: current.config.sources.map((s, index) =>
          index === selected ? { ...s, ...patch } : s,
        ),
      },
    }))
  }
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
      precision: null,
      color: COLORS[widget.config.sources.length % COLORS.length],
      base: { ...NEUTRAL },
      thresholds: [],
    }
    if (widget.config.sources.some((s) => sourceKey(s) === sourceKey(next)))
      return
    setSelected(widget.config.sources.length)
    setWidget({
      ...widget,
      config: { sources: [...widget.config.sources, next] },
    })
    setParameterId("")
    setParameterSearch("")
  }
  function move(index: number, direction: number) {
    const sources = [...widget.config.sources]
    ;[sources[index], sources[index + direction]] = [
      sources[index + direction],
      sources[index],
    ]
    setWidget({ ...widget, config: { sources } })
    setSelected(index + direction)
  }
  function close() {
    if (dirty) setDiscardOpen(true)
    else onClose()
  }
  const issue = source ? thresholdError(source) : null
  return (
    <>
      <Dialog open onOpenChange={(next) => !next && close()}>
        <DialogContent
          className="flex h-[94svh] w-[calc(100vw-2rem)] max-w-none flex-col sm:max-w-[90rem]"
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>
              Edit {widgetRegistry[widget.type].label} panel
            </DialogTitle>
            <DialogDescription>
              Preview changes, apply them to your draft, then Save dashboard to
              share them.
            </DialogDescription>
          </DialogHeader>
          <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:overflow-hidden">
            <div className="flex min-w-0 flex-col gap-3 lg:overflow-y-auto">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium">Preview</h3>
                <Badge variant="outline">
                  {simulationEnabled
                    ? "Simulation"
                    : widgetRegistry[widget.type].mode === "latest"
                      ? "Latest"
                      : "Selected time range"}
                </Badge>
              </div>
              <Card className="min-h-72">
                <CardHeader>
                  <CardTitle>{widget.title || "Untitled panel"}</CardTitle>
                  {widget.description && (
                    <CardDescription>{widget.description}</CardDescription>
                  )}
                </CardHeader>
                <CardContent className="min-h-0 flex-1">
                  <PanelBody
                    preview
                    org={org}
                    widget={widget}
                    view={view}
                    window={window}
                    refreshToken={refreshToken}
                    simulation={
                      simulationEnabled && source
                        ? { source: sourceKey(source), value: sample }
                        : undefined
                    }
                  />
                </CardContent>
              </Card>
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
                            e.target.value === ""
                              ? NaN
                              : Number(e.target.value),
                          )
                        }
                      />
                      <FieldDescription>
                        Only the preview changes. Real telemetry is never
                        edited.
                      </FieldDescription>
                    </Field>
                  )}
                </FieldGroup>
              )}
            </div>
            <Tabs
              value={tab}
              onValueChange={setTab}
              className="min-w-0 lg:overflow-hidden"
            >
              <TabsList className="w-full shrink-0">
                <TabsTrigger value="panel">Panel</TabsTrigger>
                <TabsTrigger value="data">Data</TabsTrigger>
                <TabsTrigger value="display">Display</TabsTrigger>
                {widget.type === "status" && (
                  <TabsTrigger value="thresholds">Thresholds</TabsTrigger>
                )}
              </TabsList>
              <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
                <TabsContent value="panel">
                  <FieldGroup>
                    <Field data-invalid={!widget.title.trim()}>
                      <FieldLabel htmlFor="panel-title">Panel title</FieldLabel>
                      <Input
                        id="panel-title"
                        value={widget.title}
                        maxLength={120}
                        aria-invalid={!widget.title.trim()}
                        onChange={(e) =>
                          setWidget({ ...widget, title: e.target.value })
                        }
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="panel-description">
                        Description
                      </FieldLabel>
                      <Textarea
                        id="panel-description"
                        value={widget.description}
                        maxLength={1000}
                        onChange={(e) =>
                          setWidget({ ...widget, description: e.target.value })
                        }
                      />
                      <FieldDescription>
                        Explain what operators should look for.
                      </FieldDescription>
                    </Field>
                  </FieldGroup>
                </TabsContent>
                <TabsContent value="data">
                  <FieldGroup>
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
                            (widget.type !== "timeseries" ||
                              ["number", "integer"].includes(p.data_type)) &&
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
                      help="Parameters come from the applied profile, even before their first reading."
                    />
                    <RequestError error={devices.error ?? device.error} />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={
                        !parameterId ||
                        widget.config.sources.some(
                          (s) =>
                            s.device_uuid === deviceId &&
                            s.parameter_uuid === parameterId,
                        )
                      }
                      onClick={addSource}
                    >
                      <PlusIcon data-icon="inline-start" />
                      Add parameter
                    </Button>
                    <FieldSet>
                      <FieldLegend>
                        Panel parameters ({widget.config.sources.length})
                      </FieldLegend>
                      <FieldDescription>
                        Reorder cards or series here. Configure labels,
                        precision, and colours in Display.
                      </FieldDescription>
                      {widget.config.sources.map((s, index) => (
                        <div
                          key={sourceKey(s)}
                          className="flex items-center gap-2 rounded-md border p-3"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              {s.label}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {s.device_name} · {s.unit ?? "No unit"}
                            </p>
                          </div>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Move ${s.label} up`}
                            disabled={index === 0}
                            onClick={() => move(index, -1)}
                          >
                            <ArrowUpIcon />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Move ${s.label} down`}
                            disabled={
                              index === widget.config.sources.length - 1
                            }
                            onClick={() => move(index, 1)}
                          >
                            <ArrowDownIcon />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Remove ${s.label}`}
                            onClick={() => {
                              setWidget({
                                ...widget,
                                config: {
                                  sources: widget.config.sources.filter(
                                    (_, i) => i !== index,
                                  ),
                                },
                              })
                              setSelected(0)
                            }}
                          >
                            <Trash2Icon />
                          </Button>
                        </div>
                      ))}
                    </FieldSet>
                  </FieldGroup>
                </TabsContent>
                {(tab === "display" || tab === "thresholds") && (
                  <div className="mt-3">
                    <SearchableSelect
                      label="Configure parameter"
                      value={source ? sourceKey(source) : ""}
                      onChange={(key) => {
                        setSelected(
                          widget.config.sources.findIndex(
                            (s) => sourceKey(s) === key,
                          ),
                        )
                        setSimulationEnabled(false)
                      }}
                      search={sourceSearch}
                      onSearchChange={setSourceSearch}
                      options={widget.config.sources
                        .filter((s) =>
                          `${s.label} ${s.device_name}`
                            .toLowerCase()
                            .includes(sourceSearch.toLowerCase()),
                        )
                        .map((s) => ({
                          value: sourceKey(s),
                          label: `${s.label} · ${s.device_name ?? "Device"}`,
                        }))}
                      disabled={!widget.config.sources.length}
                    />
                  </div>
                )}
                <TabsContent value="display">
                  {source ? (
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor="source-label">
                          Display label
                        </FieldLabel>
                        <Input
                          id="source-label"
                          value={source.label}
                          maxLength={120}
                          onChange={(e) =>
                            patchSource({ label: e.target.value })
                          }
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="source-unit">
                          Profile unit
                        </FieldLabel>
                        <Input
                          id="source-unit"
                          readOnly
                          value={source.unit ?? "No unit"}
                        />
                        <FieldDescription>
                          Units are defined by the device profile, not converted
                          by the dashboard.
                        </FieldDescription>
                      </Field>
                      {numeric(source) && widget.type !== "controls" && (
                        <Field>
                          <FieldLabel htmlFor="source-precision">
                            Decimal places
                          </FieldLabel>
                          <Input
                            id="source-precision"
                            type="number"
                            min={0}
                            max={10}
                            step={1}
                            placeholder="Automatic"
                            value={source.precision ?? ""}
                            onChange={(e) =>
                              patchSource({
                                precision:
                                  e.target.value === ""
                                    ? null
                                    : Number(e.target.value),
                              })
                            }
                          />
                        </Field>
                      )}
                      {widget.type === "timeseries" && (
                        <Field>
                          <FieldLabel htmlFor="series-color">
                            Series colour
                          </FieldLabel>
                          <Input
                            id="series-color"
                            type="color"
                            value={source.color}
                            onChange={(e) =>
                              patchSource({ color: e.target.value })
                            }
                          />
                        </Field>
                      )}
                    </FieldGroup>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Add a parameter in Data first.
                    </p>
                  )}
                </TabsContent>
                <TabsContent value="thresholds">
                  {source && numeric(source) ? (
                    <FieldGroup>
                      <FieldDescription>
                        These rules affect only {source.label}. Lower boundaries
                        are inclusive; each band ends just before the next
                        boundary. Colours are display rules, not alarms.
                      </FieldDescription>
                      <FieldSet>
                        <FieldLegend>Base band</FieldLegend>
                        <FieldDescription>
                          {source.thresholds.some((t) =>
                            Number.isFinite(t.value),
                          )
                            ? `Values below ${Math.min(...source.thresholds.map((t) => t.value).filter(Number.isFinite))}`
                            : "All numeric values until a threshold is added"}
                        </FieldDescription>
                        <FieldGroup className="grid grid-cols-[1fr_5rem] gap-3">
                          <Field>
                            <FieldLabel htmlFor="base-label">Label</FieldLabel>
                            <Input
                              id="base-label"
                              maxLength={80}
                              value={source.base.label}
                              onChange={(e) =>
                                patchSource({
                                  base: {
                                    ...source.base,
                                    label: e.target.value,
                                  },
                                })
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
                                patchSource({
                                  base: {
                                    ...source.base,
                                    color: e.target.value,
                                  },
                                })
                              }
                            />
                          </Field>
                        </FieldGroup>
                      </FieldSet>
                      {source.thresholds.map((rule, index) => {
                        const next = source.thresholds
                          .filter((t) => t.value > rule.value)
                          .sort((a, b) => a.value - b.value)[0]
                        return (
                          <FieldSet
                            key={index}
                            className="rounded-md border p-3"
                          >
                            <FieldLegend>Band {index + 1}</FieldLegend>
                            <FieldDescription>
                              {Number.isFinite(rule.value)
                                ? `${rule.value} ≤ value${next ? ` < ${next.value}` : " (no upper limit)"}`
                                : "Enter a boundary"}
                            </FieldDescription>
                            <FieldGroup className="grid grid-cols-[1fr_1fr_4rem] gap-2">
                              <Field data-invalid={Boolean(issue)}>
                                <FieldLabel htmlFor={`threshold-${index}`}>
                                  From
                                </FieldLabel>
                                <Input
                                  id={`threshold-${index}`}
                                  type="number"
                                  step="any"
                                  value={
                                    Number.isFinite(rule.value)
                                      ? rule.value
                                      : ""
                                  }
                                  aria-invalid={Boolean(issue)}
                                  onChange={(e) =>
                                    patchSource({
                                      thresholds: source.thresholds.map(
                                        (t, i) =>
                                          i === index
                                            ? {
                                                ...t,
                                                value:
                                                  e.target.value === ""
                                                    ? NaN
                                                    : Number(e.target.value),
                                              }
                                            : t,
                                      ),
                                    })
                                  }
                                />
                              </Field>
                              <Field>
                                <FieldLabel
                                  htmlFor={`threshold-label-${index}`}
                                >
                                  Label
                                </FieldLabel>
                                <Input
                                  id={`threshold-label-${index}`}
                                  value={rule.label}
                                  maxLength={80}
                                  onChange={(e) =>
                                    patchSource({
                                      thresholds: source.thresholds.map(
                                        (t, i) =>
                                          i === index
                                            ? { ...t, label: e.target.value }
                                            : t,
                                      ),
                                    })
                                  }
                                />
                              </Field>
                              <Field>
                                <FieldLabel
                                  htmlFor={`threshold-color-${index}`}
                                >
                                  Colour
                                </FieldLabel>
                                <Input
                                  id={`threshold-color-${index}`}
                                  type="color"
                                  value={rule.color}
                                  onChange={(e) =>
                                    patchSource({
                                      thresholds: source.thresholds.map(
                                        (t, i) =>
                                          i === index
                                            ? { ...t, color: e.target.value }
                                            : t,
                                      ),
                                    })
                                  }
                                />
                              </Field>
                            </FieldGroup>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                patchSource({
                                  thresholds: source.thresholds.filter(
                                    (_, i) => i !== index,
                                  ),
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
                                  color:
                                    COLORS[
                                      source.thresholds.length % COLORS.length
                                    ],
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
                            Boolean(issue) ||
                            widget.config.sources.filter(numeric).length < 2
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
                      Choose a numeric parameter to configure threshold bands.
                    </p>
                  )}
                </TabsContent>
              </div>
            </Tabs>
          </div>
          <DialogFooter className="items-center">
            <p className="mr-auto text-sm text-muted-foreground" role="status">
              {error ?? "Ready to apply to your dashboard draft."}
            </p>
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button
              disabled={Boolean(error)}
              onClick={() =>
                onApply({
                  ...widget,
                  title: widget.title.trim(),
                  config: {
                    sources: widget.config.sources.map((s) => ({
                      ...s,
                      thresholds: [...s.thresholds].sort(
                        (a, b) => a.value - b.value,
                      ),
                    })),
                  },
                })
              }
            >
              Apply to dashboard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={copyOpen} onOpenChange={setCopyOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Copy thresholds from {source?.label}
            </AlertDialogTitle>
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
                  (s) =>
                    numeric(s) &&
                    sourceKey(s) !== (source && sourceKey(source)),
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
                    <FieldLabel
                      htmlFor={`copy-${s.parameter_uuid}-${s.device_uuid}`}
                    >
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
                  setWidget({
                    ...widget,
                    config: {
                      sources: widget.config.sources.map((s) =>
                        targets.includes(sourceKey(s))
                          ? {
                              ...s,
                              base: { ...source.base },
                              thresholds: source.thresholds.map((t) => ({
                                ...t,
                              })),
                            }
                          : s,
                      ),
                    },
                  })
                setCopyOpen(false)
              }}
            >
              Replace selected thresholds
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
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
            <Button variant="destructive" onClick={onClose}>
              Discard panel changes
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
