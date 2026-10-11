import { lazy, Suspense, useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom"
import type { GeofenceInput, GeofencePolicy } from "@iot-os/api-client"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { DataTable, RowLink, type DataColumn } from "@iot-os/ui/components/data-table"
import { DraftBar } from "@iot-os/ui/components/draft-bar"
import { StatusMark } from "@iot-os/ui/components/status-mark"
import { statusOf } from "@iot-os/ui/lib/status"
import { CollectionPage } from "@iot-os/ui/templates/collection-page"
import { WorkspacePage } from "@iot-os/ui/templates/workspace-page"
import { Badge } from "@iot-os/ui/components/badge"
import { Button } from "@iot-os/ui/components/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@iot-os/ui/components/card"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@iot-os/ui/components/field"
import { Input } from "@iot-os/ui/components/input"
import { SearchableMultiSelect } from "@iot-os/ui/components/searchable-select"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { MapPinIcon, PlusIcon, Redo2Icon, SaveIcon, Trash2Icon, Undo2Icon } from "lucide-react"
import { toast } from "sonner"
import { api } from "../lib/api"
import { LoadError, RequestError } from "../components/forms"
import { useDeviceOrganization } from "../devices/shared"
import { LocationTabs } from "../devices/SitesPage"
import { closeRing, validateVertices } from "./geometry"
const LocationMap = lazy(() => import("./LocationMap").then((module) => ({ default: module.LocationMap })))

const defaultPolicy: GeofencePolicy = { outside_for_seconds: 60, max_gap_seconds: 45, minimum_samples: 2, uncertainty_metres: 2 }

export default function GeofenceRoutes() {
  return <Routes><Route index element={<GeofenceDirectory />} /><Route path="new" element={<GeofenceEditor />} /><Route path=":geofenceUuid" element={<GeofenceEditor />} /></Routes>
}

function GeofenceDirectory() {
  const { organizationUuid = "" } = useParams()
  const { capabilities } = useDeviceOrganization()
  const [search, setSearch] = useState("")
  const query = useQuery({ queryKey: ["geofences", organizationUuid], queryFn: () => api.geofences(organizationUuid) })
  type Fence = NonNullable<typeof query.data>["data"][number]
  const columns: DataColumn<Fence>[] = [
    {
      id: "geofence",
      header: "Geofence",
      mobile: "title",
      sortable: true,
      searchable: true,
      value: (fence) => fence.name,
      cell: (fence) => <RowLink to={fence.uuid}>{fence.name}</RowLink>,
    },
    { id: "revision", header: "Revision", align: "end", value: (fence) => fence.revision, cell: (fence) => <span className="tabular-nums">{fence.revision}</span> },
    {
      id: "devices",
      header: "Assigned devices",
      className: "max-w-md whitespace-normal",
      searchable: true,
      value: (fence) => fence.assignments.map((a) => a.device.name).join(", "),
      cell: (fence) =>
        fence.assignments.length ? (
          <span className="flex flex-wrap gap-x-3 gap-y-1">
            {fence.assignments.map((assignment) => (
              <StatusMark
                key={assignment.uuid}
                tone={statusOf(assignment.status).tone}
                title={statusOf(assignment.status).label}
              >
                {assignment.device.name}
              </StatusMark>
            ))}
          </span>
        ) : (
          <span className="text-muted-foreground">None</span>
        ),
    },
  ]
  return (
    <CollectionPage
      title="Locations"
      description="Geofences: boundaries that raise events when GPS devices enter or leave them."
      tabs={<LocationTabs org={organizationUuid} />}
      actions={
        capabilities.manage && (
          <Button size="sm" asChild>
            <Link to="new">
              <PlusIcon data-icon="inline-start" />
              New geofence
            </Link>
          </Button>
        )
      }
    >
      <DataTable
        id="geofences"
        label="Geofences"
        noun={["geofence", "geofences"]}
        rows={query.data?.data}
        rowKey={(fence) => fence.uuid}
        rowHref={(fence) => fence.uuid}
        columns={columns}
        defaultSort={[{ id: "geofence", desc: false }]}
        error={query.error ? <LoadError error={query.error} what="geofences" onRetry={() => query.refetch()} busy={query.isFetching} /> : undefined}
        search={{ label: "Search geofences", placeholder: "Search name or device", value: search, onChange: setSearch }}
        empty={
          <EmptyState
            inset
            icon={<MapPinIcon />}
            title="No geofences yet"
            description="Draw a polygon and assign GPS devices to start monitoring boundary events."
          />
        }
      />
    </CollectionPage>
  )
}

function GeofenceEditor() {
  const { organizationUuid = "", geofenceUuid } = useParams()
  const [searchParams] = useSearchParams()
  const activationUuid = searchParams.get("activation")
  const navigate = useNavigate(), cache = useQueryClient()
  const existing = useQuery({ queryKey: ["geofence", organizationUuid, geofenceUuid], queryFn: () => api.geofence(organizationUuid, geofenceUuid!), enabled: Boolean(geofenceUuid) })
  const bindings = useQuery({ queryKey: ["location-bindings", organizationUuid], queryFn: () => api.locationBindings(organizationUuid) })
  const activation = useQuery({ queryKey: ["geofence-activation", organizationUuid, geofenceUuid, activationUuid],
    queryFn: () => api.geofenceActivation(organizationUuid, geofenceUuid!, activationUuid!), enabled: Boolean(geofenceUuid && activationUuid),
    refetchInterval: (query) => query.state.data?.status === "pending" ? 2_000 : false })
  const events = useQuery({ queryKey: ["geofence-events", organizationUuid, geofenceUuid], queryFn: () => api.geofenceEvents(organizationUuid, geofenceUuid!), enabled: Boolean(geofenceUuid) })
  const [name, setName] = useState("")
  const [vertices, setVertices] = useState<number[][]>([])
  const [history, setHistory] = useState<number[][][]>([]), [future, setFuture] = useState<number[][][]>([])
  const [selectedVertex, setSelectedVertex] = useState<number | null>(null)
  const [devices, setDevices] = useState<string[]>([])
  const [policy, setPolicy] = useState<GeofencePolicy>(defaultPolicy)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    if (loaded || (geofenceUuid && !existing.data)) return
    const fence = existing.data
    setName(fence?.name ?? "")
    setVertices((fence?.geometry.coordinates[0] ?? []).slice(0, -1))
    setDevices(fence?.assignments.map((assignment) => assignment.device.uuid) ?? [])
    setPolicy(fence?.assignments[0]?.policy ?? defaultPolicy)
    setLoaded(true)
  }, [existing.data, geofenceUuid, loaded])
  const validation = useMemo(() => validateVertices(vertices), [vertices])
  const changeVertices = (next: number[][]) => { setHistory((items) => [...items.slice(-49), vertices.map((point) => [...point])]); setFuture([]); setVertices(next); setSelectedVertex(null) }
  const save = useMutation({ mutationFn: async () => {
    const input: GeofenceInput = { operation_uuid: crypto.randomUUID(), expected_revision: existing.data?.revision ?? 0, name: name.trim(),
      geometry: { type: "Polygon", coordinates: [[...vertices.map((point) => [...point]), [...vertices[0]]]] },
      assignments: devices.map((device_uuid) => ({ device_uuid, policy })) }
    return existing.data ? api.updateGeofence(organizationUuid, existing.data.uuid, input) : api.createGeofence(organizationUuid, input)
  }, onSuccess: async (result) => { toast.success("Geofence saved and activation started"); await Promise.all([
    cache.invalidateQueries({ queryKey: ["geofences", organizationUuid] }), cache.invalidateQueries({ queryKey: ["geofence", organizationUuid] })])
    navigate(`/organizations/${encodeURIComponent(organizationUuid)}/geofences/${encodeURIComponent(result.data.uuid)}?activation=${encodeURIComponent(result.activation.uuid)}`) } })
  const retry = useMutation({ mutationFn: (item: number) => api.retryGeofenceActivation(organizationUuid, geofenceUuid!, activationUuid!, item),
    onSuccess: (result) => cache.setQueryData(["geofence-activation", organizationUuid, geofenceUuid, activationUuid], result) })
  const back = { to: `/organizations/${organizationUuid}/geofences`, label: "Geofences" }
  if (existing.isPending && geofenceUuid) return <WorkspacePage title="Geofence" back={back}><Skeleton className="h-96 w-full" /></WorkspacePage>
  return <>
    <WorkspacePage
      title={existing.data ? existing.data.name : "New geofence"}
      back={back}
      tools={<p className="text-body text-muted-foreground">Right-click the map to add a point. Drag points to move them; right-click a point to delete it.</p>}
      draft={<DraftBar tone={existing.data ? "good" : "info"} status={existing.data ? "Active" : "Not saved yet"} revision={existing.data ? `Revision ${existing.data.revision}` : undefined} />}
    >
    <RequestError error={existing.error ?? bindings.error ?? activation.error ?? events.error ?? save.error ?? retry.error} />
    <div className="grid min-h-[42rem] gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <Suspense fallback={<Skeleton className="h-full w-full" />}><LocationMap devices={[]} editable vertices={vertices} selectedVertex={selectedVertex} onSelectedVertex={setSelectedVertex} onVerticesChange={changeVertices} /></Suspense>
      <Card className="overflow-y-auto"><CardHeader><CardTitle>Fence and automation</CardTitle><CardDescription>Saving immediately deploys one independent rule per assigned device.</CardDescription></CardHeader><CardContent><FieldGroup>
        <Button variant="outline" disabled={Boolean(validation)} onClick={async () => {
          try { await navigator.clipboard.writeText(JSON.stringify({ type: "Polygon", coordinates: [closeRing(vertices)] }, null, 2)); toast.success("Geometry JSON copied. Paste it into an automation geofence node") }
          catch { toast.error("Clipboard access failed. Try copying from the automation node instead") }
        }}>Copy geometry JSON</Button>
        <FieldDescription>Copies the current boundary, including unsaved map edits, for an automation node.</FieldDescription>
        <Field data-invalid={!name.trim()}><FieldLabel htmlFor="fence-name">Name</FieldLabel><Input id="fence-name" value={name} maxLength={255} aria-invalid={!name.trim()} onChange={(event) => setName(event.target.value)} /></Field>
        <SearchableMultiSelect label="Assigned GPS devices" values={devices} options={(bindings.data?.data ?? []).map((binding) => ({ value: binding.device_uuid, label: binding.device_name }))} onChange={setDevices} maximum={100} />
        <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={!history.length} onClick={() => { const previous = history.at(-1)!; setFuture([vertices, ...future]); setVertices(previous); setHistory(history.slice(0, -1)) }}><Undo2Icon data-icon="inline-start" />Undo</Button>
          <Button variant="outline" size="sm" disabled={!future.length} onClick={() => { const next = future[0]; setHistory([...history, vertices]); setVertices(next); setFuture(future.slice(1)) }}><Redo2Icon data-icon="inline-start" />Redo</Button>
          <Button variant="outline" size="sm" onClick={() => changeVertices([...vertices, defaultPoint(vertices)])}><PlusIcon data-icon="inline-start" />Add point</Button>
          <Button variant="destructive" size="sm" disabled={selectedVertex === null} onClick={() => selectedVertex !== null && changeVertices(vertices.filter((_, index) => index !== selectedVertex))}><Trash2Icon data-icon="inline-start" />Delete point</Button></div>
        <Field><FieldLabel htmlFor="outside-seconds">Outside duration (seconds)</FieldLabel><Input id="outside-seconds" type="number" min={0} max={86400} value={policy.outside_for_seconds} onChange={(event) => setPolicy({ ...policy, outside_for_seconds: Number(event.target.value) })} /></Field>
        <Field><FieldLabel htmlFor="minimum-samples">Minimum samples</FieldLabel><Input id="minimum-samples" type="number" min={1} max={1000} value={policy.minimum_samples} onChange={(event) => setPolicy({ ...policy, minimum_samples: Number(event.target.value) })} /></Field>
        <Field><FieldLabel htmlFor="max-gap">Maximum report gap (seconds)</FieldLabel><Input id="max-gap" type="number" min={1} max={86400} value={policy.max_gap_seconds} onChange={(event) => setPolicy({ ...policy, max_gap_seconds: Number(event.target.value) })} /></Field>
        <Field><FieldLabel htmlFor="uncertainty">Boundary uncertainty (metres)</FieldLabel><Input id="uncertainty" type="number" min={0} max={100000} step="any" value={policy.uncertainty_metres} onChange={(event) => setPolicy({ ...policy, uncertainty_metres: Number(event.target.value) })} /></Field>
        {validation ? <Alert variant="destructive"><AlertTitle>Polygon needs attention</AlertTitle><AlertDescription>{validation}</AlertDescription></Alert> : <FieldDescription>{vertices.length} points · ring closes automatically when saved.</FieldDescription>}
      </FieldGroup></CardContent><CardFooter><Button className="w-full" disabled={Boolean(validation) || !name.trim() || !devices.length || save.isPending} onClick={() => save.mutate()}><SaveIcon data-icon="inline-start" />{save.isPending ? "Saving and activating…" : "Save and activate"}</Button></CardFooter></Card>
    </div>
    {activation.data && <Card><CardHeader><div className="flex items-center justify-between gap-3"><div><CardTitle>Activation status</CardTitle><CardDescription>Revision {activation.data.geofence_revision} deploys independently to each device.</CardDescription></div><Badge variant={activation.data.status === "succeeded" ? "secondary" : activation.data.status === "partial_failure" ? "destructive" : "outline"}>{activation.data.status.replace("_", " ")}</Badge></div></CardHeader>
      <CardContent className="grid gap-2 md:grid-cols-2">{activation.data.items.map((item) => <div className="flex items-center gap-3 rounded-md border p-3" key={item.id}><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{bindings.data?.data.find((binding) => binding.device_uuid === item.device_uuid)?.device_name ?? item.device_uuid}</p><p className="text-muted-foreground text-xs">{item.target} · {item.status}{item.diagnostic ? ` · ${item.diagnostic}` : ""}</p></div>{item.status === "failed" && <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate(item.id)}>Retry</Button>}</div>)}</CardContent></Card>}
    {geofenceUuid && <Card><CardHeader><CardTitle>Event history</CardTitle><CardDescription>Boundary crossings and sustained wandering transitions.</CardDescription></CardHeader><CardContent>
      {!events.data?.data.length ? <p className="text-muted-foreground text-sm">No geofence events have been recorded yet.</p> : <div className="grid gap-2">{events.data.data.map((event) => <div className="flex flex-wrap items-center gap-2 rounded-md border p-3" key={event.uuid}><Badge variant="outline">{event.type.replaceAll("_", " ")}</Badge><span className="text-sm">{bindings.data?.data.find((binding) => binding.device_uuid === event.device_uuid)?.device_name ?? event.device_uuid}</span><time className="text-muted-foreground ml-auto text-xs" dateTime={event.occurred_at}>{new Date(event.occurred_at).toLocaleString()}</time></div>)}</div>}
    </CardContent></Card>}
    </WorkspacePage>
  </>
}

function defaultPoint(vertices: number[][]): number[] {
  if (!vertices.length) return [-114, 51]
  if (vertices.length === 1) return [vertices[0][0] + 0.001, vertices[0][1]]
  const first = vertices[0], last = vertices.at(-1)!
  return [(first[0] + last[0]) / 2, (first[1] + last[1]) / 2]
}
