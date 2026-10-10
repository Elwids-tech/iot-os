import { runtimeConfig } from "@iot-os/api-client"
import { useEffect, useRef, useState } from "react"
import * as maplibregl from "maplibre-gl"
import type { GeoJSONSource, Map as MapLibreMap, Marker, MapMouseEvent } from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"
import { markerColor, trailColors } from "./presentation"

// MapLibre 6 resolves its worker relative to its original module; Vite must bundle it explicitly.
maplibregl.setWorkerUrl(workerUrl)
import "./map.css"
import type { LocationMapDevice } from "@iot-os/api-client"
import { closeRing } from "./geometry"

const FALLBACK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors" } },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
}
const EMPTY_VERTICES: number[][] = []

export function LocationMap({ devices, polygon, selected, onSelect, showLabels = true, editable = false,
  vertices = EMPTY_VERTICES, selectedVertex = null, onVerticesChange, onSelectedVertex, onPick }: {
  devices: LocationMapDevice[]; polygon?: number[][][] | null; selected?: string | null; onSelect?: (device: string) => void
  showLabels?: boolean; editable?: boolean; vertices?: number[][]; selectedVertex?: number | null
  onVerticesChange?: (vertices: number[][]) => void; onSelectedVertex?: (index: number | null) => void
  /** Click-to-pick a coordinate, e.g. a simulated GPS fix. */
  onPick?: (point: { latitude: number; longitude: number }) => void
}) {
  const [ready, setReady] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibreMap | null>(null)
  const markers = useRef<Marker[]>([])
  const vertexMarkers = useRef<Marker[]>([])
  const values = useRef({ vertices, onVerticesChange, onSelectedVertex, onPick })
  values.current = { vertices, onVerticesChange, onSelectedVertex, onPick }
  const picking = Boolean(onPick)
  const fitted = useRef<string | null>(null)

  useEffect(() => {
    if (!container.current) return
    const instance = new maplibregl.Map({ container: container.current, style: runtimeConfig("VITE_MAP_STYLE_URL", import.meta.env.VITE_MAP_STYLE_URL) || FALLBACK_STYLE,
      center: [-114, 51], zoom: 12, attributionControl: {} })
    instance.once("load", () => setReady(true))
    instance.addControl(new maplibregl.NavigationControl(), "top-right")
    const observer = new ResizeObserver(() => instance.resize())
    observer.observe(container.current)
    instance.on("contextmenu", (event: MapMouseEvent) => {
      if (!editable || !values.current.onVerticesChange) return
      event.preventDefault()
      values.current.onVerticesChange([...values.current.vertices, [event.lngLat.lng, event.lngLat.lat]])
      values.current.onSelectedVertex?.(values.current.vertices.length)
    })
    fitted.current = null
    if (picking) {
      instance.getCanvas().style.cursor = "crosshair"
      instance.on("click", (event: MapMouseEvent) => values.current.onPick?.({ latitude: event.lngLat.lat, longitude: event.lngLat.lng }))
    }
    map.current = instance
    return () => { setReady(false); observer.disconnect(); markers.current.forEach((marker) => marker.remove()); vertexMarkers.current.forEach((marker) => marker.remove()); instance.remove(); map.current = null }
  }, [editable, picking])

  useEffect(() => {
    const instance = map.current
    if (!instance || !ready) return
    const render = () => {
      const ring = editable ? closeRing(vertices) : polygon?.[0] ?? []
      setSource(instance, "geofence", { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: ring.length >= 4 ? [ring] : [] } })
      if (!instance.getLayer("geofence-fill")) {
        instance.addLayer({ id: "geofence-fill", type: "fill", source: "geofence", paint: { "fill-color": "#16a34a", "fill-opacity": 0.2 } })
        instance.addLayer({ id: "geofence-outline", type: "line", source: "geofence", paint: { "line-color": "#052e16", "line-width": 6 } })
        instance.addLayer({ id: "geofence-line", type: "line", source: "geofence", paint: { "line-color": "#16a34a", "line-width": 3 } })
      }
      setSource(instance, "trails", { type: "FeatureCollection", features: devices.flatMap((device, index) => device.trail.segments
        .filter((segment) => segment.length > 1).map((segment) => ({ type: "Feature", properties: { color: trailColors[index % trailColors.length] },
          geometry: { type: "LineString", coordinates: segment.map((point) => [point.point.longitude, point.point.latitude]) } }))) })
      if (!instance.getLayer("trails")) instance.addLayer({ id: "trails", type: "line", source: "trails", paint: { "line-color": ["get", "color"], "line-width": 2, "line-opacity": 0.85, "line-dasharray": [3, 2] } })

      markers.current.forEach((marker) => marker.remove())
      markers.current = devices.flatMap((device) => {
        const point = device.latest?.point
        if (!point) return []
        const button = document.createElement("button")
        button.type = "button"; button.className = "location-map-marker"
        button.style.setProperty("--marker-color", markerColor(device))
        button.dataset.selected = String(selected === device.device_uuid)
        button.setAttribute("aria-label", `${device.device_name}: ${device.condition}`)
        if (showLabels) button.dataset.label = device.device_name
        button.addEventListener("click", () => onSelect?.(device.device_uuid))
        return [new maplibregl.Marker({ element: button }).setLngLat([point.longitude, point.latitude]).addTo(instance)]
      })

      vertexMarkers.current.forEach((marker) => marker.remove())
      vertexMarkers.current = editable ? vertices.map((vertex, index) => {
        const button = document.createElement("button")
        button.type = "button"; button.className = "geofence-vertex"; button.dataset.selected = String(selectedVertex === index)
        button.setAttribute("aria-label", `Geofence point ${index + 1}`)
        button.addEventListener("click", (event) => { event.stopPropagation(); onSelectedVertex?.(index) })
        button.addEventListener("contextmenu", (event) => { event.preventDefault(); event.stopPropagation(); onVerticesChange?.(vertices.filter((_, current) => current !== index)); onSelectedVertex?.(null) })
        const marker = new maplibregl.Marker({ element: button, draggable: true }).setLngLat(vertex as [number, number]).addTo(instance)
        marker.on("dragend", () => { const next = vertices.map((point) => [...point]); const location = marker.getLngLat(); next[index] = [location.lng, location.lat]; onVerticesChange?.(next) })
        return marker
      }) : []

      const bounds = new maplibregl.LngLatBounds()
      ring.forEach((point) => bounds.extend(point as [number, number]))
      devices.forEach((device) => device.latest?.point && bounds.extend([device.latest.point.longitude, device.latest.point.latitude]))
      devices.forEach((device) => device.trail.segments.forEach((segment) => segment.forEach(({ point }) => bounds.extend([point.longitude, point.latitude]))))
      // A picker keeps the user's zoom after the first fit; it only pans to an off-screen pick.
      const fitKey = JSON.stringify(ring)
      if (picking && fitted.current === fitKey) {
        const point = devices[0]?.latest?.point
        if (point && !instance.getBounds().contains([point.longitude, point.latitude])) instance.easeTo({ center: [point.longitude, point.latitude], duration: 200 })
      } else if (!bounds.isEmpty()) {
        fitted.current = fitKey
        instance.fitBounds(bounds, { padding: 48, maxZoom: 16, duration: 0 })
      }
    }
    render()
  }, [ready, devices, polygon, selected, showLabels, editable, vertices, selectedVertex, onSelect, onSelectedVertex, onVerticesChange, picking])

  return <div ref={container} className="h-full min-h-0 w-full overflow-hidden rounded-md border" aria-label={editable ? "Geofence editor map" : picking ? "Location picker map" : "GPS location map"} />
}

function setSource(map: MapLibreMap, id: string, data: object) {
  const source = map.getSource(id) as GeoJSONSource | undefined
  if (source) source.setData(data as never); else map.addSource(id, { type: "geojson", data: data as never })
}
