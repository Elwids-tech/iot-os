import { useEffect, useRef } from "react"
import * as maplibregl from "maplibre-gl"
import type { GeoJSONSource, Map as MapLibreMap, Marker, MapMouseEvent } from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import "./map.css"
import type { LocationMapDevice } from "@iot-os/api-client"
import { closeRing } from "./geometry"

const FALLBACK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors" } },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
}
const colors = ["#2563eb", "#16a34a", "#d97706", "#9333ea", "#dc2626", "#0891b2"]

export function LocationMap({ devices, polygon, selected, onSelect, showLabels = true, editable = false,
  vertices = [], selectedVertex = null, onVerticesChange, onSelectedVertex }: {
  devices: LocationMapDevice[]; polygon?: number[][][] | null; selected?: string | null; onSelect?: (device: string) => void
  showLabels?: boolean; editable?: boolean; vertices?: number[][]; selectedVertex?: number | null
  onVerticesChange?: (vertices: number[][]) => void; onSelectedVertex?: (index: number | null) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibreMap | null>(null)
  const markers = useRef<Marker[]>([])
  const vertexMarkers = useRef<Marker[]>([])
  const values = useRef({ vertices, onVerticesChange, onSelectedVertex })
  values.current = { vertices, onVerticesChange, onSelectedVertex }

  useEffect(() => {
    if (!container.current) return
    const instance = new maplibregl.Map({ container: container.current, style: import.meta.env.VITE_MAP_STYLE_URL || FALLBACK_STYLE,
      center: [-114, 51], zoom: 12, attributionControl: {} })
    instance.addControl(new maplibregl.NavigationControl(), "top-right")
    const observer = new ResizeObserver(() => instance.resize())
    observer.observe(container.current)
    instance.on("contextmenu", (event: MapMouseEvent) => {
      if (!editable || !values.current.onVerticesChange) return
      event.preventDefault()
      values.current.onVerticesChange([...values.current.vertices, [event.lngLat.lng, event.lngLat.lat]])
      values.current.onSelectedVertex?.(values.current.vertices.length)
    })
    map.current = instance
    return () => { observer.disconnect(); markers.current.forEach((marker) => marker.remove()); vertexMarkers.current.forEach((marker) => marker.remove()); instance.remove(); map.current = null }
  }, [editable])

  useEffect(() => {
    const instance = map.current
    if (!instance) return
    const render = () => {
      const ring = editable ? closeRing(vertices) : polygon?.[0] ?? []
      setSource(instance, "geofence", { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: ring.length >= 4 ? [ring] : [] } })
      if (!instance.getLayer("geofence-fill")) {
        instance.addLayer({ id: "geofence-fill", type: "fill", source: "geofence", paint: { "fill-color": "#16a34a", "fill-opacity": 0.12 } })
        instance.addLayer({ id: "geofence-line", type: "line", source: "geofence", paint: { "line-color": "#16a34a", "line-width": 3 } })
      }
      setSource(instance, "trails", { type: "FeatureCollection", features: devices.flatMap((device, index) => device.trail.segments
        .filter((segment) => segment.length > 1).map((segment) => ({ type: "Feature", properties: { color: colors[index % colors.length] },
          geometry: { type: "LineString", coordinates: segment.map((point) => [point.point.longitude, point.point.latitude]) } }))) })
      if (!instance.getLayer("trails")) instance.addLayer({ id: "trails", type: "line", source: "trails", paint: { "line-color": ["get", "color"], "line-width": 2, "line-opacity": 0.75 } })

      markers.current.forEach((marker) => marker.remove())
      markers.current = devices.flatMap((device, index) => {
        const point = device.latest?.point
        if (!point) return []
        const button = document.createElement("button")
        button.type = "button"; button.className = "location-map-marker"
        button.style.setProperty("--marker-color", device.wandering || device.condition === "outside" ? "#dc2626" : colors[index % colors.length])
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
      if (!bounds.isEmpty()) instance.fitBounds(bounds, { padding: 48, maxZoom: 16, duration: 0 })
    }
    if (instance.loaded()) render(); else instance.once("load", render)
  }, [devices, polygon, selected, showLabels, editable, vertices, selectedVertex, onSelect, onSelectedVertex, onVerticesChange])

  return <div ref={container} className="h-full min-h-96 w-full overflow-hidden rounded-md border" aria-label={editable ? "Geofence editor map" : "GPS location map"} />
}

function setSource(map: MapLibreMap, id: string, data: object) {
  const source = map.getSource(id) as GeoJSONSource | undefined
  if (source) source.setData(data as never); else map.addSource(id, { type: "geojson", data: data as never })
}
