import { describe, expect, it } from "vitest"
import { parseGeofenceGeometry } from "./geofence-json"
const geometry = { type: "Polygon", coordinates: [[[-114, 51], [-113.999, 51], [-113.999, 51.001], [-114, 51]]] }
describe("geofence geometry import", () => {
  it("round trips copied geometry and extracts geometry from configurations and Features", () => {
    for (const input of [geometry, { name: "Boundary", geometry, assignments: [] }, { type: "Feature", properties: {}, geometry }])
      expect(parseGeofenceGeometry(JSON.stringify(input))).toEqual(geometry)
  })
  it("rejects malformed JSON, open rings, holes, invalid coordinates, and intersecting polygons", () => {
    for (const input of ["{", {}, { ...geometry, coordinates: [geometry.coordinates[0].slice(0, -1)] }, { ...geometry, coordinates: [...geometry.coordinates, ...geometry.coordinates] }, { ...geometry, coordinates: [[[null, 51], [-114, 51], [-114, 52], [null, 51]]] }, { type: "Polygon", coordinates: [[[0, 0], [.01, .01], [0, .01], [.01, 0], [0, 0]]] }])
      expect(() => parseGeofenceGeometry(input)).toThrow()
  })
})
