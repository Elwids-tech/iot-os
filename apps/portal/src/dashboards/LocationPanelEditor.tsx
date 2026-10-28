import { useState } from "react"
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import type { DashboardWidget, DeviceDetail, LocationBinding, TrailWindow } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@iot-os/ui/components/field"
import { Switch } from "@iot-os/ui/components/switch"
import { ToggleGroup, ToggleGroupItem } from "@iot-os/ui/components/toggle-group"
import { SearchableMultiSelect, SearchableSelect } from "@iot-os/ui/components/searchable-select"
import { Loader2Icon } from "lucide-react"
import { RequestError } from "../components/forms"
import { locationParameters, numericParameters } from "../devices/model"
import { LocationBindingSheet } from "../geospatial/LocationBindingSheet"
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
      help="Only devices with a saved location appear here." />
    <UnplacedDevices org={org} bindings={bindings.data?.data}
      onSaved={(device) => patch({ sources: [], location_device_uuids: [...new Set([...selected, device])].slice(0, 100), workflow_uuid: undefined })} />
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

const SHOWN = 10
/** Devices whose profile has latitude/longitude parameters but no saved location, so the map can't list them yet. */
function UnplacedDevices({ org, bindings, onSaved }: {
  org: string
  /** Undefined until loaded. */
  bindings: LocationBinding[] | undefined
  onSaved: (deviceUuid: string) => void
}) {
  const cache = useQueryClient()
  const bound = new Set((bindings ?? []).map((binding) => binding.device_uuid))
  // Saving a binding needs device management, which dashboard editors may not have.
  const session = useQuery({ queryKey: ["session"], queryFn: () => api.me(), staleTime: 60000 })
  const manage = session.data?.organizations.find((o) => o.uuid === org)?.capabilities?.devices?.manage ?? false
  const devices = useQuery({
    queryKey: ["location-candidates", org],
    queryFn: () => api.devices(org, { per_page: 100 }),
    enabled: Boolean(bindings) && manage,
  })
  const unbound = (devices.data?.data ?? []).filter((d) => d.profile && d.lifecycle !== "archived" && !bound.has(d.uuid))
  // The profile's current parameters say whether it reports coordinates; the sheet then uses the applied ones.
  const profiles = useQueries({
    queries: [...new Set(unbound.map((d) => d.profile!.uuid))].map((profile) => ({
      queryKey: ["dashboard-profile-groups", org, profile],
      queryFn: () => api.deviceProfile(org, profile),
      retry: false,
      staleTime: 60_000,
    })),
  })
  const located = new Set(profiles.flatMap((q) => (q.data && locationParameters(null, numericParameters(q.data.parameters)) ? [q.data.uuid] : [])))
  const candidates = unbound.filter((d) => located.has(d.profile!.uuid))
  const [opening, setOpening] = useState<string | null>(null),
    [device, setDevice] = useState<DeviceDetail | null>(null),
    [error, setError] = useState<unknown>(null)
  async function open(uuid: string) {
    setOpening(uuid)
    setError(null)
    try {
      setDevice(await cache.fetchQuery({ queryKey: ["dashboard-device", org, uuid], queryFn: () => api.device(org, uuid), staleTime: 30_000 }))
    } catch (reason) {
      setError(reason)
    } finally {
      setOpening(null)
    }
  }
  return <>
    {candidates.length > 0 && <FieldSet>
      <FieldLegend variant="label">Not on the map yet</FieldLegend>
      <FieldDescription>
        {candidates.length === 1 ? "This device reports coordinates but has" : `These ${candidates.length} devices report coordinates but have`} no saved location.
        {candidates.length > SHOWN && ` The first ${SHOWN} are listed; set up the rest from each device's Overview.`}
      </FieldDescription>
      <ul className="flex flex-col divide-y rounded-md border">
        {candidates.slice(0, SHOWN).map((candidate) => <li key={candidate.uuid} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
          <span className="min-w-0 truncate">{candidate.name}</span>
          <Button type="button" variant="outline" size="sm" disabled={opening !== null} onClick={() => open(candidate.uuid)}>
            {opening === candidate.uuid && <Loader2Icon data-icon="inline-start" className="animate-spin" aria-hidden="true" />}
            Set up location
          </Button>
        </li>)}
      </ul>
      <RequestError error={error} />
    </FieldSet>}
    {/* Outside the list, which empties when the device gets a binding. The live binding turns a concurrent save into an edit at the newer revision. */}
    {device && <LocationBindingSheet org={org} device={device} binding={bindings?.find((binding) => binding.device_uuid === device.uuid)}
      onSaved={(binding) => onSaved(binding.device_uuid)} onClose={() => setDevice(null)} />}
  </>
}
