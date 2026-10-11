import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import type { WorkflowNode } from "@iot-os/workflow-editor"
import { Button } from "@iot-os/ui/components/button"
import { Field, FieldDescription, FieldLabel } from "@iot-os/ui/components/field"
import { Textarea } from "@iot-os/ui/components/textarea"
import { SearchableSelect } from "@iot-os/ui/components/searchable-select"
import { toast } from "sonner"
import { api } from "../lib/api"
import { RequestError } from "../components/forms"
import { parseGeofenceGeometry } from "../geospatial/geofence-json"

export function GeofenceConfig({ org, node, update }: { org: string; node: WorkflowNode; update: (node: WorkflowNode) => void }) {
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const fences = useQuery({ queryKey: ["geofences", org, search, page], queryFn: () => api.geofences(org, search, page) })
  const value = node.config.geometry
  const text = typeof value === "string" ? value : JSON.stringify(value ?? {}, null, 2)
  let error = ""
  try { parseGeofenceGeometry(value) } catch (e) { error = e instanceof SyntaxError ? "Enter valid JSON." : (e as Error).message }
  const change = (geometry: unknown) => update({ ...node, config: { ...node.config, geometry } })
  return <>
    <SearchableSelect label="Import existing geofence" value="" placeholder="Choose a saved boundary" search={search} onSearchChange={(value) => { setSearch(value); setPage(1) }} options={(fences.data?.data ?? []).map((f) => ({ value: f.uuid, label: `${f.name} · revision ${f.revision}` }))} loading={fences.isFetching} page={page} hasNextPage={page < (fences.data?.meta.last_page ?? 1)} onPageChange={setPage} help="Copies the saved geometry into this draft. Later geofence edits do not change this node; import again to update it." onChange={(id) => {
      const fence = fences.data?.data.find((f) => f.uuid === id)
      if (!fence) return
      try { change(parseGeofenceGeometry(fence.geometry)); toast.success(`Imported ${fence.name}, revision ${fence.revision}.`) } catch (e) { toast.error((e as Error).message) }
    }} />
    <RequestError error={fences.error} />
    <Field data-invalid={Boolean(error)}><FieldLabel htmlFor={`geometry-${node.id}`}>Geometry JSON</FieldLabel>
      <Textarea id={`geometry-${node.id}`} rows={10} value={text} aria-invalid={Boolean(error)} onChange={(event) => {
        try { change(parseGeofenceGeometry(event.target.value)) } catch { change(event.target.value) }
      }} />
      <FieldDescription>{error || "Paste a Polygon, GeoJSON Feature, or geofence configuration containing geometry."}</FieldDescription>
    </Field>
    <Button variant="outline" disabled={Boolean(error)} onClick={async () => {
      try { await navigator.clipboard.writeText(JSON.stringify(parseGeofenceGeometry(value), null, 2)); toast.success("Geometry JSON copied") } catch { toast.error("Could not copy. Select the JSON and copy it manually") }
    }}>Copy geometry JSON</Button>
  </>
}
