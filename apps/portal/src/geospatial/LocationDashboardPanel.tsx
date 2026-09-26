import { lazy, Suspense, useEffect, useId, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import type { TrailWindow } from "@iot-os/api-client"
import { Switch } from "@iot-os/ui/components/switch"
import { ToggleGroup, ToggleGroupItem } from "@iot-os/ui/components/toggle-group"
import { Field, FieldLabel } from "@iot-os/ui/components/field"
import { trailColors } from "./presentation"
import { Badge } from "@iot-os/ui/components/badge"
import { Button } from "@iot-os/ui/components/button"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@iot-os/ui/components/empty"
import { api } from "../lib/api"
import { RequestError } from "../components/forms"
import type { PanelProps } from "../dashboards/registry"
import { telemetryRequest } from "../dashboards/requests"
const LocationMap = lazy(() => import("./LocationMap").then((module) => ({ default: module.LocationMap })))

export function LocationDashboardPanel({ org, widget, view }: PanelProps) {
  const controlId = useId()
  const [showTrails, setShowTrails] = useState(widget.config.show_trails ?? true)
  const [trailWindow, setTrailWindow] = useState<TrailWindow>(widget.config.trail_window ?? "24h")
  useEffect(() => setShowTrails(widget.config.show_trails ?? true), [widget.config.show_trails])
  useEffect(() => setTrailWindow(widget.config.trail_window ?? "24h"), [widget.config.trail_window])
  const devices = widget.config.location_device_uuids ?? []
  const [selected, setSelected] = useState<string | null>(devices[0] ?? null)
  const query = useQuery({
    queryKey: ["dashboard-location-map", org, devices, widget.config.geofence_uuid, showTrails, trailWindow],
    queryFn: ({ signal }) => telemetryRequest(signal, () => api.locationMap(org, { device_uuids: devices,
      geofence_uuid: widget.config.geofence_uuid, include_trails: showTrails,
      trail_window: trailWindow }, signal)),
    enabled: devices.length > 0,
    refetchInterval: view.refresh ? view.refresh * 1000 : false,
    refetchIntervalInBackground: false,
  })
  const counts = useMemo(() => {
    const result = { inside: 0, outside: 0, wandering: 0, stale: 0, unknown: 0 }
    for (const device of query.data?.devices ?? []) {
      if (!device.latest?.live_eligible) result[device.latest?.reason === "stale" || device.latest?.reason === "stale_evidence" ? "stale" : "unknown"]++
      else if (device.wandering) result.wandering++
      else if (device.condition === "inside") result.inside++
      else if (device.condition === "outside") result.outside++
      else result.unknown++
    }
    return result
  }, [query.data])
  if (!devices.length) return <Empty><EmptyHeader><EmptyTitle>No GPS devices selected</EmptyTitle><EmptyDescription>Edit this panel and choose up to 100 location-enabled devices.</EmptyDescription></EmptyHeader></Empty>
  if (query.error) return <RequestError error={query.error}><Button variant="outline" size="sm" onClick={() => query.refetch()}>Retry map</Button></RequestError>
  if (query.isPending) return <Skeleton className="h-96 w-full" />
  const current = query.data.devices.find((device) => device.device_uuid === selected) ?? query.data.devices[0]
  const currentIndex = current ? query.data.devices.findIndex((device) => device.device_uuid === current.device_uuid) : -1
  return <section className="flex min-h-96 flex-col gap-3" aria-label="GPS monitoring map">
    <div className="flex flex-wrap gap-2">
      <Badge variant="secondary">{counts.inside} inside</Badge><Badge variant="outline">{counts.outside} outside</Badge>
      <Badge variant={counts.wandering ? "warning" : "outline"}>{counts.wandering} wandering</Badge>
      <Badge variant="outline">{counts.stale} stale</Badge><Badge variant="outline">{counts.unknown} unknown</Badge>
      {query.data.geofence && <Button asChild size="sm" variant="outline"><Link to={`/organizations/${encodeURIComponent(org)}/geofences/${encodeURIComponent(query.data.geofence.uuid)}`}>Edit geofence</Link></Button>}
    </div>
    <div className="flex flex-wrap items-center gap-4">
      <Field orientation="horizontal" className="w-auto"><Switch id={controlId} checked={showTrails} onCheckedChange={setShowTrails} /><FieldLabel htmlFor={controlId}>Movement trails</FieldLabel></Field>
      <ToggleGroup type="single" variant="outline" size="sm" aria-label="Movement trail time limit" value={trailWindow} disabled={!showTrails} onValueChange={(value) => value && setTrailWindow(value as TrailWindow)}>
        {(["1h", "6h", "24h", "7d"] as const).map((value) => <ToggleGroupItem key={value} value={value} aria-label={`Last ${value} of movement`}>{value}</ToggleGroupItem>)}
      </ToggleGroup>
      <span className="text-sm text-muted-foreground">{query.data.geofence?.name ?? "Watch only · no fence selected"}</span>
    </div>
    <p className="text-xs text-muted-foreground">Green: inside · Red: outside · Grey: stale or unknown · Dashed lines: movement trails</p>
    <div className="grid min-h-96 gap-3 xl:grid-cols-[minmax(0,1fr)_16rem]">
      <Suspense fallback={<Skeleton className="h-96 w-full" />}><LocationMap devices={query.data.devices} polygon={query.data.geofence?.geometry.coordinates} selected={current?.device_uuid} onSelect={setSelected} showLabels={widget.config.show_labels ?? true} /></Suspense>
      {current && <aside className="flex flex-col gap-3 rounded-md border p-3">
        <div><p className="font-medium">{current.device_name}</p><Badge variant={current.latest?.live_eligible ? "secondary" : "outline"}>{current.wandering ? "Wandering" : current.condition}</Badge></div>
        <dl className="grid grid-cols-2 gap-2 text-sm"><dt>Observed</dt><dd>{current.latest?.observed_at ? new Date(current.latest.observed_at).toLocaleString() : "Unknown"}</dd>
          <dt>Received</dt><dd>{current.latest?.received_at ? new Date(current.latest.received_at).toLocaleString() : "Unknown"}</dd>
          <dt>Age</dt><dd>{current.latest?.received_at ? formatAge(Date.now() - new Date(current.latest.received_at).getTime()) : "Unknown"}</dd>
          <dt>Accuracy</dt><dd>{current.latest?.point?.accuracy_metres == null ? "Unknown" : `${current.latest.point.accuracy_metres} m`}</dd>
          <dt>Membership</dt><dd>{current.condition}</dd>
          <dt>Deployment</dt><dd>{current.deployment_status ?? "Watch only"}</dd>
          <dt>Alert</dt><dd>{current.active_alert ? "Active" : "None"}</dd>
          <dt>Trail colour</dt><dd><span className="inline-block size-3 rounded-full" style={{ backgroundColor: trailColors[Math.max(0, currentIndex) % trailColors.length] }} /> <span className="sr-only">{trailColors[Math.max(0, currentIndex) % trailColors.length]}</span></dd>
          <dt>Trail</dt><dd>{!showTrails ? "Off" : trailWindow}</dd>
          <dt>Samples</dt><dd>{current.trail.segments.reduce((total, segment) => total + segment.length, 0)}{current.trail.sampled ? "+" : ""}</dd></dl>
        <p className="text-xs text-muted-foreground">{current.latest?.reason.replaceAll("_", " ") ?? "No committed location"}</p>
      </aside>}
    </div>
  </section>
}

function formatAge(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "Unknown"
  const seconds = Math.floor(milliseconds / 1_000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`
}
