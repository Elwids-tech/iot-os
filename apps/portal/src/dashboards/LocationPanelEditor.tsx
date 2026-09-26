import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import type { DashboardView, DashboardWidget, TrailWindow } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@iot-os/ui/components/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@iot-os/ui/components/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@iot-os/ui/components/field"
import { Input } from "@iot-os/ui/components/input"
import { Textarea } from "@iot-os/ui/components/textarea"
import { Switch } from "@iot-os/ui/components/switch"
import { ToggleGroup, ToggleGroupItem } from "@iot-os/ui/components/toggle-group"
import { SearchableMultiSelect, SearchableSelect } from "@iot-os/ui/components/searchable-select"
import { Confirm, RequestError } from "../components/forms"
import { api } from "../lib/api"
import { widgetError } from "./model"
import { PanelBody } from "./registry"

export function LocationPanelEditor({ initial, org, view, window, onApply, onClose, onDirty }: {
  initial: DashboardWidget; org: string; view: DashboardView; window: { from: string; to: string }
  onApply: (widget: DashboardWidget) => void; onClose: () => void; onDirty: (dirty: boolean) => void
}) {
  const [widget, setWidget] = useState(() => structuredClone(initial))
  const [fenceSearch, setFenceSearch] = useState("")
  const [discard, setDiscard] = useState(false)
  const dirty = JSON.stringify(widget) !== JSON.stringify(initial)
  useEffect(() => { onDirty(dirty); return () => onDirty(false) }, [dirty, onDirty])
  const bindings = useQuery({ queryKey: ["location-bindings", org], queryFn: () => api.locationBindings(org) })
  const fences = useQuery({ queryKey: ["geofences", org, fenceSearch], queryFn: () => api.geofences(org, fenceSearch) })
  const selected = widget.config.location_device_uuids ?? []
  const issue = widgetError(widget)
  const close = () => dirty ? setDiscard(true) : onClose()
  return <>
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="flex h-[94svh] w-[calc(100vw-2rem)] max-w-none flex-col sm:max-w-[90rem]" onInteractOutside={(event) => event.preventDefault()}>
        <DialogHeader><DialogTitle>Edit GPS map panel</DialogTitle><DialogDescription>Select up to 100 location-enabled devices. A geofence overlay is optional.</DialogDescription></DialogHeader>
        <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto lg:grid-cols-[minmax(0,1.3fr)_minmax(20rem,.7fr)]">
          <Card className="min-h-96"><CardHeader><CardTitle>{widget.title || "GPS map"}</CardTitle></CardHeader><CardContent className="min-h-96"><PanelBody preview org={org} widget={widget} view={view} window={window} /></CardContent></Card>
          <FieldGroup>
            <Field data-invalid={!widget.title.trim()}><FieldLabel htmlFor="location-title">Panel title</FieldLabel><Input id="location-title" value={widget.title} maxLength={120} aria-invalid={!widget.title.trim()} onChange={(event) => setWidget({ ...widget, title: event.target.value })} /></Field>
            <Field><FieldLabel htmlFor="location-description">Description</FieldLabel><Textarea id="location-description" value={widget.description} maxLength={1000} onChange={(event) => setWidget({ ...widget, description: event.target.value })} /></Field>
            <SearchableMultiSelect label="GPS devices" values={selected} maximum={100} options={(bindings.data?.data ?? []).map((binding) => ({ value: binding.device_uuid, label: binding.device_name }))}
              onChange={(location_device_uuids) => setWidget({ ...widget, config: { ...widget.config, sources: [], location_device_uuids, workflow_uuid: undefined } })}
              help="Only devices with a saved location binding appear here." />
            <SearchableSelect label="Geofence overlay" value={widget.config.geofence_uuid ?? ""} selectedLabel={(fences.data?.data ?? []).find((fence) => fence.uuid === widget.config.geofence_uuid)?.name}
              options={[{ value: "", label: "No geofence · monitoring only" }, ...(fences.data?.data ?? []).map((fence) => ({ value: fence.uuid, label: fence.name }))]}
              search={fenceSearch} onSearchChange={setFenceSearch} onChange={(geofence_uuid) => setWidget({ ...widget, config: { ...widget.config, geofence_uuid: geofence_uuid || undefined } })} />
            <Field><FieldLabel>Trail window</FieldLabel><ToggleGroup type="single" variant="outline" value={widget.config.trail_window ?? "24h"} onValueChange={(value) => value && setWidget({ ...widget, config: { ...widget.config, trail_window: value as TrailWindow } })}>
              {(["1h", "6h", "24h", "7d"] as const).map((value) => <ToggleGroupItem key={value} value={value}>{value}</ToggleGroupItem>)}</ToggleGroup></Field>
            <Field orientation="horizontal"><Switch id="show-trails" checked={widget.config.show_trails ?? true} onCheckedChange={(show_trails) => setWidget({ ...widget, config: { ...widget.config, show_trails } })} /><FieldLabel htmlFor="show-trails">Show movement trails</FieldLabel></Field>
            <Field orientation="horizontal"><Switch id="show-labels" checked={widget.config.show_labels ?? true} onCheckedChange={(show_labels) => setWidget({ ...widget, config: { ...widget.config, show_labels } })} /><FieldLabel htmlFor="show-labels">Show device labels</FieldLabel></Field>
            <RequestError error={bindings.error ?? fences.error} />
            <FieldDescription>Map background uses the configured MapLibre style and falls back to OpenStreetMap in development.</FieldDescription>
          </FieldGroup>
        </div>
        <DialogFooter className="items-center"><p className="mr-auto text-sm text-muted-foreground" role="status">{issue ?? `${selected.length} devices selected`}</p><Button variant="outline" onClick={close}>Cancel</Button><Button disabled={Boolean(issue)} onClick={() => onApply({ ...widget, title: widget.title.trim() })}>Apply to dashboard</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Confirm open={discard} title="Discard panel changes?" description="The dashboard draft will not be changed." action="Discard changes" onClose={() => setDiscard(false)} onConfirm={onClose} />
  </>
}
