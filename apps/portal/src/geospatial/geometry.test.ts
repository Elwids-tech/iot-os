import { describe, expect, it } from "vitest"
import { closeRing, validateVertices } from "./geometry"

describe("geofence geometry editing", () => {
  it("closes stored rings without duplicating an existing closure", () => {
    const vertices = [[-114, 51], [-113.99, 51], [-114, 51.01]]
    expect(closeRing(vertices)).toEqual([...vertices, vertices[0]])
    expect(closeRing([...vertices, vertices[0]])).toEqual([...vertices, vertices[0]])
  })

  it("reports crossed edges and runtime size constraints", () => {
    expect(validateVertices([[0, 0], [0.01, 0.01], [0, 0.01], [0.01, 0]])).toBe("Edges 1 and 3 cross.")
    expect(validateVertices([[0, 0], [0.000001, 0], [0, 0.000001]])).toBe("The polygon area must be at least one square metre.")
    expect(validateVertices([[0, 0], [1.01, 0], [0, 0.01]])).toBe("The polygon must span no more than one degree of longitude or latitude.")
  })

  it("accepts a valid local polygon", () => {
    expect(validateVertices([[-114.01, 50.99], [-113.99, 50.99], [-113.99, 51.01], [-114.01, 51.01]])).toBeNull()
  })
})
