import { validateVertices } from "./geometry"

/** Accept a Polygon, GeoJSON Feature, or exported geofence configuration. */
export function parseGeofenceGeometry(input: unknown): { type: "Polygon"; coordinates: number[][][] } {
  let value = typeof input === "string" ? JSON.parse(input) : input
  if (value && typeof value === "object" && "geometry" in value) value = value.geometry
  if (!value || value.type !== "Polygon" || !Array.isArray(value.coordinates) || value.coordinates.length !== 1)
    throw new Error("Use a GeoJSON Polygon with one outer ring and no holes.")
  const ring = value.coordinates[0]
  if (!Array.isArray(ring) || ring.length < 4 || ring.some((point: unknown) => !Array.isArray(point) || point.length !== 2 || point.some((n: unknown) => typeof n !== "number" || !Number.isFinite(n))))
    throw new Error("Use a closed ring of longitude, latitude pairs.")
  const first = ring[0], last = ring.at(-1)
  if (first[0] !== last[0] || first[1] !== last[1]) throw new Error("The polygon ring must be closed.")
  const error = validateVertices(ring.slice(0, -1))
  if (error) throw new Error(error)
  return { type: "Polygon", coordinates: [ring.map((point: number[]) => [...point])] }
}
