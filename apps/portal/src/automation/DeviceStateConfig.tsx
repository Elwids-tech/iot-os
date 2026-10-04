import { useId, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import type { DeviceProfileParameter } from "@iot-os/api-client"
import type { Workflow, WorkflowNode } from "@iot-os/workflow-editor"
import { Alert, AlertDescription } from "@iot-os/ui/components/alert"
import { Checkbox } from "@iot-os/ui/components/checkbox"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@iot-os/ui/components/field"
import { Input } from "@iot-os/ui/components/input"
import { SearchableSelect } from "@iot-os/ui/components/searchable-select"
import { Slider } from "@iot-os/ui/components/slider"
import { Switch } from "@iot-os/ui/components/switch"
import { ToggleGroup, ToggleGroupItem } from "@iot-os/ui/components/toggle-group"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { api } from "../lib/api"
import { RequestError } from "../components/forms"
import { controlSpec, parseControlValue } from "../controls/model"
import { commandSettings, initialSetting, updateDeviceSettings, type ControlResource } from "./device-state"

type Page = { data: ControlResource[]; meta: { current_page: number; last_page: number; total: number } }

export function DeviceStateConfig({ org, node, graph, onChange }: { org: string; node: WorkflowNode; graph: Workflow; onChange: (graph: Workflow) => void }) {
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [chosen, setChosen] = useState("")
  const settings = commandSettings(node)
  const selectedBindings = graph.bindings.filter(b => Object.hasOwn(settings, b.role))
  const deviceId = selectedBindings[0]?.device_uuid ?? chosen
  const resources = useQuery({ queryKey: ["automation-controls", org, search, page], queryFn: () => api.automation<Page>(org, `/dag/resources?${new URLSearchParams({ controllable: "1", search, page: String(page) })}`) })
  // Hydrate the selected device independently of search/pagination, including after reopening a saved draft.
  const selected = useQuery({ queryKey: ["automation-control-device", org, deviceId], queryFn: () => api.automation<Page>(org, `/dag/resources?controllable=1&device_uuid=${encodeURIComponent(deviceId)}`), enabled: Boolean(deviceId) })
  const device = selected.data?.data[0]
  const values = Object.fromEntries(selectedBindings.map(b => [b.parameter_uuid, settings[b.role]]))
  const stale = Boolean(device && selectedBindings.some(b => b.device_uuid !== device.device_uuid || b.configuration_uuid !== device.configuration_uuid || b.generation !== device.generation || !device.parameters.some(p => p.uuid === b.parameter_uuid)))
  const change = (values: Record<string, unknown>) => onChange(updateDeviceSettings(graph, node, device, values))
  return <>
    <SearchableSelect label="Controllable device" value={deviceId} selectedLabel={device?.name} options={(resources.data?.data ?? []).map(d => ({ value: d.device_uuid, label: d.name }))} search={search} onSearchChange={s => { setSearch(s); setPage(1) }} page={page} hasNextPage={page < (resources.data?.meta.last_page ?? 1)} onPageChange={setPage} loading={resources.isFetching} emptyText="No controllable devices found." onChange={id => {
      setChosen(id)
      onChange(updateDeviceSettings(graph, node, undefined, {}))
    }} />
    <RequestError error={resources.error ?? selected.error} />
    <FieldDescription>Select the settings this node should change. Other settings stay unchanged. These are draft values; devices receive commands only when the activated automation triggers.</FieldDescription>
    {deviceId && selected.isPending && <Skeleton className="h-32 w-full" />}
    {deviceId && selected.isSuccess && !device && <Alert variant="destructive"><AlertDescription>This device is no longer available for control. Select another device.</AlertDescription></Alert>}
    {stale && <Alert variant="destructive"><AlertDescription>The device configuration changed. Choose settings again to bind this node to the currently applied configuration.</AlertDescription></Alert>}
    {device && <FieldGroup>{device.parameters.map(p => {
      const included = Object.hasOwn(values, p.uuid)
      const unsupported = controlSpec(p).kind === "unsupported"
      return <FieldGroup key={p.uuid}>
        <Field orientation="horizontal"><Checkbox id={`include-${node.id}-${p.uuid}`} checked={included} disabled={unsupported && !included} onCheckedChange={checked => {
          const next = { ...values }
          if (checked === true) next[p.uuid] = initialSetting(p)
          else delete next[p.uuid]
          change(next)
        }} /><FieldLabel htmlFor={`include-${node.id}-${p.uuid}`}>Set {p.label}</FieldLabel></Field>
        {included && <SettingValue parameter={p} value={values[p.uuid]} onChange={value => change({ ...values, [p.uuid]: value })} />}
        {unsupported && <FieldDescription>This parameter does not have a supported control.</FieldDescription>}
      </FieldGroup>
    })}</FieldGroup>}
    {device && !Object.keys(values).length && <FieldDescription>Select at least one setting before saving.</FieldDescription>}
    {Object.keys(values).length > 1 && <FieldDescription>Each selected setting is a separate command with its own outcome. Changes are not atomic and their arrival order is not guaranteed.</FieldDescription>}
  </>
}

function SettingValue({ parameter, value, onChange }: { parameter: DeviceProfileParameter; value: unknown; onChange: (value: unknown) => void }) {
  const id = useId(), spec = controlSpec(parameter)
  const [search, setSearch] = useState("")
  const text = String(value ?? "")
  let error = ""
  try { parseControlValue(parameter, text) } catch (e) { error = (e as Error).message }
  const edit = (text: string) => {
    try { onChange(parseControlValue(parameter, text)) } catch { onChange(text) }
  }
  return <Field data-invalid={Boolean(error)}>
    <FieldLabel htmlFor={id}>{parameter.label}{parameter.unit ? ` (${parameter.unit})` : ""}</FieldLabel>
    {spec.kind === "switch" && <div className="flex items-center gap-3"><Switch id={id} checked={value === true} onCheckedChange={onChange} /><span>{value === true ? "On" : "Off"}</span></div>}
    {spec.kind === "options" && (spec.optionControl === "searchable_select" || (spec.optionControl !== "toggle_group" && spec.options!.length > 7) ?
      <SearchableSelect label={`${parameter.label} value`} value={text} search={search} onSearchChange={setSearch} options={spec.options!.filter(o => String(o).toLowerCase().includes(search.toLowerCase())).map(o => ({ value: String(o), label: String(o) }))} onChange={edit} /> :
      <ToggleGroup type="single" variant="outline" aria-label={parameter.label} value={text} onValueChange={next => { if (next) edit(next) }} className="flex-wrap">{spec.options!.map(o => <ToggleGroupItem key={String(o)} value={String(o)} aria-label={String(o)}>{String(o)}</ToggleGroupItem>)}</ToggleGroup>)}
    {spec.kind === "slider" && <Slider aria-label={`${parameter.label} slider`} min={spec.min} max={spec.max} step={spec.step} value={[typeof value === "number" ? value : spec.min!]} onValueChange={([next]) => onChange(next)} />}
    {spec.kind === "color" && <Input type="color" aria-label={`${parameter.label} picker`} value={/^#[0-9a-f]{6}$/i.test(text) ? text : "#000000"} onChange={e => edit(e.target.value.toUpperCase())} className="h-10 w-20" />}
    {["slider", "number", "color", "text"].includes(spec.kind) && <Input id={id} aria-invalid={Boolean(error)} type={["slider", "number"].includes(spec.kind) ? "number" : "text"} min={spec.min} max={spec.max} step={spec.step ?? "any"} value={text} onChange={e => edit(e.target.value)} />}
    {error && <FieldDescription role="alert">{error}</FieldDescription>}
  </Field>
}

export function DeviceStateReview({ org, node, graph }: { org: string; node: WorkflowNode; graph: Workflow }) {
  const settings = commandSettings(node)
  const bindings = graph.bindings.filter(b => Object.hasOwn(settings, b.role))
  const id = bindings[0]?.device_uuid
  const device = useQuery({ queryKey: ["automation-control-device", org, id], queryFn: () => api.automation<Page>(org, `/dag/resources?controllable=1&device_uuid=${encodeURIComponent(id!)}`), enabled: Boolean(id) })
  const resource = device.data?.data[0]
  return <Alert><AlertDescription>
    <p>{resource?.name ?? "Device settings"} · {node.id}</p>
    <ul className="grid gap-1">{bindings.map(b => <li key={b.role}>{resource?.parameters.find(p => p.uuid === b.parameter_uuid)?.label ?? b.role} → {String(settings[b.role])}</li>)}</ul>
    <p>Minimum {String(node.config.cooldown_seconds)} seconds between commands per setting.</p>
    <RequestError error={device.error} />
  </AlertDescription></Alert>
}
