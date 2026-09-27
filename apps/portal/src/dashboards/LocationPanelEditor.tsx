import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import type { DashboardWidget, TrailWindow } from "@iot-os/api-client"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@iot-os/ui/components/field"
import { Switch } from "@iot-os/ui/components/switch"
import { ToggleGroup, ToggleGroupItem } from "@iot-os/ui/components/toggle-group"
import { SearchableMultiSelect, SearchableSelect } from "@iot-os/ui/components/searchable-select"
import { RequestError } from "../components/forms"
import { api } from "../lib/api"

/** GPS settings share the full-page panel editor and its draft/apply lifecycle. */
export function LocationSettings({ org, widget, onChange }: {
  org: string
  widget: DashboardWidget
  onChange: (widget: DashboardWidget) => void
}) {
  const [search, setSearch] = useState("")
  const bindings = useQuery({ queryKey: ["location-bindings", org], queryFn: () => api.locationBindings(org) })
  const fences = useQuery({ queryKey: ["geofences", org, search], queryFn: () => api.geofences(org, search) })
  const selected = widget.config.location_device_uuids ?? []
  const patch = (config: Partial<DashboardWidget["config"]>) => onChange({ ...widget, config: { ...widget.config, ...config } })
  return <FieldGroup>
    <SearchableMultiSelect label="GPS devices" values={selected} maximum={100}
      options={(bindings.data?.data ?? []).map((binding) => ({ value: binding.device_uuid, label: binding.device_name }))}
      onChange={(location_device_uuids) => patch({ sources: [], location_device_uuids, workflow_uuid: undefined })}
      help="Only devices with a saved location binding appear here." />
    <SearchableSelect label="Geofence overlay" value={widget.config.geofence_uuid ?? ""}
      selectedLabel={(fences.data?.data ?? []).find((fence) => fence.uuid === widget.config.geofence_uuid)?.name}
      options={[{ value: "", label: "No geofence · monitoring only" }, ...(fences.data?.data ?? []).map((fence) => ({ value: fence.uuid, label: fence.name }))]}
      search={search} onSearchChange={setSearch}
      onChange={(geofence_uuid) => patch({ geofence_uuid: geofence_uuid || undefined })} />
    <Field><FieldLabel>Trail window</FieldLabel>
      <ToggleGroup type="single" variant="outline" value={widget.config.trail_window ?? "24h"}
        onValueChange={(value) => value && patch({ trail_window: value as TrailWindow })}>
        {(["1h", "6h", "24h", "7d"] as const).map((value) => <ToggleGroupItem key={value} value={value}>{value}</ToggleGroupItem>)}
      </ToggleGroup>
    </Field>
    <Field orientation="horizontal"><Switch id="show-trails" checked={widget.config.show_trails ?? true} onCheckedChange={(show_trails) => patch({ show_trails })} /><FieldLabel htmlFor="show-trails">Show movement trails</FieldLabel></Field>
    <Field orientation="horizontal"><Switch id="show-labels" checked={widget.config.show_labels ?? true} onCheckedChange={(show_labels) => patch({ show_labels })} /><FieldLabel htmlFor="show-labels">Show device labels</FieldLabel></Field>
    <RequestError error={bindings.error ?? fences.error} />
    <FieldDescription>Select up to 100 location-enabled devices. A geofence overlay is optional.</FieldDescription>
  </FieldGroup>
}
